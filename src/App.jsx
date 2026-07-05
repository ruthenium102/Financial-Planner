import React, { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Trash2, TrendingUp, Settings, Download, Upload, RotateCcw, X, Home, DollarSign, PiggyBank, Layers, GraduationCap, User, LogOut, Cloud, CloudOff } from "lucide-react";
import pkg from "../package.json";
import {
  DEFAULT_STATE, migrateScenario, project, computeAnnualPayment, genId,
  CONCESSIONAL_CAP, NONCONCESSIONAL_CAP, DIV293_THRESHOLD,
} from "./engine.js";
import {
  SUPABASE_ENABLED, supabase, canAutosaveToFile, downloadJson, writeJsonToFileHandle,
  loadFromLocalStorage, saveToLocalStorage, clearLocalStorage,
  loadFromSupabase, saveToSupabase, deleteFromSupabase,
} from "./storage.js";

// App version, derived from package.json so the two can't drift.
// Bump the package.json "version" field on every release.
const VERSION = "v" + pkg.version.split(".").slice(0, 2).join(".");

// ---------- Design tokens ----------
const C = {
  bg: "#0B0D10",
  panel: "#12161B",
  panelHi: "#171C22",
  line: "#22282F",
  lineHi: "#2E3640",
  text: "#E8E6E1",
  textDim: "#8A8F97",
  textMute: "#5A6069",
  accent: "#D4A574",
  property: "#6B8E7F",
  equities: "#A8946D",
  cash: "#6B7B8C",
  super_: "#8B6F9B",
  sharePlan: "#C9A876",   // brass-tinted, distinct from equities
  other: "#B07A6B",
  danger: "#C96B6B",
  good: "#7FA87F",
  selection: "#7BAEB8",    // muted teal — for year slider reference line
};

const CATEGORY_META = {
  primaryResidence: { label: "Primary Residence", color: C.property, icon: Home },
  investmentProperty: { label: "Investment Property", color: C.property, icon: Home },
  equities: { label: "Shares", color: C.equities, icon: TrendingUp },
  cash: { label: "Cash", color: C.cash, icon: DollarSign },
  offset: { label: "Mortgage Offset", color: C.cash, icon: DollarSign },
  super: { label: "Superannuation", color: C.super_, icon: PiggyBank },
  other: { label: "Other", color: C.other, icon: Layers },
  // Legacy "property" and "sharePlan" categories — kept as fallback meta only, won't appear in selectors.
  property: { label: "Property", color: C.property, icon: Home },
  sharePlan: { label: "Shares", color: C.equities, icon: TrendingUp },
};

// Stack order (bottom to top in chart).
const CATEGORY_ORDER = ["primaryResidence", "investmentProperty", "super", "equities", "other", "cash", "offset"];

// Cashflow chart series — income above x-axis, expenses below.
// Each series stacks; rentalPos/rentalNeg are split because rental net can be either sign.
// Income shades: green family. Expenses: red/orange family. Same-hue gradient variation per series.
const CASHFLOW_INCOME = [
  { key: "cf_salary",      label: "Salary",        color: "#5B8F6F" },
  { key: "cf_cashBonus",   label: "Cash bonus",    color: "#7FA87F" },
  { key: "cf_assetIncome", label: "Asset income",  color: "#A6C49A" },
  { key: "cf_rentalPos",   label: "Rental net",    color: "#8FB87B" },
  { key: "cf_eventIncome", label: "Event income",  color: "#B5C99C" },
];
const CASHFLOW_EXPENSE = [
  { key: "cf_living",        label: "Living expenses",  color: "#A0594F" },
  { key: "cf_schoolFees",    label: "School fees",      color: "#B86F5C" },
  { key: "cf_loanRepayments",label: "Loan repayments",  color: "#C96B6B" },
  { key: "cf_tax",           label: "Tax",              color: "#D88080" },
  { key: "cf_rentalNeg",     label: "Rental loss",      color: "#9F4A48" },
  { key: "cf_eventExpense",  label: "Event expense",    color: "#D9967F" },
];


// ---------- Utilities ----------
const fmt = (n) => {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};
const fmtFull = (n) => `$${Math.round(n).toLocaleString()}`;

// Currency-aware formatter: prefixes amount with currency code
const fmtCcy = (n, ccy) => {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const sym = ccy === "SGD" ? "S$" : ccy === "USD" ? "US$" : "$";
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(0)}k`;
  return `${sign}${sym}${abs.toFixed(0)}`;
};

// Click-outside collapse: assigns a ref; when a click happens outside the ref'd
// element, calls onOutside. Used for expandable rows.
function useClickOutside(active, onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    // Use mousedown so it fires before click handlers that might re-expand
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onOutside]);
  return ref;
}

// ===== Drag-to-reorder hook =====
// Returns { dragProps, isDragging, isDragOver } for each row index.
// Caller passes the array and a setter; the hook handles drag state and reorder logic.
// Native HTML5 drag-and-drop — no library; desktop-friendly.
function useDragReorder(items, onReorder) {
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const handlersFor = (idx) => ({
    draggable: true,
    onDragStart: (e) => {
      setDraggingIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      // Some browsers require setData to start a drag
      try { e.dataTransfer.setData("text/plain", String(idx)); } catch {}
    },
    onDragOver: (e) => {
      e.preventDefault(); // required to allow drop
      e.dataTransfer.dropEffect = "move";
      if (overIdx !== idx) setOverIdx(idx);
    },
    onDragLeave: () => {
      // Don't clear overIdx here — onDragOver on the next row will replace it
    },
    onDrop: (e) => {
      e.preventDefault();
      if (draggingIdx == null || draggingIdx === idx) {
        setDraggingIdx(null); setOverIdx(null); return;
      }
      const next = items.slice();
      const [moved] = next.splice(draggingIdx, 1);
      const insertAt = idx > draggingIdx ? idx - 1 : idx;
      next.splice(insertAt, 0, moved);
      onReorder(next);
      setDraggingIdx(null); setOverIdx(null);
    },
    onDragEnd: () => {
      setDraggingIdx(null); setOverIdx(null);
    },
    style: {
      opacity: draggingIdx === idx ? 0.4 : 1,
      borderTop: overIdx === idx && draggingIdx != null && draggingIdx > idx ? `2px solid ${C.accent}` : undefined,
      borderBottom: overIdx === idx && draggingIdx != null && draggingIdx < idx ? `2px solid ${C.accent}` : undefined,
    },
  });

  return { handlersFor, draggingIdx };
}

// Generic sortable list wrapper. Renders each item with a drag handle and supports
// HTML5 drag-and-drop reordering. The render fn receives the item (no special props).
// Only the drag handle starts drags — the rest of the row stays clickable for editing.
function DragList({ items, getKey, render, onReorder }) {
  const { handlersFor } = useDragReorder(items, onReorder);
  return (
    <>
      {items.map((item, idx) => {
        const handlers = handlersFor(idx);
        // Split: handle gets dragstart/end, the row container gets dragover/drop for the visual indicator
        const { draggable, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, style } = handlers;
        return (
          <div
            key={getKey(item, idx)}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{ ...style, display: "flex", alignItems: "stretch", gap: 0 }}
          >
            <div
              draggable={draggable}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              title="Drag to reorder"
              style={{
                cursor: "grab",
                color: C.textMute,
                opacity: 0.5,
                padding: "0 6px",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                letterSpacing: "-2px",
              }}
            >
              ⋮⋮
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {render(item, idx)}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------- App ----------
export default function FinancialPlanner() {
  const [scenarios, setScenarios] = useState({ "Base case": DEFAULT_STATE });
  const [activeScenario, setActiveScenario] = useState("Base case");
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("stacked");
  const [editingAsset, setEditingAsset] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingLiab, setEditingLiab] = useState(null);
  const [editingEarner, setEditingEarner] = useState(null);
  const [editingKid, setEditingKid] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedYear, setSelectedYear] = useState(null);
  const [activeTab, setActiveTab] = useState("planner");
  const [displayMode, setDisplayMode] = useState("nominal");

  // ===== Auth state =====
  const [session, setSession] = useState(null);          // null when logged out
  const [authReady, setAuthReady] = useState(!SUPABASE_ENABLED); // true immediately if Supabase off
  const [syncStatus, setSyncStatus] = useState("idle");  // idle | saving | error | offline

  // Watch for Supabase auth changes (sign in / out / refresh)
  useEffect(() => {
    if (!SUPABASE_ENABLED) { setAuthReady(true); return; }
    let unsub = null;
    (async () => {
      const { data: { session: existing } } = await supabase.auth.getSession();
      setSession(existing);
      setAuthReady(true);
      const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession);
      });
      unsub = data?.subscription;
    })();
    return () => { if (unsub) unsub.unsubscribe(); };
  }, []);

  // Once scenario loads, pin the slider to the horizon so the reference line is visible
  useEffect(() => {
    if (loaded && selectedYear == null && state?.meta?.horizonYears != null) {
      setSelectedYear(state.meta.horizonYears);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const [renamingScenario, setRenamingScenario] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // Auto-dismiss toasts after 3s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ===== Load scenarios when ready (Supabase if authenticated, else localStorage) =====
  useEffect(() => {
    if (!authReady) return;
    // Reset the id/version refs whenever auth state changes — a different user means different rows
    supabaseIdByName.current = {};
    supabaseVersionByName.current = {};
    (async () => {
      let loadedData;

      if (SUPABASE_ENABLED && session?.user?.id) {
        // Logged in to Supabase — try to load from there first
        loadedData = await loadFromSupabase(session.user.id);
        // First-time migration: if Supabase is empty but localStorage has data, upload it
        if (!loadedData) {
          const local = await loadFromLocalStorage();
          if (local && local.scenarios && Object.keys(local.scenarios).length > 0) {
            // Migrate first
            const migratedLocal = {};
            Object.entries(local.scenarios).forEach(([name, scen]) => {
              const m = migrateScenario(scen);
              if (m) migratedLocal[name] = m;
            });
            if (Object.keys(migratedLocal).length > 0) {
              const result = await saveToSupabase(session.user.id, { scenarios: migratedLocal });
              if (result.ok) {
                // Capture new IDs into the ref (not state)
                Object.keys(migratedLocal).forEach(name => {
                  if (result.idByName[name]) supabaseIdByName.current[name] = result.idByName[name];
                });
                loadedData = { scenarios: migratedLocal, active: local.active };
                setToast({ kind: "ok", msg: `Migrated ${Object.keys(migratedLocal).length} scenarios to cloud` });
              }
            }
          }
        }
      } else {
        // Not logged in OR Supabase disabled — read from localStorage
        loadedData = await loadFromLocalStorage();
      }

      if (loadedData && loadedData.scenarios) {
        const migrated = {};
        Object.entries(loadedData.scenarios).forEach(([name, scen]) => {
          // Capture supabase id and version into refs (not state)
          if (scen._supabaseId) supabaseIdByName.current[name] = scen._supabaseId;
          if (scen._version != null) supabaseVersionByName.current[name] = scen._version;
          const m = migrateScenario(scen);
          if (m) {
            // Strip internal fields from state so they never trigger re-saves
            const { _supabaseId, _version, ...clean } = m;
            migrated[name] = clean;
          }
        });
        if (Object.keys(migrated).length > 0) {
          setScenarios(migrated);
          setActiveScenario(loadedData.active && migrated[loadedData.active]
            ? loadedData.active
            : Object.keys(migrated)[0]);
        }
      } else if (SUPABASE_ENABLED && session?.user?.id) {
        // Authenticated but no data anywhere — start fresh
        setScenarios({ "Base case": DEFAULT_STATE });
        setActiveScenario("Base case");
      }
      // The state updates above re-fire the save effect with exactly the data that
      // was just read — flag it so that first save is skipped (otherwise every load
      // writes back to the cloud and bumps every row's version for nothing).
      justLoadedRef.current = true;
      setLoaded(true);
      // Reset slider when session changes so the user sees the new horizon
      setSelectedYear(null);
    })();
  }, [authReady, session?.user?.id]);

  // Track Supabase row IDs by scenario name in a ref — does NOT trigger re-renders or re-saves
  const supabaseIdByName = useRef({});
  // Track the last-known Supabase version per scenario for optimistic concurrency
  const supabaseVersionByName = useRef({});
  // True right after scenarios were loaded — suppresses the immediate echo-save
  const justLoadedRef = useRef(false);
  // Stale-write modal state: shown when a save fails because version is stale
  const [staleConflict, setStaleConflict] = useState(null); // null | { conflicts: string[] }
  // File workflow state
  const [fileHandle, setFileHandle] = useState(null);       // FileSystemFileHandle if Chrome/Edge with file open
  const [fileName, setFileName] = useState(null);            // Display filename (without .json)
  const [fileDirty, setFileDirty] = useState(false);         // Has changed since last manual save (Safari only)
  const [fileSyncStatus, setFileSyncStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"

  // ===== Save scenarios on change =====
  // File mode (fileHandle set): writes to the local file. On Chrome/Edge with File System
  //   Access API, writes silently. On Safari/Firefox, marks dirty and waits for manual Save.
  // Cloud mode (no fileHandle): debounced save to Supabase with optimistic concurrency.
  // localStorage cache always written either way.
  useEffect(() => {
    if (!loaded) return;
    saveToLocalStorage({ scenarios, active: activeScenario }); // always cache locally

    // Skip the save that fires immediately after a load — nothing has changed yet.
    if (justLoadedRef.current) { justLoadedRef.current = false; return; }

    // === File mode: writing to local file ===
    if (fileHandle) {
      if (canAutosaveToFile()) {
        // Chrome/Edge: silently autosave to file
        setFileSyncStatus("saving");
        const handle = setTimeout(async () => {
          try {
            await writeJsonToFileHandle(fileHandle, { scenarios, active: activeScenario });
            setFileSyncStatus("saved");
            setFileDirty(false);
          } catch (err) {
            console.error("File autosave error:", err);
            setFileSyncStatus("error");
          }
        }, 800);
        return () => clearTimeout(handle);
      } else {
        // Safari/Firefox: just mark dirty; user must click Save manually
        setFileDirty(true);
        return;
      }
    }

    // === Cloud mode ===
    if (!SUPABASE_ENABLED || !session?.user?.id) return;
    setSyncStatus("saving");
    const handle = setTimeout(async () => {
      // Build scenarios with _supabaseId AND _version stamped from refs
      const scenariosWithIds = {};
      for (const [name, scen] of Object.entries(scenarios)) {
        const stamped = { ...scen };
        if (supabaseIdByName.current[name]) stamped._supabaseId = supabaseIdByName.current[name];
        if (supabaseVersionByName.current[name] != null) stamped._version = supabaseVersionByName.current[name];
        scenariosWithIds[name] = stamped;
      }
      const result = await saveToSupabase(session.user.id, { scenarios: scenariosWithIds, active: activeScenario });
      // Always update the ID/version refs from whatever rows did succeed
      if (result.idByName) {
        for (const [name, id] of Object.entries(result.idByName)) {
          supabaseIdByName.current[name] = id;
        }
      }
      if (result.versionByName) {
        for (const [name, ver] of Object.entries(result.versionByName)) {
          supabaseVersionByName.current[name] = ver;
        }
      }
      if (result.ok) {
        setSyncStatus("idle");
      } else if (result.stale) {
        // Stale write conflict — show modal so user can choose
        setSyncStatus("error");
        setStaleConflict({ conflicts: result.conflicts });
      } else {
        setSyncStatus("error");
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [scenarios, activeScenario, loaded, session?.user?.id, fileHandle]);

  const state = scenarios[activeScenario] || DEFAULT_STATE;

  const setState = (updater) => {
    setScenarios(prev => {
      const current = prev[activeScenario] || DEFAULT_STATE;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activeScenario]: next };
    });
  };

  // ===== File workflow: Load / Save / Save As =====
  const handleLoad = async () => {
    try {
      // Use showOpenFilePicker if available, else fall back to <input type="file">
      let file;
      let handle = null;
      if (typeof window.showOpenFilePicker === "function") {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: "The Ledger scenarios", accept: { "application/json": [".json"] } }],
          multiple: false,
        });
        handle = h;
        file = await h.getFile();
      } else {
        // Safari/Firefox fallback: hidden file input
        file = await new Promise((resolve, reject) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json,application/json";
          input.onchange = () => input.files[0] ? resolve(input.files[0]) : reject(new Error("No file selected"));
          input.click();
        });
      }
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload?.scenarios || typeof payload.scenarios !== "object") {
        setToast({ kind: "err", msg: "File doesn't contain valid scenarios" });
        return;
      }
      const incomingNames = Object.keys(payload.scenarios);
      const existingNames = Object.keys(scenarios);
      const hasExisting = existingNames.length > 0;
      // Migrate incoming scenarios
      const migratedIncoming = {};
      for (const [name, scen] of Object.entries(payload.scenarios)) {
        const m = migrateScenario(scen);
        if (m) {
          const { _supabaseId, _version, ...clean } = m;
          migratedIncoming[name] = clean;
        }
      }
      // If no existing scenarios, just load
      if (!hasExisting) {
        setScenarios(migratedIncoming);
        setActiveScenario(payload.active && migratedIncoming[payload.active] ? payload.active : Object.keys(migratedIncoming)[0]);
        // Set file mode
        const baseName = file.name.replace(/\.json$/i, "");
        setFileHandle(handle);
        setFileName(baseName);
        setFileDirty(false);
        setFileSyncStatus("saved");
        setToast({ kind: "ok", msg: `Loaded ${incomingNames.length} scenario${incomingNames.length === 1 ? "" : "s"} from ${baseName}` });
        return;
      }
      // Existing scenarios present → ask user: replace, merge, or cancel?
      setConfirmModal({
        title: "Load scenarios from file",
        msg: `This file contains ${incomingNames.length} scenario${incomingNames.length === 1 ? "" : "s"}: ${incomingNames.join(", ")}. You currently have ${existingNames.length} scenario${existingNames.length === 1 ? "" : "s"}. What would you like to do?`,
        confirmLabel: "Replace all",
        altLabel: "Merge in",
        cancelLabel: "Cancel",
        onConfirm: () => {
          // Replace
          setScenarios(migratedIncoming);
          setActiveScenario(payload.active && migratedIncoming[payload.active] ? payload.active : Object.keys(migratedIncoming)[0]);
          const baseName = file.name.replace(/\.json$/i, "");
          setFileHandle(handle);
          setFileName(baseName);
          setFileDirty(false);
          setFileSyncStatus("saved");
          setToast({ kind: "ok", msg: `Replaced with ${incomingNames.length} scenario${incomingNames.length === 1 ? "" : "s"} from ${baseName}` });
        },
        onAlt: () => {
          // Merge — incoming scenarios added; name collisions get "(imported)" suffix
          const merged = { ...scenarios };
          for (const [name, scen] of Object.entries(migratedIncoming)) {
            let finalName = name;
            if (merged[finalName]) {
              let i = 1;
              while (merged[`${name} (imported${i > 1 ? ` ${i}` : ""})`]) i++;
              finalName = `${name} (imported${i > 1 ? ` ${i}` : ""})`;
            }
            merged[finalName] = scen;
          }
          setScenarios(merged);
          const baseName = file.name.replace(/\.json$/i, "");
          setFileHandle(handle);
          setFileName(baseName);
          setFileDirty(false);
          setFileSyncStatus("saved");
          setToast({ kind: "ok", msg: `Merged ${incomingNames.length} scenario${incomingNames.length === 1 ? "" : "s"} from ${baseName}` });
        },
        // Cancel = do nothing (previously cancel meant "merge", which surprised nobody in a good way)
      });
    } catch (err) {
      if (err && err.name !== "AbortError") {
        console.error("Load error:", err);
        setToast({ kind: "err", msg: "Failed to load file" });
      }
    }
  };

  const handleSave = async () => {
    // If we have a file handle and the API is available, write silently to that file
    const payload = { scenarios, active: activeScenario };
    if (fileHandle && canAutosaveToFile()) {
      try {
        setFileSyncStatus("saving");
        await writeJsonToFileHandle(fileHandle, payload);
        setFileSyncStatus("saved");
        setFileDirty(false);
        setToast({ kind: "ok", msg: `Saved to ${fileName}` });
      } catch (err) {
        console.error("Save error:", err);
        setFileSyncStatus("error");
        setToast({ kind: "err", msg: "Failed to save file" });
      }
      return;
    }
    // Otherwise, behave like Save As (or Safari fallback download)
    if (fileHandle && fileName) {
      // We had a file picked from <input> earlier (Safari/Firefox); download with same filename
      downloadJson(payload, `${fileName}.json`);
      setFileDirty(false);
      setToast({ kind: "ok", msg: `Downloaded ${fileName}.json` });
      return;
    }
    // No file at all yet → Save As
    handleSaveAs();
  };

  const handleSaveAs = async () => {
    const payload = { scenarios, active: activeScenario };
    if (canAutosaveToFile()) {
      try {
        const handle = await window.showSaveFilePicker({
          types: [{ description: "The Ledger scenarios", accept: { "application/json": [".json"] } }],
        });
        await writeJsonToFileHandle(handle, payload);
        const file = await handle.getFile();
        const baseName = file.name.replace(/\.json$/i, "");
        setFileHandle(handle);
        setFileName(baseName);
        setFileDirty(false);
        setFileSyncStatus("saved");
        setToast({ kind: "ok", msg: `Saved as ${baseName}` });
      } catch (err) {
        if (err && err.name !== "AbortError") {
          console.error("Save As error:", err);
          setToast({ kind: "err", msg: "Failed to save file" });
        }
      }
    } else {
      // Safari/Firefox: trigger download. User picks filename via download dialog.
      downloadJson(payload, "the-ledger.json");
      // Set a marker so subsequent Save uses download flow with this name
      setFileHandle({ _safari: true });
      setFileName("the-ledger");
      setFileDirty(false);
      setToast({ kind: "ok", msg: "Downloaded the-ledger.json" });
    }
  };

  // Close the current file (return to cloud autosave mode)
  const handleCloseFile = () => {
    setFileHandle(null);
    setFileName(null);
    setFileDirty(false);
    setFileSyncStatus("idle");
    setToast({ kind: "ok", msg: "Closed file. Cloud autosave resumed." });
  };

  // Tab-close warning when there are unsaved changes in file mode (Safari/Firefox path)
  useEffect(() => {
    if (!fileHandle || canAutosaveToFile()) return; // not in manual-save mode
    if (!fileDirty) return; // nothing dirty
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Save before closing?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [fileHandle, fileDirty]);


  // Reorder helpers — used by drag-to-reorder
  const reorderEarners = (next) => setState(s => ({ ...s, earners: next }));
  const reorderAssets = (filter, next) => setState(s => {
    // Replace the filtered subset within the full assets array, preserving non-matching items in place
    const others = s.assets.filter(a => !filter(a));
    return { ...s, assets: [...next, ...others] };
  });
  const reorderLiabilities = (next) => setState(s => ({ ...s, liabilities: next }));
  const reorderKids = (next) => setState(s => ({ ...s, kids: next }));
  const reorderExpenses = (next) => setState(s => ({ ...s, expenses: next }));
  const reorderEvents = (next) => setState(s => ({ ...s, events: next }));

  const projection = useMemo(() => {
    try { return project(state); } catch (e) {
      console.error("Projection error:", e);
      return [{
        year: 0, age: state.meta?.currentAge || 45,
        primaryResidence: 0, investmentProperty: 0, equities: 0, cash: 0, offset: 0, super: 0, other: 0,
        totalAssets: 0, liabilities: 0, netWealth: 0, netCashflow: 0,
        totalGross: 0, totalNet: 0, totalTax: 0, expenses: 0, expenseBreakdown: {},
        schoolFees: 0, earnerBreakdown: {}, feesByKid: {},
        allRetired: false, anyRetired: false, activeEvents: [],
      }];
    }
  }, [state]);

  // Deflate a row's dollar values by (1+inflation)^year so they show in today's purchasing power.
  // Non-dollar fields (year, age, retired flags, etc.) are passed through unchanged.
  // Applied AFTER the engine runs — internal calculations remain in nominal dollars.
  const displayedProjection = useMemo(() => {
    if (displayMode !== "real") return projection;
    const inflPct = state.meta?.inflation ?? 0;
    if (!inflPct) return projection;
    const PASS_THROUGH = new Set([
      "year", "age", "currency", "name", "fx", "retired", "allRetired", "anyRetired",
      "hasPrivateHealth", "sgIncludesBonus",
      // Per-expense / per-event metadata (rates, years, durations — not dollar amounts)
      "growthPct", "startYear", "endYear",
      "type", "yearOffset", "duration", "category", "earnerId",
      // Loan metadata (rate is a percentage, not a dollar amount)
      "rate", "assetId",
    ]);
    const deflateValue = (val, factor) => {
      if (val == null) return val;
      if (typeof val === "number") return val * factor;
      if (Array.isArray(val)) return val.map(v => deflateValue(v, factor));
      if (typeof val === "object") {
        const out = {};
        for (const k of Object.keys(val)) {
          out[k] = PASS_THROUGH.has(k) ? val[k] : deflateValue(val[k], factor);
        }
        return out;
      }
      return val;
    };
    return projection.map(row => {
      const factor = 1 / Math.pow(1 + inflPct / 100, row.year);
      const out = {};
      for (const k of Object.keys(row)) {
        out[k] = PASS_THROUGH.has(k) ? row[k] : deflateValue(row[k], factor);
      }
      return out;
    });
  }, [projection, displayMode, state.meta?.inflation]);

  const currentRow = (selectedYear != null ? displayedProjection.find(r => r.year === selectedYear) : displayedProjection[displayedProjection.length - 1]) || displayedProjection[0];

  // Build loan list for the stacked liability chart.
  // Each entry: { key (used as dataKey suffix), name, color }.
  // Colors are hue-shifted variants of the danger red so all loans read as debt.
  const loanList = useMemo(() => {
    const list = [];
    state.assets.forEach(a => {
      (a.loans || []).forEach(l => {
        if ((l.balance || 0) > 0) {
          list.push({
            key: `asset:${a.id}:${l.id || "ln"}`,
            name: a.name + (a.loans.length > 1 ? ` (loan ${a.loans.indexOf(l) + 1})` : ""),
          });
        }
      });
    });
    state.liabilities.forEach(l => {
      if ((l.balance || 0) > 0) {
        list.push({ key: `liab:${l.id}`, name: l.name });
      }
    });
    // Assign each loan a slight gradient variation by stop opacity tuple
    return list.map((loan, idx) => {
      // Spread opacities across the list — first loan: deepest; last loan: lightest
      const t = list.length === 1 ? 0 : idx / (list.length - 1);
      const top = 0.85 - t * 0.35;     // 0.85 → 0.50
      const bot = 0.30 - t * 0.20;     // 0.30 → 0.10
      return { ...loan, gradTop: top, gradBot: bot };
    });
  }, [state.assets, state.liabilities]);

  // Build per-category asset lists for the per-category stacked chart views.
  // Each entry: { key (used as dataKey), name, gradTop, gradBot } — gradient variation
  // gives each asset within the same category a slightly different opacity so they read
  // distinctly while remaining visually unified as one category.
  const categoryAssetLists = useMemo(() => {
    const lists = {};
    // Single-asset categories: PR, IP, equities, super, other, cash
    ["primaryResidence", "investmentProperty", "equities", "super", "other", "cash"].forEach(cat => {
      const catAssets = state.assets.filter(a => a.category === cat);
      lists[cat] = catAssets.map((a, idx) => {
        const t = catAssets.length === 1 ? 0 : idx / (catAssets.length - 1);
        return {
          key: `assetbal_${a.id}`,
          name: a.name,
          gradTop: 0.85 - t * 0.35,
          gradBot: 0.30 - t * 0.20,
        };
      });
    });
    // Mortgage Offset: list each loan's offset balance as its own band
    const offsetEntries = [];
    state.assets.forEach(a => {
      (a.loans || []).forEach(l => {
        if ((l.offsetBalance || 0) > 0) {
          offsetEntries.push({
            key: `offsetbal_asset:${a.id}:${l.id || "ln"}`,
            name: `${a.name} offset`,
          });
        }
      });
    });
    state.liabilities.forEach(l => {
      if ((l.offsetBalance || 0) > 0) {
        offsetEntries.push({
          key: `offsetbal_liab:${l.id}`,
          name: `${l.name} offset`,
        });
      }
    });
    lists.offset = offsetEntries.map((e, idx) => {
      const t = offsetEntries.length === 1 ? 0 : idx / (offsetEntries.length - 1);
      return {
        ...e,
        gradTop: 0.85 - t * 0.35,
        gradBot: 0.30 - t * 0.20,
      };
    });
    return lists;
  }, [state.assets, state.liabilities]);

  // Smart event label staggering: assign each event a "lane" so labels don't collide.
  // Sort events by yearOffset, then walk through. If an event is within COLLISION_YEARS of
  // the previous event, push it to the next lane (lane 0 = top, lane 1 = below, etc.). If
  // it's far enough apart from all previous events in higher lanes, reset to lane 0.
  const eventLaneMap = useMemo(() => {
    const COLLISION_YEARS = 3;          // events closer than this risk label collision
    const sorted = [...state.events]
      .filter(e => e.yearOffset != null)
      .sort((a, b) => a.yearOffset - b.yearOffset);
    const map = {};
    const laneLastYear = []; // index = lane number, value = most recent yearOffset in that lane
    sorted.forEach(ev => {
      // Find the lowest lane where the gap is wide enough
      let lane = 0;
      while (lane < laneLastYear.length && (ev.yearOffset - laneLastYear[lane]) < COLLISION_YEARS) {
        lane++;
      }
      laneLastYear[lane] = ev.yearOffset;
      map[ev.id] = lane;
    });
    return map;
  }, [state.events]);

  const renameScenario = (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    if (scenarios[trimmed]) {
      setToast({ kind: "err", msg: `"${trimmed}" already exists` });
      return;
    }
    // Move the Supabase id/version refs to the new name — otherwise the next save
    // would INSERT a new row (duplicate) and orphan the old one in the cloud.
    if (supabaseIdByName.current[oldName]) {
      supabaseIdByName.current[trimmed] = supabaseIdByName.current[oldName];
      delete supabaseIdByName.current[oldName];
    }
    if (supabaseVersionByName.current[oldName] != null) {
      supabaseVersionByName.current[trimmed] = supabaseVersionByName.current[oldName];
      delete supabaseVersionByName.current[oldName];
    }
    setScenarios(prev => {
      const next = {};
      // Preserve key order by rebuilding the object
      Object.keys(prev).forEach(k => {
        next[k === oldName ? trimmed : k] = prev[k];
      });
      return next;
    });
    if (activeScenario === oldName) setActiveScenario(trimmed);
    setToast({ kind: "ok", msg: `Renamed to "${trimmed}"` });
  };

  const forkScenario = () => {
    // Generate a unique name based on the current scenario
    const base = `${activeScenario} copy`;
    let newName = base;
    let n = 2;
    while (scenarios[newName]) {
      newName = `${base} ${n++}`;
    }
    const cloned = JSON.parse(JSON.stringify(state));
    setScenarios(prev => ({ ...prev, [newName]: cloned }));
    setActiveScenario(newName);
    // Drop the new tab straight into rename mode for fast labelling
    setRenamingScenario(newName);
    setRenameValue(newName);
    setToast({ kind: "ok", msg: `Forked → "${newName}"` });
  };

  const deleteScenario = (name) => {
    if (Object.keys(scenarios).length <= 1) return;
    const supabaseId = supabaseIdByName.current[name];
    setScenarios(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    if (activeScenario === name) setActiveScenario(Object.keys(scenarios).filter(s => s !== name)[0]);
    // Best-effort Supabase delete + clean refs
    if (supabaseId) deleteFromSupabase(supabaseId);
    delete supabaseIdByName.current[name];
    delete supabaseVersionByName.current[name];
  };

  const resetDefaults = () => {
    setConfirmModal({
      msg: `Reset the current scenario "${activeScenario}" to default. Other scenarios are unaffected.`,
      onConfirm: () => {
        setScenarios(prev => ({ ...prev, [activeScenario]: DEFAULT_STATE }));
      },
    });
  };

  // --- CRUD helpers ---
  const addAsset = () => {
    const id = genId("a");
    setState(s => ({ ...s, assets: [...s.assets, { id, name: "New asset", category: "cash", value: 10000, growth: 4, income: 0 }] }));
    setEditingAsset(id);
  };
  const addSuper = () => {
    const id = genId("a");
    setState(s => ({ ...s, assets: [...s.assets, { id, name: "Super", category: "super", value: 0, growth: 7, income: 0 }] }));
    setEditingAsset(id);
  };
  const updateAsset = (id, patch) => setState(s => ({ ...s, assets: s.assets.map(a => a.id === id ? { ...a, ...patch } : a) }));
  const removeAsset = (id) => setState(s => ({ ...s, assets: s.assets.filter(a => a.id !== id) }));

  const addLiab = () => {
    const id = genId("l");
    setState(s => ({ ...s, liabilities: [...s.liabilities, { id, name: "New debt", balance: 0, rate: 6, type: "pi", termYears: 30 }] }));
    setEditingLiab(id);
  };
  const updateLiab = (id, patch) => setState(s => ({ ...s, liabilities: s.liabilities.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const removeLiab = (id) => setState(s => ({ ...s, liabilities: s.liabilities.filter(l => l.id !== id) }));

  const addEarner = () => {
    const id = genId("earner");
    setState(s => ({ ...s, earners: [...s.earners, { id, name: "New earner", currency: "AUD", salary: 100000, bonusRateCash: 0, bonusRateShares: 0, salaryGrowth: 3, taxMode: "ato", taxRate: 32, hasPrivateHealth: true, superSgRate: 12.0, superSgIncludesBonus: false, superExtraConcessionalRate: 0, superExtraNonConcessionalRate: 0, superMatchConcessionalRate: 0, superMatchNonConcessionalRate: 0 }] }));
    setEditingEarner(id);
  };
  const updateEarner = (id, patch) => setState(s => ({ ...s, earners: s.earners.map(e => e.id === id ? { ...e, ...patch } : e) }));
  const removeEarner = (id) => setState(s => ({
    ...s,
    earners: s.earners.filter(e => e.id !== id),
    events: s.events.filter(ev => !(ev.type === "retirement" && ev.earnerId === id)),
  }));

  const addKid = () => {
    const id = genId("k");
    setState(s => ({ ...s, kids: [...s.kids, { id, name: `Kid ${s.kids.length + 1}`, annualFees: 30000, yearsRemaining: 6, feeGrowth: 5 }] }));
    setEditingKid(id);
  };
  const updateKid = (id, patch) => setState(s => ({ ...s, kids: s.kids.map(k => k.id === id ? { ...k, ...patch } : k) }));
  const removeKid = (id) => setState(s => ({ ...s, kids: s.kids.filter(k => k.id !== id) }));

  const addEvent = () => {
    const id = genId("e");
    setState(s => ({ ...s, events: [...s.events, { id, name: "New event", yearOffset: 5, duration: 1, type: "expense", amount: 10000, category: "cash" }] }));
    setEditingEvent(id);
  };
  const updateEvent = (id, patch) => setState(s => ({ ...s, events: s.events.map(e => e.id === id ? { ...e, ...patch } : e) }));
  const removeEvent = (id) => setState(s => ({ ...s, events: s.events.filter(e => e.id !== id) }));

  const addExpense = () => {
    const id = genId("x");
    setState(s => ({ ...s, expenses: [...(s.expenses || []), { id, name: "New expense", amount: 5000, growth: 3, startYear: 0, endYear: null }] }));
    setEditingExpense(id);
  };
  const updateExpense = (id, patch) => setState(s => ({ ...s, expenses: (s.expenses || []).map(x => x.id === id ? { ...x, ...patch } : x) }));
  const removeExpense = (id) => setState(s => ({ ...s, expenses: (s.expenses || []).filter(x => x.id !== id) }));

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.textDim, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'EB Garamond', Georgia, serif", fontStyle: "italic", letterSpacing: "0.02em" }}>
        Loading scenarios…
      </div>
    );
  }

  // ===== Auth gate: show login screen if Supabase enabled and not signed in =====
  if (SUPABASE_ENABLED && authReady && !session) {
    return <AuthView onSignedIn={() => { /* session updates via auth listener */ }} />;
  }

  // While we're checking auth state, show a tiny loader
  if (SUPABASE_ENABLED && !authReady) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.textMute, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter Tight', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .serif { font-family: 'EB Garamond', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        input, select { font-family: inherit; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0; }
        input:focus, select:focus { outline: none; border-color: ${C.accent}; }
        .fp-btn { transition: all 0.15s ease; }
        .fp-btn:hover { background: ${C.panelHi}; border-color: ${C.lineHi}; }
        .fp-btn:active { transform: translateY(1px); }
        .fp-scenario-tab { transition: all 0.2s ease; }
        .fp-scenario-tab:hover { color: ${C.text}; }
        .fp-row:hover { background: ${C.panelHi}; }
        /* Make <select> look like <input> — strip native chrome, add custom dropdown arrow */
        select {
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, ${C.textMute} 50%),
                            linear-gradient(135deg, ${C.textMute} 50%, transparent 50%);
          background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
          padding-right: 24px !important;
          font-family: 'JetBrains Mono', monospace;
          line-height: normal;
          height: auto;
          box-sizing: border-box;
        }
        select::-ms-expand { display: none; }
        .slider { -webkit-appearance: none; appearance: none; height: 2px; background: ${C.line}; border-radius: 0; outline: none; }
        .slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; background: ${C.accent}; border-radius: 50%; cursor: grab; border: 2px solid ${C.bg}; box-shadow: 0 0 0 1px ${C.accent}; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; background: ${C.accent}; border-radius: 50%; cursor: grab; border: 2px solid ${C.bg}; }
        .slider-selection::-webkit-slider-thumb { background: ${C.selection}; box-shadow: 0 0 0 1px ${C.selection}; width: 16px; height: 16px; }
        .slider-selection::-moz-range-thumb { background: ${C.selection}; border-color: ${C.bg}; width: 16px; height: 16px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.3s ease; }
      `}</style>

      <header style={{ borderBottom: `1px solid ${C.line}`, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: `linear-gradient(180deg, ${C.panel} 0%, ${C.bg} 100%)`, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div className="serif" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em", fontStyle: "italic" }}>The Ledger</div>
            <div className="mono" style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.1em", opacity: 0.6 }}>{VERSION}</div>
          </div>
          <div style={{ color: C.textMute, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" }}>Long-range financial scenarios</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Status: file mode shows file status; cloud mode shows sync status */}
          {fileHandle ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, fontSize: 10, color: C.textMute, letterSpacing: "0.05em" }}>
              {fileSyncStatus === "saving" && <><Download size={11} /> Saving…</>}
              {fileSyncStatus === "saved" && !fileDirty && <><Download size={11} color={C.good} /> Saved to {fileName}</>}
              {fileDirty && <><Download size={11} color={C.danger} /> Unsaved · {fileName}</>}
              {fileSyncStatus === "error" && <><Download size={11} color={C.danger} /> Save failed · {fileName}</>}
              <button onClick={handleCloseFile} className="fp-btn" style={{ ...btnGhost, padding: "2px 6px", fontSize: 9, marginLeft: 4 }} title="Close file and return to cloud autosave" aria-label="Close file and return to cloud autosave">
                <X size={9} />
              </button>
            </div>
          ) : (
            SUPABASE_ENABLED && session && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, fontSize: 10, color: C.textMute, letterSpacing: "0.05em" }}>
                {syncStatus === "saving" && <><Cloud size={11} /> Saving…</>}
                {syncStatus === "idle" && <><Cloud size={11} color={C.good} /> Synced</>}
                {syncStatus === "error" && <><CloudOff size={11} color={C.danger} /> Save failed</>}
              </div>
            )
          )}
          <button onClick={handleLoad} className="fp-btn" style={btnGhost} title="Load scenarios from a file">
            <Upload size={13} /> Load
          </button>
          <button
            onClick={handleSave}
            className="fp-btn"
            style={{ ...btnGhost, opacity: fileHandle ? 1 : 0.5 }}
            disabled={!fileHandle}
            title={fileHandle ? `Save to ${fileName}` : "No file open — use Save As first"}
          >
            <Download size={13} /> Save
          </button>
          <button onClick={handleSaveAs} className="fp-btn" style={btnGhost} title="Save scenarios to a new file">
            <Download size={13} /> Save As
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="fp-btn" style={btnGhost}>
            <Settings size={13} /> Assumptions
          </button>
          <button onClick={resetDefaults} className="fp-btn" style={btnGhost}>
            <RotateCcw size={13} /> Reset
          </button>
          {SUPABASE_ENABLED && session && (
            <button onClick={async () => {
              await supabase.auth.signOut();
              supabaseIdByName.current = {};
              supabaseVersionByName.current = {};
              // Don't leave financial data cached in the browser on shared machines
              clearLocalStorage();
              setScenarios({ "Base case": DEFAULT_STATE });
              setActiveScenario("Base case");
              setLoaded(false);
            }} className="fp-btn" style={btnGhost} title={`Signed in as ${session.user.email}`}>
              <LogOut size={13} /> Sign out
            </button>
          )}
        </div>
      </header>

      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "0 32px", display: "flex", alignItems: "center", gap: 4, background: C.bg, flexWrap: "wrap" }}>
        {Object.keys(scenarios).map(name => (
          <div key={name} style={{ display: "flex", alignItems: "center" }}>
            {renamingScenario === name ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    renameScenario(name, renameValue);
                    setRenamingScenario(null);
                  } else if (e.key === "Escape") {
                    setRenamingScenario(null);
                  }
                }}
                onBlur={() => {
                  renameScenario(name, renameValue);
                  setRenamingScenario(null);
                }}
                style={{
                  background: C.bg, border: `1px solid ${C.accent}`, color: C.text,
                  padding: "8px 12px", fontSize: 12, letterSpacing: "0.05em",
                  textTransform: "uppercase", marginBottom: -1, outline: "none",
                  borderBottom: `2px solid ${C.accent}`,
                  fontFamily: "Inter Tight",
                }}
              />
            ) : (
              <button className="fp-scenario-tab"
                onClick={() => setActiveScenario(name)}
                onDoubleClick={() => { setRenamingScenario(name); setRenameValue(name); }}
                title="Double-click to rename"
                style={{
                  background: "transparent", border: "none", padding: "14px 16px",
                  color: activeScenario === name ? C.text : C.textMute,
                  fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase",
                  cursor: "pointer",
                  borderBottom: activeScenario === name ? `2px solid ${C.accent}` : "2px solid transparent",
                  marginBottom: -1,
                }}
              >{name}</button>
            )}
            {Object.keys(scenarios).length > 1 && renamingScenario !== name && (
              <button onClick={() => deleteScenario(name)} title={`Delete scenario "${name}"`} aria-label={`Delete scenario "${name}"`} style={{ background: "transparent", border: "none", color: C.textMute, cursor: "pointer", padding: 4, opacity: 0.4 }}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button onClick={forkScenario} title="Duplicate the current scenario" style={{
          background: "transparent", border: "none", padding: "14px 14px",
          color: C.textMute, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase",
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6,
        }}>
          <Plus size={12} /> Fork
        </button>
      </div>

      {showSettings && (
        <div className="fade-in" style={{ padding: "20px 32px", background: C.panel, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18 }}>
            <NumberField label="Current age" value={state.meta.currentAge} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, currentAge: v } }))} />
            <NumberField label="Horizon (years)" value={state.meta.horizonYears} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, horizonYears: v } }))} />
            <NumberField label="Inflation %" value={state.meta.inflation} step={0.1} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, inflation: v } }))} />
            <NumberField label="FX rate (AUD per SGD)" value={state.meta.fxSgdAud ?? 1.15} step={0.01} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, fxSgdAud: v } }))} />
            <NumberField label="Retirement spending %" value={(state.meta.retirementSpendingMultiplier ?? 0.75) * 100} step={5} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, retirementSpendingMultiplier: Math.max(0, v / 100) } }))} />
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>Shortfall drawdown</div>
              <select
                value={state.meta.drawdown?.enabled === false ? "off" : "on"}
                onChange={e => setState(s => ({ ...s, meta: { ...s.meta, drawdown: { superPreservationAge: 60, ...(s.meta.drawdown || {}), enabled: e.target.value === "on" } } }))}
                style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "8px 10px", fontSize: 13, width: "100%" }}
              >
                <option value="on">On — sell assets to fund deficits</option>
                <option value="off">Off — cash can go negative</option>
              </select>
            </label>
            <NumberField label="Super access age" value={state.meta.drawdown?.superPreservationAge ?? 60} onChange={v => setState(s => ({ ...s, meta: { ...s.meta, drawdown: { enabled: true, ...(s.meta.drawdown || {}), superPreservationAge: v } } }))} />
          </div>

          {/* Cash optimisation panel */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
              Cash Optimisation
            </div>
            <CashOptimisationEditor state={state} setState={setState} />
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: C.textMute, letterSpacing: "0.05em" }}>
            Australian tax: ATO 2025–26 progressive + Medicare levy (with low-income phase-in) + MLS when no private cover. Singapore: IRAS resident YA2026. Super: 15% contribs tax on concessional contributions within cap; Division 293 (extra 15%) when income + concessional contribs exceed $250k; excess concessional taxed at marginal rate. Shortfall drawdown funds cash deficits by selling other cash, then shares, then super (once past the access age). Per-earner currency, tax method, and super contribution rates are set in the Income panel.
          </div>
        </div>
      )}

      <div style={{ padding: "24px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: C.line, borderBottom: `1px solid ${C.line}` }}>
        <Kpi label="Age" value={currentRow.age} suffix={` / Yr ${currentRow.year}`} />
        <Kpi label="Net wealth" value={fmt(currentRow.netWealth)} emphasis />
        <Kpi label="Total assets" value={fmt(currentRow.totalAssets)} />
        <Kpi label="Liabilities" value={fmt(currentRow.liabilities)} color={currentRow.liabilities > 0 ? C.danger : C.textDim} />
        <Kpi label="Household net" value={fmt(currentRow.totalNet)} color={currentRow.totalNet > 0 ? C.good : C.textDim} />
        <Kpi label="Tax" value={fmt(currentRow.totalTax)} color={currentRow.totalTax > 0 ? C.danger : C.textDim} />
        <Kpi label="Expenses" value={fmt(currentRow.expenses)} color={currentRow.expenses > 0 ? C.danger : C.textDim} />
        <Kpi label="School fees" value={fmt(currentRow.schoolFees)} color={currentRow.schoolFees > 0 ? C.danger : C.textDim} />
        <Kpi label="Net cashflow" value={fmt(currentRow.netCashflow)} color={currentRow.netCashflow >= 0 ? C.good : C.danger} />
      </div>

      {/* View tabs: Planner / Logic / Trace */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, background: C.panel, padding: "0 24px" }}>
        {[
          { id: "planner", label: "Planner", sub: "Chart & inputs" },
          { id: "logic", label: "Logic", sub: "Flow & formulas" },
          { id: "trace", label: "Trace", sub: "Year calculation trace" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              background: "transparent", border: "none", padding: "14px 20px",
              cursor: "pointer", marginBottom: -1,
              borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : "2px solid transparent",
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
            }}>
            <span style={{
              fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase",
              color: activeTab === tab.id ? C.text : C.textMute,
            }}>{tab.label}</span>
            <span style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.05em" }}>{tab.sub}</span>
          </button>
        ))}
      </div>

      {activeTab === "planner" && (

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 0 }}>
        <div style={{ borderRight: `1px solid ${C.line}` }}>
          <div style={{ padding: "24px 32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="serif" style={{ fontSize: 22, fontStyle: "italic", fontWeight: 500 }}>Net wealth, {state.meta.horizonYears}-year projection</div>
                <div style={{ color: C.textMute, fontSize: 11, marginTop: 4, letterSpacing: "0.05em" }}>
                  {displayMode === "real"
                    ? `Real ${state.meta.currency} · today's purchasing power · deflated at ${state.meta.inflation ?? 0}%`
                    : `Nominal ${state.meta.currency} · hover chart for year detail`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 0, border: `1px solid ${C.line}` }}>
                  <button onClick={() => setDisplayMode("nominal")} style={{ ...btnTab, background: displayMode === "nominal" ? C.accent : "transparent", color: displayMode === "nominal" ? C.bg : C.textDim }}>Nominal</button>
                  <button onClick={() => setDisplayMode("real")} style={{ ...btnTab, background: displayMode === "real" ? C.accent : "transparent", color: displayMode === "real" ? C.bg : C.textDim }}>Real</button>
                </div>
                <div style={{ display: "flex", gap: 0, border: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                  <button onClick={() => setView("stacked")} style={{ ...btnTab, background: view === "stacked" ? C.accent : "transparent", color: view === "stacked" ? C.bg : C.textDim }}>Stacked</button>
                  <button onClick={() => setView("net")} style={{ ...btnTab, background: view === "net" ? C.accent : "transparent", color: view === "net" ? C.bg : C.textDim }}>Net</button>
                  {CATEGORY_ORDER.map(cat => (
                    <button key={cat} onClick={() => setView(cat)} style={{ ...btnTab, background: view === cat ? C.accent : "transparent", color: view === cat ? C.bg : C.textDim }}>
                      {CATEGORY_META[cat].label.replace("Superannuation", "Super")}
                    </button>
                  ))}
                  <button onClick={() => setView("liabilities")} style={{ ...btnTab, background: view === "liabilities" ? C.accent : "transparent", color: view === "liabilities" ? C.bg : C.textDim }}>Liabilities</button>
                  <button onClick={() => setView("cashflow")} style={{ ...btnTab, background: view === "cashflow" ? C.accent : "transparent", color: view === "cashflow" ? C.bg : C.textDim }}>Cashflow</button>
                </div>
              </div>
            </div>

            <div style={{ height: 380 }}>
              <ResponsiveContainer width="100%" height="100%">
                {view === "cashflow" ? (
                  <ComposedChart data={displayedProjection} stackOffset="sign" margin={{ top: 36, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} strokeDasharray="0" vertical={false} />
                    <XAxis dataKey="year" stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(y) => `+${y}`} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} />
                    <YAxis stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v) => fmt(v)} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} width={60} />
                    <Tooltip content={<CashflowTooltip events={state.events} />} />
                    <ReferenceLine y={0} stroke={C.lineHi} strokeWidth={1} />
                    {CASHFLOW_INCOME.map(s => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        stackId="cashflow"
                        fill={s.color}
                        name={s.label}
                        isAnimationActive={false}
                      />
                    ))}
                    {CASHFLOW_EXPENSE.map(s => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        stackId="cashflow"
                        fill={s.color}
                        name={s.label}
                        isAnimationActive={false}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="cf_net"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                      dot={false}
                      name="Net"
                      isAnimationActive={false}
                    />
                    {selectedYear != null && (
                      <ReferenceLine x={selectedYear} stroke={C.selection} strokeDasharray="2 2" strokeWidth={1} />
                    )}
                    {state.events.filter(e => e.yearOffset != null).map(e => (
                      <ReferenceLine key={e.id} x={e.yearOffset}
                        stroke={e.type === "retirement" ? C.accent : C.lineHi}
                        strokeDasharray={e.type === "retirement" ? "0" : "3 3"}
                        strokeWidth={e.type === "retirement" ? 1.5 : 1}
                        label={{ value: e.name, position: "top", dy: (eventLaneMap[e.id] || 0) * 18, fill: e.type === "retirement" ? C.accent : C.textMute, fontSize: 13, fontFamily: "Inter Tight", fontWeight: 400 }}
                      />
                    ))}
                  </ComposedChart>
                ) : (
                <AreaChart data={displayedProjection} margin={{ top: 36, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    {CATEGORY_ORDER.map(cat => (
                      <linearGradient key={cat} id={`grad-${cat}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CATEGORY_META[cat].color} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={CATEGORY_META[cat].color} stopOpacity={0.35} />
                      </linearGradient>
                    ))}
                    <linearGradient id="grad-net" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.accent} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={C.accent} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="grad-liabilities" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.danger} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={C.danger} stopOpacity={0.05} />
                    </linearGradient>
                    {/* Per-loan gradients — same red hue, varying opacity per loan for visual distinction */}
                    {loanList.map(loan => (
                      <linearGradient key={loan.key} id={`grad-loan-${loan.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.danger} stopOpacity={loan.gradTop} />
                        <stop offset="100%" stopColor={C.danger} stopOpacity={loan.gradBot} />
                      </linearGradient>
                    ))}
                    {/* Per-asset gradients for per-category stacked views — each asset varies opacity within its category color */}
                    {Object.entries(categoryAssetLists).flatMap(([cat, list]) =>
                      list.map(a => (
                        <linearGradient key={`${cat}-${a.key}`} id={`grad-asset-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CATEGORY_META[cat].color} stopOpacity={a.gradTop} />
                          <stop offset="100%" stopColor={CATEGORY_META[cat].color} stopOpacity={a.gradBot} />
                        </linearGradient>
                      ))
                    )}
                    {/* Cashflow gradients — income green ramp, expenses red/orange ramp */}
                    {CASHFLOW_INCOME.map(s => (
                      <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.85} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0.35} />
                      </linearGradient>
                    ))}
                    {CASHFLOW_EXPENSE.map(s => (
                      <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0.85} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={C.line} strokeDasharray="0" vertical={false} />
                  <XAxis dataKey="year" stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(y) => `+${y}`} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} />
                  <YAxis stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v) => fmt(v)} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} width={60} />
                  <Tooltip content={<CustomTooltip events={state.events} view={view} categoryAssetLists={categoryAssetLists} loanList={loanList} />} />
                  {view === "stacked" && CATEGORY_ORDER.map(cat => (
                    <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={CATEGORY_META[cat].color} strokeWidth={1} fill={`url(#grad-${cat})`} />
                  ))}
                  {view === "net" && (
                    <Area type="monotone" dataKey="netWealth" stroke={C.accent} strokeWidth={2} fill="url(#grad-net)" />
                  )}
                  {view === "liabilities" && loanList.length === 0 && (
                    <Area type="monotone" dataKey="liabilities" stroke={C.danger} strokeWidth={2} fill="url(#grad-liabilities)" />
                  )}
                  {view === "liabilities" && loanList.length > 0 && loanList.map(loan => (
                    <Area
                      key={loan.key}
                      type="monotone"
                      dataKey={`loan_${loan.key}`}
                      stackId="liabilities"
                      stroke={C.danger}
                      strokeWidth={1}
                      fill={`url(#grad-loan-${loan.key})`}
                      name={loan.name}
                    />
                  ))}
                  {CATEGORY_ORDER.includes(view) && (categoryAssetLists[view] || []).length === 0 && (
                    <Area type="monotone" dataKey={view} stroke={CATEGORY_META[view].color} strokeWidth={2} fill={`url(#grad-${view})`} />
                  )}
                  {CATEGORY_ORDER.includes(view) && (categoryAssetLists[view] || []).length > 0 && (categoryAssetLists[view] || []).map(a => (
                    <Area
                      key={a.key}
                      type="monotone"
                      dataKey={a.key}
                      stackId={`cat-${view}`}
                      stroke={CATEGORY_META[view].color}
                      strokeWidth={1}
                      fill={`url(#grad-asset-${a.key})`}
                      name={a.name}
                    />
                  ))}
                  {selectedYear != null && (
                    <ReferenceLine
                      x={selectedYear}
                      stroke={C.selection}
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      ifOverflow="extendDomain"
                      label={{ value: `▼ Yr +${selectedYear}`, position: "top", fill: C.selection, fontSize: 10, fontFamily: "JetBrains Mono", fontWeight: 500 }}
                    />
                  )}
                  {state.events.map(e => (
                    <ReferenceLine key={e.id} x={e.yearOffset}
                      stroke={e.type === "retirement" ? C.accent : C.lineHi}
                      strokeDasharray={e.type === "retirement" ? "0" : "3 3"}
                      strokeWidth={e.type === "retirement" ? 1.5 : 1}
                      label={{ value: e.name, position: "top", dy: (eventLaneMap[e.id] || 0) * 18, fill: e.type === "retirement" ? C.accent : C.textMute, fontSize: 13, fontFamily: "Inter Tight", fontWeight: 400 }}
                    />
                  ))}
                </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Year slider — aligned to chart plot area (Y-axis width=60, right margin=10) */}
            <div style={{ paddingLeft: 60, paddingRight: 10, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase" }}>Reference year</div>
                <div className="mono" style={{ fontSize: 12, color: C.selection }}>
                  Year +{selectedYear ?? state.meta.horizonYears} · Age {(selectedYear ?? state.meta.horizonYears) + state.meta.currentAge}
                </div>
              </div>
              <input
                type="range"
                className="slider slider-selection"
                min={0}
                max={state.meta.horizonYears}
                value={selectedYear ?? state.meta.horizonYears}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                style={{ width: "100%", display: "block" }}
              />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
              {CATEGORY_ORDER.map(cat => {
                const m = CATEGORY_META[cat];
                const val = currentRow[cat] || 0;
                const pct = currentRow.totalAssets > 0 ? (val / currentRow.totalAssets * 100) : 0;
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 10, height: 10, background: m.color }} />
                    <div>
                      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.1em", textTransform: "uppercase" }}>{m.label}</div>
                      <div className="mono" style={{ fontSize: 12, color: C.text }}>{fmt(val)} <span style={{ color: C.textMute }}>· {pct.toFixed(0)}%</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "24px 32px", borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div>
                <div className="serif" style={{ fontSize: 20, fontStyle: "italic", fontWeight: 500 }}>Life events</div>
                <div style={{ color: C.textMute, fontSize: 11, marginTop: 2, letterSpacing: "0.05em" }}>Drag sliders to reshape the timeline</div>
              </div>
              <button onClick={addEvent} className="fp-btn" style={btnGhost}>
                <Plus size={13} /> Add event
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <DragList
                items={state.events}
                getKey={(ev) => ev.id}
                onReorder={reorderEvents}
                render={(ev) => (
                  <EventRow ev={ev} maxYear={state.meta.horizonYears} currentAge={state.meta.currentAge} earners={state.earners}
                    editing={editingEvent === ev.id}
                    onEdit={() => setEditingEvent(editingEvent === ev.id ? null : ev.id)}
                    onChange={(patch) => updateEvent(ev.id, patch)}
                    onRemove={() => removeEvent(ev.id)}
                  />
                )}
              />
            </div>
          </div>
        </div>

        <div>
          <Section title="Income" subtitle="Salary · base + bonus · tax" onAdd={addEarner}>
            <DragList
              items={state.earners}
              getKey={(e) => e.id}
              onReorder={reorderEarners}
              render={(e) => (
                <EarnerRow e={e} currentRow={currentRow}
                  equityAssets={state.assets.filter(a => a.category === "equities")}
                  editing={editingEarner === e.id}
                  onEdit={() => setEditingEarner(editingEarner === e.id ? null : e.id)}
                  onChange={(patch) => updateEarner(e.id, patch)}
                  onRemove={() => removeEarner(e.id)}
                  canRemove={state.earners.length > 1}
                />
              )}
            />
          </Section>

          <Section title="Superannuation" subtitle="Concessional & non-concessional · ATO caps · 15% contribs tax" onAdd={addSuper} bordered>
            <DragList
              items={state.assets.filter(a => a.category === "super")}
              getKey={(a) => a.id}
              onReorder={(next) => reorderAssets((a) => a.category === "super", next)}
              render={(a) => (
                <AssetRow a={a} earners={state.earners}
                  editing={editingAsset === a.id}
                  onEdit={() => setEditingAsset(editingAsset === a.id ? null : a.id)}
                  onChange={(patch) => updateAsset(a.id, patch)}
                  onRemove={() => removeAsset(a.id)}
                />
              )}
            />
          </Section>

          <Section title="Assets" subtitle="Property · equities · cash · other" onAdd={addAsset} bordered>
            <DragList
              items={state.assets.filter(a => a.category !== "super")}
              getKey={(a) => a.id}
              onReorder={(next) => reorderAssets((a) => a.category !== "super", next)}
              render={(a) => (
                <AssetRow a={a} earners={state.earners}
                  editing={editingAsset === a.id}
                  onEdit={() => setEditingAsset(editingAsset === a.id ? null : a.id)}
                  onChange={(patch) => updateAsset(a.id, patch)}
                  onRemove={() => removeAsset(a.id)}
                />
              )}
            />
          </Section>

          <Section title="School fees" subtitle="Per child · fees grow annually" onAdd={addKid} bordered>
            <DragList
              items={state.kids}
              getKey={(k) => k.id}
              onReorder={reorderKids}
              render={(k) => (
                <KidRow k={k}
                  editing={editingKid === k.id}
                  onEdit={() => setEditingKid(editingKid === k.id ? null : k.id)}
                  onChange={(patch) => updateKid(k.id, patch)}
                  onRemove={() => removeKid(k.id)}
                />
              )}
            />
          </Section>

          <Section title="Living expenses" subtitle="Per-item · each with own growth and time window" onAdd={addExpense} bordered>
            <DragList
              items={state.expenses || []}
              getKey={(x) => x.id}
              onReorder={reorderExpenses}
              render={(x) => (
                <ExpenseRow x={x}
                  editing={editingExpense === x.id}
                  onEdit={() => setEditingExpense(editingExpense === x.id ? null : x.id)}
                  onChange={(patch) => updateExpense(x.id, patch)}
                  onRemove={() => removeExpense(x.id)}
                />
              )}
            />
          </Section>

          <Section title="Other debts" subtitle="Non-property loans · credit, margin, etc." onAdd={addLiab} bordered>
            <DragList
              items={state.liabilities}
              getKey={(l) => l.id}
              onReorder={reorderLiabilities}
              render={(l) => (
                <LiabRow l={l} earners={state.earners}
                  editing={editingLiab === l.id}
                  onEdit={() => setEditingLiab(editingLiab === l.id ? null : l.id)}
                  onChange={(patch) => updateLiab(l.id, patch)}
                  onRemove={() => removeLiab(l.id)}
                />
              )}
            />
          </Section>
        </div>
      </div>
      )}

      {activeTab === "logic" && (
        <LogicTab state={state} currentRow={currentRow} selectedYear={selectedYear ?? state.meta.horizonYears} setSelectedYear={setSelectedYear} />
      )}

      {activeTab === "trace" && (
        <TraceTab state={state} currentRow={currentRow} selectedYear={selectedYear ?? state.meta.horizonYears} setSelectedYear={setSelectedYear} />
      )}

      <footer style={{ padding: "20px 32px", borderTop: `1px solid ${C.line}`, color: C.textMute, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>Scenarios persist locally · auto-saved · use Save/Load for file backup</div>
        <div className="serif" style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "0.02em" }}>
          Projections are illustrative. Not financial advice.
        </div>
      </footer>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 100,
          background: toast.kind === "err" ? "#2B1A1A" : toast.kind === "warn" ? "#2B251A" : "#1A2B20",
          border: `1px solid ${toast.kind === "err" ? C.danger : toast.kind === "warn" ? C.accent : C.good}`,
          color: C.text, padding: "12px 18px", fontSize: 12, letterSpacing: "0.02em",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 380,
          animation: "fadeIn 0.25s ease",
        }}>
          {toast.msg}
        </div>
      )}

      {confirmModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: C.panel, border: `1px solid ${C.lineHi}`, padding: 24,
            maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}>
            <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>{confirmModal.title || "Confirm"}</div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20, lineHeight: 1.5 }}>{confirmModal.msg}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { confirmModal.onCancel?.(); setConfirmModal(null); }} className="fp-btn" style={btnGhost}>
                {confirmModal.cancelLabel || "Cancel"}
              </button>
              {confirmModal.altLabel && (
                <button onClick={() => { confirmModal.onAlt?.(); setConfirmModal(null); }} className="fp-btn" style={btnGhost}>
                  {confirmModal.altLabel}
                </button>
              )}
              <button onClick={() => { confirmModal.onConfirm?.(); setConfirmModal(null); }}
                className="fp-btn"
                style={{ ...btnGhost, background: C.accent, color: C.bg, borderColor: C.accent }}>
                {confirmModal.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {staleConflict && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: C.panel, border: `1px solid ${C.danger}`, padding: 24,
            maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}>
            <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12, color: C.danger }}>Save conflict</div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 16, lineHeight: 1.5 }}>
              The following scenario{staleConflict.conflicts.length === 1 ? " was" : "s were"} edited on another device or browser tab:{" "}
              <strong style={{ color: C.text }}>{staleConflict.conflicts.join(", ")}</strong>.
              Your local changes haven't been saved. Choose how to proceed:
            </div>
            <div style={{ fontSize: 11, color: C.textMute, marginBottom: 20, lineHeight: 1.5 }}>
              <strong>Refresh:</strong> reload the latest version from cloud — local changes will be lost.<br />
              <strong>Download:</strong> save your current state to a file first, then refresh.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  // Download current state, then leave the modal up so user can refresh next
                  downloadJson({ scenarios, active: activeScenario }, "the-ledger-conflict-backup.json");
                  setToast({ kind: "ok", msg: "Backup downloaded — now click Refresh to load latest" });
                }}
                className="fp-btn"
                style={btnGhost}
              >
                Download backup
              </button>
              <button
                onClick={() => {
                  setStaleConflict(null);
                  window.location.reload();
                }}
                className="fp-btn"
                style={{ ...btnGhost, background: C.danger, color: C.bg, borderColor: C.danger }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------
function Section({ title, subtitle, onAdd, bordered, children }) {
  return (
    <div style={{ padding: "24px", borderTop: bordered ? `1px solid ${C.line}` : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div className="serif" style={{ fontSize: 18, fontStyle: "italic", fontWeight: 500 }}>{title}</div>
          {subtitle && <div style={{ color: C.textMute, fontSize: 10, marginTop: 2, letterSpacing: "0.05em" }}>{subtitle}</div>}
        </div>
        <button onClick={onAdd} className="fp-btn" style={btnGhostSm} title={`Add ${title}`} aria-label={`Add ${title}`}><Plus size={12} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </div>
  );
}

// Cashflow-specific tooltip — shows income/expense breakdown for the year, not net wealth.
function CashflowTooltip({ active, payload, label, events }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const activeEvts = events.filter(e => label >= e.yearOffset && label < e.yearOffset + (e.duration || 1));
  const totalIncome = (row.cf_salary || 0) + (row.cf_cashBonus || 0) + (row.cf_assetIncome || 0)
                    + (row.cf_rentalPos || 0) + (row.cf_eventIncome || 0);
  const totalExpense = (row.cf_living || 0) + (row.cf_schoolFees || 0) + (row.cf_loanRepayments || 0)
                     + (row.cf_tax || 0) + (row.cf_rentalNeg || 0) + (row.cf_eventExpense || 0);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.lineHi}`, padding: "12px 14px", minWidth: 260, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
        Year +{label} · Age {row.age}
        {row.allRetired ? " · Both retired" : row.anyRetired ? " · Partial retirement" : ""}
      </div>
      <div className="serif" style={{ fontSize: 20, fontStyle: "italic", color: row.cf_net >= 0 ? C.good : C.danger, marginBottom: 10 }}>
        {row.cf_net >= 0 ? "+" : ""}{fmtFull(row.cf_net)}
      </div>
      <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Income</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {CASHFLOW_INCOME.filter(s => (row[s.key] || 0) !== 0).map(s => (
          <div key={s.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
            <span className="mono" style={{ color: C.good }}>+{fmt(row[s.key] || 0)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, paddingTop: 4, borderTop: `1px dashed ${C.line}`, marginTop: 2 }}>
          <span style={{ color: C.text }}>Total income</span>
          <span className="mono" style={{ color: C.good }}>+{fmt(totalIncome)}</span>
        </div>
      </div>
      <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Expenses</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {CASHFLOW_EXPENSE.filter(s => (row[s.key] || 0) !== 0).map(s => (
          <div key={s.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
            <span className="mono" style={{ color: C.danger }}>{fmt(row[s.key] || 0)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, paddingTop: 4, borderTop: `1px dashed ${C.line}`, marginTop: 2 }}>
          <span style={{ color: C.text }}>Total expenses</span>
          <span className="mono" style={{ color: C.danger }}>{fmt(totalExpense)}</span>
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: C.text }}>Net</span>
        <span className="mono" style={{ color: row.cf_net >= 0 ? C.good : C.danger, fontWeight: 500 }}>
          {row.cf_net >= 0 ? "+" : ""}{fmt(row.cf_net)}
        </span>
      </div>
      {activeEvts.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.line}`, fontSize: 10, color: C.selection }}>
          {activeEvts.map(e => e.name).join(" · ")}
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label, events, view, categoryAssetLists = {}, loanList = [] }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const activeEvts = events.filter(e => label >= e.yearOffset && label < e.yearOffset + (e.duration || 1));

  // Liabilities view: show per-loan breakdown
  if (view === "liabilities") {
    const total = row.liabilities || 0;
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.lineHi}`, padding: "12px 14px", minWidth: 240, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
          Year +{label} · Age {row.age}
          {row.allRetired ? " · Both retired" : row.anyRetired ? " · Partial retirement" : ""}
        </div>
        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
          Total Liabilities
        </div>
        <div className="serif" style={{ fontSize: 20, fontStyle: "italic", color: C.danger, marginBottom: 10 }}>{fmtFull(total)}</div>
        {loanList.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {loanList.map(loan => (
              <div key={loan.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, background: C.danger, opacity: loan.gradTop, display: "inline-block" }} />
                  {loan.name}
                </span>
                <span className="mono">{fmt(row[`loan_${loan.key}`] || 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textMute, fontStyle: "italic" }}>No liabilities</div>
        )}
        {activeEvts.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.line}`, fontSize: 10, color: C.selection }}>
            {activeEvts.map(e => e.name).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  // Per-category view: show only assets in the selected category
  if (CATEGORY_ORDER.includes(view) && view !== "stacked") {
    const meta = CATEGORY_META[view];
    const list = categoryAssetLists[view] || [];
    const total = row[view] || 0;
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.lineHi}`, padding: "12px 14px", minWidth: 240, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
          Year +{label} · Age {row.age}
          {row.allRetired ? " · Both retired" : row.anyRetired ? " · Partial retirement" : ""}
        </div>
        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
          Total {meta.label}
        </div>
        <div className="serif" style={{ fontSize: 20, fontStyle: "italic", color: meta.color, marginBottom: 10 }}>{fmtFull(total)}</div>
        {list.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {list.map(a => (
              <div key={a.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, background: meta.color, opacity: a.gradTop, display: "inline-block" }} />
                  {a.name}
                </span>
                <span className="mono">{fmt(row[a.key] || 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textMute, fontStyle: "italic" }}>No {meta.label.toLowerCase()} assets</div>
        )}
        {activeEvts.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.line}`, fontSize: 10, color: C.selection }}>
            {activeEvts.map(e => e.name).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  const earnerList = row.earnerBreakdown ? Object.values(row.earnerBreakdown) : [];
  const kidList = row.feesByKid ? Object.values(row.feesByKid) : [];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.lineHi}`, padding: "12px 14px", minWidth: 240, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
        Year +{label} · Age {row.age}
        {row.allRetired ? " · Both retired" : row.anyRetired ? " · Partial retirement" : ""}
      </div>
      <div className="serif" style={{ fontSize: 20, fontStyle: "italic", color: C.accent, marginBottom: 10 }}>{fmtFull(row.netWealth)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {CATEGORY_ORDER.map(cat => (
          <div key={cat} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: CATEGORY_META[cat].color, display: "inline-block" }} />
              {CATEGORY_META[cat].label}
            </span>
            <span className="mono">{fmt(row[cat] || 0)}</span>
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: C.textDim }}>Liabilities</span>
          <span className="mono" style={{ color: C.danger }}>-{fmt(row.liabilities)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: C.textDim }}>Net cashflow (→ cash)</span>
          <span className="mono" style={{ color: row.netCashflow >= 0 ? C.good : C.danger }}>
            {row.netCashflow >= 0 ? "+" : ""}{fmt(row.netCashflow)}
          </span>
        </div>
        {((row.drawdownFromCash || 0) + (row.drawdownFromEquities || 0) + (row.drawdownFromSuper || 0)) > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.textDim }}>Drawdown (assets → cash)</span>
            <span className="mono" style={{ color: C.accent }}>
              {fmt((row.drawdownFromCash || 0) + (row.drawdownFromEquities || 0) + (row.drawdownFromSuper || 0))}
            </span>
          </div>
        )}
        {(row.drawdownUnmet || 0) > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.danger }}>Unfunded shortfall</span>
            <span className="mono" style={{ color: C.danger }}>-{fmt(row.drawdownUnmet)}</span>
          </div>
        )}
      </div>
      {earnerList.some(e => e.gross > 0) && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Gross income (AUD)</div>
          {earnerList.map((e, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: e.retired ? C.textMute : C.text }}>
                  {e.name}
                  {e.currency && e.currency !== "AUD" && <span style={{ color: C.selection, marginLeft: 4, fontSize: 9 }}>{e.currency}</span>}
                  {e.retired ? " (retired)" : ""}
                </span>
                <span className="mono" style={{ color: e.retired ? C.textMute : C.text }}>{fmt(e.gross)}</span>
              </div>
              {!e.retired && (e.bonusCash > 0 || e.bonusShares > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, paddingLeft: 8 }}>
                  <span>base{e.bonusCash > 0 ? " · cash bonus" : ""}{e.bonusShares > 0 ? " · share bonus" : ""} · tax</span>
                  <span className="mono">
                    {fmt(e.base)}
                    {e.bonusCash > 0 && ` · ${fmt(e.bonusCash)}`}
                    {e.bonusShares > 0 && ` · ${fmt(e.bonusShares)}`}
                    {` · -${fmt(e.tax)}`}
                  </span>
                </div>
              )}
              {!e.retired && e.bonusShares > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sharePlan, paddingLeft: 8 }}>
                  <span>↳ shares to plan</span>
                  <span className="mono">+{fmt(e.bonusShares)}</span>
                </div>
              )}
              {!e.retired && e.bonusCash === 0 && e.bonusShares === 0 && e.tax > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, paddingLeft: 8 }}>
                  <span>tax</span>
                  <span className="mono">-{fmt(e.tax)}</span>
                </div>
              )}
            </div>
          ))}
          {row.totalTax > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 4, paddingTop: 4, borderTop: `1px dashed ${C.line}` }}>
              <span style={{ color: C.textDim }}>Net income</span>
              <span className="mono" style={{ color: C.good }}>{fmt(row.totalNet)}</span>
            </div>
          )}
        </div>
      )}
      {earnerList.some(e => (e.netSuperIn || 0) > 0) && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Super contributions (net to fund)</div>
          {earnerList.filter(e => (e.netSuperIn || 0) > 0 || (e.totalConcessional || 0) > 0).map((e, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: C.text }}>{e.name}</span>
                <span className="mono" style={{ color: C.good }}>+{fmt(e.netSuperIn || 0)}</span>
              </div>
              {(e.totalConcessional || 0) > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, paddingLeft: 8 }}>
                    <span>concessional gross</span>
                    <span className="mono">{fmt(e.totalConcessional)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, paddingLeft: 16 }}>
                    <span>− 15% fund tax</span>
                    <span className="mono">-{fmt(e.totalConcessional * 0.15)}</span>
                  </div>
                  {e.concessionalExcess > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.danger, paddingLeft: 16 }}>
                      <span>over cap: {fmt(e.concessionalExcess)} (extra MTR tax personal)</span>
                      <span className="mono">stays in fund</span>
                    </div>
                  )}
                </>
              )}
              {(e.totalNonConcessional || 0) > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, paddingLeft: 8 }}>
                    <span>non-concessional</span>
                    <span className="mono">{fmt(e.totalNonConcessional)}</span>
                  </div>
                  {e.nonConcessionalExcess > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.warn || C.textMute, paddingLeft: 16 }}>
                      <span>over cap: {fmt(e.nonConcessionalExcess)}</span>
                      <span className="mono">stays in fund</span>
                    </div>
                  )}
                </>
              )}
              {(e.div293Tax || 0) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.danger, paddingLeft: 8 }}>
                  <span>Div 293</span>
                  <span className="mono">-{fmt(e.div293Tax)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {row.expenseBreakdown && Object.keys(row.expenseBreakdown).length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Living expenses</div>
          {Object.values(row.expenseBreakdown).map((x, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: C.textDim }}>{x.name}</span>
              <span className="mono" style={{ color: C.danger }}>-{fmt(x.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {kidList.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>School fees</div>
          {kidList.map((k, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: C.textDim }}>{k.name}</span>
              <span className="mono" style={{ color: C.danger }}>-{fmt(k.fees)}</span>
            </div>
          ))}
        </div>
      )}
      {activeEvts.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Active events</div>
          {activeEvts.map(e => (<div key={e.id} style={{ fontSize: 11, color: C.text, fontStyle: "italic" }}>· {e.name}</div>))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix, color, emphasis }) {
  return (
    <div style={{ background: C.bg, padding: "16px 20px" }}>
      <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div className={emphasis ? "serif" : "mono"} style={{
        fontSize: emphasis ? 28 : 18,
        fontStyle: emphasis ? "italic" : "normal",
        fontWeight: emphasis ? 500 : 400,
        color: color || (emphasis ? C.accent : C.text),
        letterSpacing: emphasis ? "-0.01em" : "0",
      }}>
        {value}<span style={{ color: C.textMute, fontSize: 12, marginLeft: 6, fontFamily: "'JetBrains Mono'" }}>{suffix}</span>
      </div>
    </div>
  );
}

function EventRow({ ev, maxYear, currentAge, earners, editing, onEdit, onChange, onRemove }) {
  const iconFor = (t) => t === "retirement" ? "◆" : t === "lump" ? "◈" : t === "assetSale" ? "⚯" : t === "income" ? "↑" : "●";
  const earnerName = ev.earnerId ? (earners.find(e => e.id === ev.earnerId)?.name || "?") : null;
  const ref = useClickOutside(editing, () => onEdit());
  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "14px 16px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ color: ev.type === "retirement" ? C.accent : C.textDim, fontSize: 14 }}>{iconFor(ev.type)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            {editing ? (
              <input value={ev.name} onClick={(e) => e.stopPropagation()} onChange={e => onChange({ name: e.target.value })} style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "4px 8px", fontSize: 13, flex: 1 }} />
            ) : (
              <div style={{ fontSize: 13, color: C.text }}>{ev.name}</div>
            )}
            <div className="mono" style={{ fontSize: 10, color: C.textMute }}>
              Yr +{ev.yearOffset} · Age {currentAge + ev.yearOffset}
              {ev.duration > 1 && ev.type !== "retirement" && ` · ${ev.duration}y`}
              {ev.amount > 0 && ev.type !== "retirement" && ` · ${fmt(ev.amount)}`}
              {earnerName && ` · ${earnerName}`}
            </div>
          </div>
          <div style={{ position: "relative", marginTop: 10, height: 20 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <input type="range" className="slider" min={0} max={maxYear} value={ev.yearOffset} onChange={(e) => onChange({ yearOffset: parseInt(e.target.value) })} style={{ width: "100%", position: "absolute", top: 8 }} />
          </div>
          {editing && (
            <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <MiniField label="Type">
                <select value={ev.type} onChange={e => onChange({ type: e.target.value })} style={miniInput}>
                  <option value="expense">Expense (recurring)</option>
                  <option value="income">Income (recurring)</option>
                  <option value="lump">Lump sum (no tax)</option>
                  <option value="assetSale">Asset sale (CGT applies)</option>
                  <option value="retirement">Retirement</option>
                </select>
              </MiniField>
              <MiniField label="Year offset">
                <NumberInput value={ev.yearOffset} onChange={(v) => onChange({ yearOffset: v })} style={miniInput} integer />
              </MiniField>
              {ev.type !== "retirement" && (
                <>
                  <MiniField label="Duration (yrs)">
                    <NumberInput value={ev.duration} onChange={(v) => onChange({ duration: v })} style={miniInput} integer />
                  </MiniField>
                  <MiniField label={ev.type === "assetSale" ? "Sale proceeds" : "Amount"}>
                    <NumberInput value={ev.amount} onChange={(v) => onChange({ amount: v })} style={miniInput} />
                  </MiniField>
                </>
              )}
              {(ev.type === "lump" || ev.type === "assetSale") && (
                <MiniField label="Lands in">
                  <select value={ev.category || "cash"} onChange={e => onChange({ category: e.target.value })} style={miniInput}>
                    {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
                  </select>
                </MiniField>
              )}
              {ev.type === "assetSale" && (
                <>
                  <MiniField label="Cost base">
                    <NumberInput value={ev.costBase || 0} onChange={(v) => onChange({ costBase: v })} style={miniInput} />
                  </MiniField>
                  <MiniField label="Held > 12 months">
                    <select value={ev.heldOverYear !== false ? "yes" : "no"} onChange={e => onChange({ heldOverYear: e.target.value === "yes" })} style={miniInput}>
                      <option value="yes">Yes (50% CGT discount)</option>
                      <option value="no">No (full gain taxed)</option>
                    </select>
                  </MiniField>
                  <MiniField label="Owned by (for CGT)">
                    <select value={ev.ownerId || ""} onChange={e => onChange({ ownerId: e.target.value || null })} style={miniInput}>
                      <option value="">— first AUD earner —</option>
                      {earners.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                    </select>
                  </MiniField>
                </>
              )}
              {ev.type === "retirement" && (
                <MiniField label="Who retires">
                  <select value={ev.earnerId || ""} onChange={e => onChange({ earnerId: e.target.value })} style={miniInput}>
                    <option value="">— select —</option>
                    {earners.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                  </select>
                </MiniField>
              )}
            </div>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostSm, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={11} /></button>
      </div>
    </div>
  );
}

function EarnerRow({ e, currentRow, equityAssets = [], editing, onEdit, onChange, onRemove, canRemove }) {
  const br = currentRow.earnerBreakdown?.[e.id];
  const ccy = e.currency || "AUD";
  const isSG = ccy === "SGD";
  // Local-currency display values
  const baseLocal = br?.baseLocal ?? e.salary;
  const bonusCashLocal = br?.bonusCashLocal ?? (e.salary * ((e.bonusRateCash || 0) / 100));
  const bonusSharesLocal = br?.bonusSharesLocal ?? (e.salary * ((e.bonusRateShares || 0) / 100));
  const bonusLocal = br?.bonusLocal ?? (bonusCashLocal + bonusSharesLocal);
  const grossLocal = br?.grossLocal ?? (baseLocal + bonusLocal);
  const taxLocal = br?.taxLocal ?? 0;
  const netLocal = br?.netLocal ?? (grossLocal - taxLocal);
  // AUD-equivalent values (post-FX)
  const grossAud = br?.gross ?? grossLocal;
  const netAud = br?.net ?? netLocal;
  const fx = br?.fx ?? 1;

  const taxModeLabel = (() => {
    if (e.taxMode === "flat") return `${e.taxRate}% flat`;
    if (e.taxMode === "sg") return "SG IRAS";
    return "ATO 2025–26";
  })();

  const ref = useClickOutside(editing, () => onEdit());
  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: C.accent }}><User size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.text }}>
              {e.name}
              {isSG && <span style={{ color: C.textMute, fontSize: 10, marginLeft: 6, letterSpacing: "0.1em" }}>SG</span>}
              {br?.retired && <span style={{ color: C.textMute, fontStyle: "italic", marginLeft: 6 }}>retired</span>}
            </div>
            <div className="mono" style={{ fontSize: 12, color: br?.retired ? C.textMute : C.text }}>{fmtCcy(grossLocal, ccy)}</div>
          </div>
          {!br?.retired && (
            <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>
              {fmtCcy(baseLocal, ccy)}
              {bonusCashLocal > 0 && ` + ${fmtCcy(bonusCashLocal, ccy)} cash`}
              {bonusSharesLocal > 0 && ` + ${fmtCcy(bonusSharesLocal, ccy)} shares`}
              {taxLocal > 0 && ` − ${fmtCcy(taxLocal, ccy)} tax`}
              {` = ${fmtCcy(netLocal, ccy)} net`}
            </div>
          )}
          {!br?.retired && isSG && (
            <div className="mono" style={{ fontSize: 10, color: C.selection, marginTop: 2 }}>
              ↳ AUD: {fmt(grossAud)} gross · {fmt(netAud)} net @ {fx.toFixed(3)} SGD/AUD
            </div>
          )}
          <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2, opacity: 0.7 }}>
            {e.salaryGrowth}% growth · {taxModeLabel}
            {!isSG && ` · ${(e.superSgRate ?? 12)}% SG`}
            {!isSG && (e.superExtraConcessionalRate || 0) > 0 && ` + ${e.superExtraConcessionalRate}% conc`}
            {!isSG && (e.superMatchConcessionalRate || 0) > 0 && ` + ${e.superMatchConcessionalRate}% match-c`}
            {!isSG && (e.superExtraNonConcessionalRate || 0) > 0 && ` + ${e.superExtraNonConcessionalRate}% NCC`}
            {!isSG && (e.superMatchNonConcessionalRate || 0) > 0 && ` + ${e.superMatchNonConcessionalRate}% match-nc`}
            {isSG && " · no super (SG)"}
          </div>
        </div>
        {canRemove && <button onClick={(ev) => { ev.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={10} /></button>}
      </div>
      {editing && (
        <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <MiniField label="Name"><input value={e.name} onChange={ev => onChange({ name: ev.target.value })} style={miniInput} /></MiniField>
          <MiniField label="Country / currency">
            <select value={ccy} onChange={ev => {
              const newCcy = ev.target.value;
              // When switching country, default tax mode to local progressive
              const patch = { currency: newCcy };
              if (newCcy === "SGD" && (e.taxMode === "ato" || !e.taxMode)) patch.taxMode = "sg";
              if (newCcy === "AUD" && e.taxMode === "sg") patch.taxMode = "ato";
              onChange(patch);
            }} style={miniInput}>
              <option value="AUD">Australia (AUD)</option>
              <option value="SGD">Singapore (SGD)</option>
            </select>
          </MiniField>
          <MiniField label={`Base salary (${ccy})`}>
            <NumberInput value={e.salary} onChange={(v) => onChange({ salary: v })} style={miniInput} />
          </MiniField>
          <MiniField label="Salary growth %"><NumberInput step={0.1} value={e.salaryGrowth} onChange={(v) => onChange({ salaryGrowth: v })} style={miniInput} /></MiniField>
          <MiniField label="Cash bonus % of base"><NumberInput step={0.5} value={e.bonusRateCash || 0} onChange={(v) => onChange({ bonusRateCash: v })} style={miniInput} /></MiniField>
          <MiniField label="Share bonus % of base"><NumberInput step={0.5} value={e.bonusRateShares || 0} onChange={(v) => onChange({ bonusRateShares: v })} style={miniInput} /></MiniField>
          {(e.bonusRateShares || 0) > 0 && (
            <MiniField label="Shares vest into">
              <select value={e.sharePlanAssetId || ""} onChange={ev => onChange({ sharePlanAssetId: ev.target.value || null })} style={miniInput}>
                <option value="">— first Shares asset —</option>
                {equityAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </MiniField>
          )}
          {(e.bonusRateShares || 0) > 0 && equityAssets.length === 0 && (
            <div style={{ gridColumn: "1 / -1", fontSize: 10, color: C.danger, padding: "6px 10px", background: "#2a1818", border: `1px solid ${C.danger}`, marginTop: 4 }}>
              ⚠ Share bonus is set but there's no Shares asset to vest into. Add a Shares asset under Assets to track these.
            </div>
          )}
          <MiniField label="Tax method">
            <select value={e.taxMode || (isSG ? "sg" : "ato")} onChange={ev => onChange({ taxMode: ev.target.value })} style={miniInput}>
              {!isSG && <option value="ato">ATO 2025–26 progressive + Medicare</option>}
              {isSG && <option value="sg">Singapore IRAS resident YA2026</option>}
              <option value="flat">Flat effective rate</option>
            </select>
          </MiniField>
          {!isSG && (e.taxMode || "ato") === "ato" && (
            <MiniField label="Private health insurance">
              <select value={e.hasPrivateHealth !== false ? "yes" : "no"} onChange={ev => onChange({ hasPrivateHealth: ev.target.value === "yes" })} style={miniInput}>
                <option value="yes">Yes (no MLS)</option>
                <option value="no">No (MLS applies above thresholds)</option>
              </select>
            </MiniField>
          )}
          {(e.taxMode === "flat") && (
            <MiniField label="Flat tax %"><NumberInput step={0.5} value={e.taxRate} onChange={(v) => onChange({ taxRate: v })} style={miniInput} /></MiniField>
          )}
          {!isSG && (
            <>
              <div style={{ gridColumn: "1 / -1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
                  Superannuation contributions
                </div>
              </div>
              {/* Row 1: SG % | SG includes bonus toggle */}
              <MiniField label="Super Guarantee %">
                <NumberInput step={0.1} value={e.superSgRate ?? 12} onChange={(v) => onChange({ superSgRate: v })} style={miniInput} />
              </MiniField>
              <MiniField label="Super Guarantee calculated on">
                <select value={e.superSgIncludesBonus ? "gross" : "base"} onChange={ev => onChange({ superSgIncludesBonus: ev.target.value === "gross" })} style={miniInput}>
                  <option value="base">Base salary only (default)</option>
                  <option value="gross">Base + bonus</option>
                </select>
              </MiniField>
              {/* Row 2: Personal concessional | Matched concessional */}
              <MiniField label="Personal concessional %">
                <NumberInput step={0.5} value={e.superExtraConcessionalRate || 0} onChange={(v) => onChange({ superExtraConcessionalRate: v })} style={miniInput} />
              </MiniField>
              <MiniField label="Matched concessional %">
                <NumberInput step={0.5} value={e.superMatchConcessionalRate || 0} onChange={(v) => onChange({ superMatchConcessionalRate: v })} style={miniInput} />
              </MiniField>
              {/* Row 3: Personal non-concessional | Matched non-concessional */}
              <MiniField label="Personal non-concessional %">
                <NumberInput step={0.5} value={e.superExtraNonConcessionalRate || 0} onChange={(v) => onChange({ superExtraNonConcessionalRate: v })} style={miniInput} />
              </MiniField>
              <MiniField label="Matched non-concessional %">
                <NumberInput step={0.5} value={e.superMatchNonConcessionalRate || 0} onChange={(v) => onChange({ superMatchNonConcessionalRate: v })} style={miniInput} />
              </MiniField>
              {br && !br.retired && (br.totalConcessional > 0 || br.totalNonConcessional > 0) && (
                <div style={{ gridColumn: "1 / -1", marginTop: 6, padding: 10, background: C.bg, border: `1px solid ${C.line}` }}>
                  <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>This year — at year +{currentRow.year}</div>
                  <div className="mono" style={{ fontSize: 11, lineHeight: 1.6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.textDim }}>Concessional total</span>
                      <span style={{ color: br.concessionalExcess > 0 ? C.danger : C.text }}>
                        {fmt(br.totalConcessional)}
                        {br.concessionalExcess > 0 && <span style={{ color: C.danger, marginLeft: 4 }}>({fmt(br.concessionalExcess)} over cap)</span>}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: C.textMute, fontSize: 10, paddingLeft: 8 }}>
                      <span>Super Guarantee · sal-sac · match</span>
                      <span>{fmt(br.sgContrib)} · {fmt(br.extraConcessional)} · {fmt(br.totalConcessional - br.sgContrib - br.extraConcessional)}</span>
                    </div>
                    {br.concessionalTax > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", color: C.textMute, fontSize: 10, paddingLeft: 8 }}>
                        <span>15% contribs tax</span>
                        <span>-{fmt(br.concessionalTax)}</span>
                      </div>
                    )}
                    {br.div293Tax > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", color: C.danger, fontSize: 10, paddingLeft: 8 }}>
                        <span>Div 293 (extra 15%)</span>
                        <span>-{fmt(br.div293Tax)}</span>
                      </div>
                    )}
                    {br.totalNonConcessional > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ color: C.textDim }}>Non-concessional total</span>
                        <span style={{ color: br.nonConcessionalExcess > 0 ? C.danger : C.text }}>
                          {fmt(br.totalNonConcessional)}
                          {br.nonConcessionalExcess > 0 && <span style={{ color: C.danger, marginLeft: 4 }}>({fmt(br.nonConcessionalExcess)} over cap)</span>}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.line}` }}>
                      <span style={{ color: C.text }}>Net into super</span>
                      <span style={{ color: C.good }}>{fmt(br.netSuperIn)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KidRow({ k, editing, onEdit, onChange, onRemove }) {
  const ref = useClickOutside(editing, () => onEdit());
  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: C.other }}><GraduationCap size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.text }}>{k.name}</div>
            <div className="mono" style={{ fontSize: 12, color: k.yearsRemaining > 0 ? C.text : C.textMute }}>{fmt(k.annualFees)}/yr</div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>
            {k.yearsRemaining > 0 ? `${k.yearsRemaining} years remaining` : "Finished school"} · {k.feeGrowth}% indexation
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={10} /></button>
      </div>
      {editing && (
        <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <MiniField label="Name"><input value={k.name} onChange={e => onChange({ name: e.target.value })} style={miniInput} /></MiniField>
          <MiniField label="Annual fees"><NumberInput value={k.annualFees} onChange={(v) => onChange({ annualFees: v })} style={miniInput} /></MiniField>
          <MiniField label="Years remaining"><NumberInput value={k.yearsRemaining} onChange={(v) => onChange({ yearsRemaining: v })} style={miniInput} integer /></MiniField>
          <MiniField label="Fee growth %"><NumberInput step={0.1} value={k.feeGrowth} onChange={(v) => onChange({ feeGrowth: v })} style={miniInput} /></MiniField>
        </div>
      )}
    </div>
  );
}

function ExpenseRow({ x, editing, onEdit, onChange, onRemove }) {
  const startY = x.startYear ?? 0;
  const endY = x.endYear;
  const windowLabel = endY == null
    ? (startY === 0 ? "ongoing" : `starts yr +${startY}`)
    : `yr +${startY}–${endY}`;
  const ref = useClickOutside(editing, () => onEdit());
  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: C.cash }}><DollarSign size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.text }}>{x.name}</div>
            <div className="mono" style={{ fontSize: 12, color: C.text }}>{fmt(x.amount)}/yr</div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>
            {x.growth}% growth · {windowLabel}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={10} /></button>
      </div>
      {editing && (
        <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <MiniField label="Name"><input value={x.name} onChange={e => onChange({ name: e.target.value })} style={miniInput} /></MiniField>
          <MiniField label="Annual amount"><NumberInput value={x.amount} onChange={(v) => onChange({ amount: v })} style={miniInput} /></MiniField>
          <MiniField label="Growth %"><NumberInput step={0.1} value={x.growth} onChange={(v) => onChange({ growth: v })} style={miniInput} /></MiniField>
          <MiniField label="Start year">
            <NumberInput value={x.startYear ?? 0} onChange={(v) => onChange({ startYear: v })} style={miniInput} integer />
          </MiniField>
          <MiniField label="End year (blank = forever)">
            <NumberInput value={x.endYear} placeholder="—" onChange={(v) => onChange({ endYear: v })} style={miniInput} integer allowEmpty />
          </MiniField>
        </div>
      )}
    </div>
  );
}

function AssetRow({ a, earners, editing, onEdit, onChange, onRemove }) {
  const meta = CATEGORY_META[a.category];
  const earnerName = a.earnerId ? earners.find(e => e.id === a.earnerId)?.name : null;
  const isProperty = a.category === "primaryResidence" || a.category === "investmentProperty" || a.category === "property";
  const isInvestmentProperty = a.category === "investmentProperty";
  const isOffset = a.category === "offset";
  // Normalise loans: support legacy a.loan by folding it into a.loans
  const loans = Array.isArray(a.loans)
    ? a.loans
    : (a.loan ? [a.loan] : []);
  const totalLoanBalance = loans.reduce((s, l) => s + (l.balance || 0), 0);
  const netEquity = a.value - totalLoanBalance;

  const updateLoan = (loanId, patch) => {
    const next = loans.map(l => l.id === loanId ? { ...l, ...patch } : l);
    onChange({ loans: next, loan: undefined });
  };
  const addLoan = () => {
    const newLoan = {
      id: genId("ln"),
      balance: 0, originalBalance: 0,
      rate: 6, type: "pi", termYears: 30,
      // Investment loan flag follows the property category
      isInvestment: isInvestmentProperty,
    };
    onChange({ loans: [...loans, newLoan], loan: undefined });
  };
  const removeLoan = (loanId) => {
    onChange({ loans: loans.filter(l => l.id !== loanId), loan: undefined });
  };
  const ref = useClickOutside(editing, () => onEdit());

  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 3, height: 28, background: meta.color }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div className="mono" style={{ fontSize: 12, color: C.text }}>{fmt(a.value)}</div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>
            {meta.label}{!isOffset && ` · ${a.growth}% growth`}
            {!isOffset && a.income > 0 && ` · ${fmt(a.income)}/yr income`}
            {earnerName && ` · ${earnerName}`}
          </div>
          {loans.filter(l => l.balance > 0).map((l, i) => (
            <div key={l.id || i} className="mono" style={{ fontSize: 10, color: C.danger, marginTop: 3, display: "flex", justifyContent: "space-between" }}>
              <span>↳ Loan{loans.length > 1 ? ` ${i + 1}` : ""}: -{fmt(l.balance)} @ {l.rate}% {(l.type || "pi") === "io" ? `IO ${l.ioPeriod ?? 5}y → P&I ${(l.termYears || 30) - (l.ioPeriod ?? 5)}y` : `P&I ${l.termYears || 30}y`} · {fmt(computeAnnualPayment(l))}/yr</span>
            </div>
          ))}
          {totalLoanBalance > 0 && (
            <div className="mono" style={{ fontSize: 10, color: C.good, marginTop: 3, textAlign: "right" }}>
              equity {fmt(netEquity)}
            </div>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={10} /></button>
      </div>
      {editing && (
        <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <MiniField label="Name"><input value={a.name} onChange={e => onChange({ name: e.target.value })} style={miniInput} /></MiniField>
          <MiniField label="Category">
            <select value={a.category} onChange={e => onChange({ category: e.target.value })} style={miniInput}>
              {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
            </select>
          </MiniField>
          <MiniField label="Value"><NumberInput value={a.value} onChange={(v) => onChange({ value: v })} style={miniInput} /></MiniField>
          {!isOffset && <MiniField label="Growth %"><NumberInput step={0.1} value={a.growth} onChange={(v) => onChange({ growth: v })} style={miniInput} /></MiniField>}
          {/* Income field varies by category */}
          {!isOffset && (a.category === "equities") && (
            <MiniField label="Dividend yield %">
              <NumberInput step={0.1} value={a.dividendYield ?? (a.category === "equities" ? 4 : 0)} onChange={(v) => onChange({ dividendYield: v })} style={miniInput} />
            </MiniField>
          )}
          {/* Annual income: shown for investmentProperty (rent), cash (interest), other; hidden for PR, equities (uses yield), super, offset */}
          {!isOffset && a.category !== "equities" && a.category !== "sharePlan" && a.category !== "primaryResidence" && a.category !== "super" && (
            <MiniField label="Annual income"><NumberInput value={a.income} onChange={(v) => onChange({ income: v })} style={miniInput} /></MiniField>
          )}
          {isOffset && (
            <div style={{ gridColumn: "1 / -1", fontSize: 10, color: C.textMute, padding: "8px 10px", background: C.bg, border: `1px solid ${C.line}`, marginTop: 4 }}>
              Offset accounts don't earn growth or income. Their benefit is reducing loan interest. Link this asset to a loan via the loan's "Offset from" field.
            </div>
          )}
          {/* Franking — for equities (yield-based) only. Not shown for property/cash/super where franking doesn't apply. */}
          {!isOffset && a.category === "equities" && (a.dividendYield ?? 0) > 0 && (
            <>
              <MiniField label="Fully franked?">
                <select value={(a.frankedRate ?? 0) === 100 ? "yes" : (a.frankedRate ?? 0) === 0 ? "no" : "partial"} onChange={ev => {
                  const v = ev.target.value;
                  if (v === "yes") onChange({ frankedRate: 100 });
                  else if (v === "no") onChange({ frankedRate: 0 });
                  // "partial" leaves the existing partial value
                }} style={miniInput}>
                  <option value="yes">Yes (100% — AU domiciled)</option>
                  <option value="no">No (0% — foreign)</option>
                  <option value="partial">Partial (set % below)</option>
                </select>
              </MiniField>
              {(a.frankedRate ?? 0) !== 100 && (a.frankedRate ?? 0) !== 0 && (
                <MiniField label="Franked %">
                  <NumberInput step={5} value={a.frankedRate ?? 0} onChange={(v) => onChange({ frankedRate: v })} style={miniInput} />
                </MiniField>
              )}
            </>
          )}
          {/* Ownership editor — only for assets that have tax/cashflow implications */}
          {!isOffset && a.category !== "super" && a.category !== "cash" && earners.length > 0 && (
            <div style={{ gridColumn: "1 / -1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
              <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
                Ownership (for tax)
              </div>
              <OwnershipEditor
                earners={earners}
                shares={a.ownershipShares || (a.earnerId ? { [a.earnerId]: 100 } : {})}
                onChange={(shares) => onChange({ ownershipShares: shares, earnerId: null })}
              />
            </div>
          )}
          {a.category === "super" && (
            <MiniField label="Owned by">
              <select value={a.earnerId || ""} onChange={e => onChange({ earnerId: e.target.value })} style={miniInput}>
                <option value="">— unassigned —</option>
                {earners.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </MiniField>
          )}
          {isInvestmentProperty && (
            <MiniField label="Running expenses (yr)">
              <NumberInput value={a.runningExpenses || 0} onChange={(v) => onChange({ runningExpenses: v })} style={miniInput} />
            </MiniField>
          )}
          {isProperty && (
            <div style={{ gridColumn: "1 / -1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                  Attached loans{loans.length > 0 && ` (${loans.length})`}
                </div>
                <button onClick={(e) => { e.stopPropagation(); addLoan(); }} className="fp-btn" style={btnGhostXs}>
                  <Plus size={10} /> Add loan
                </button>
              </div>
              {loans.map((loan, idx) => {
                const loanAnnual = computeAnnualPayment(loan);
                return (
                  <div key={loan.id || idx} style={{ marginBottom: 12, padding: 10, border: `1px solid ${C.line}`, background: C.bg }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        Loan {idx + 1}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeLoan(loan.id); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}>
                        <Trash2 size={10} /> Remove
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                      <MiniField label="Balance"><NumberInput value={loan.balance} onChange={(v) => updateLoan(loan.id, { balance: v })} style={miniInput} /></MiniField>
                      <MiniField label="Rate %"><NumberInput step={0.1} value={loan.rate} onChange={(v) => updateLoan(loan.id, { rate: v })} style={miniInput} /></MiniField>
                      <MiniField label="Type">
                        <select value={loan.type || "pi"} onChange={e => updateLoan(loan.id, { type: e.target.value })} style={miniInput}>
                          <option value="pi">Principal &amp; Interest</option>
                          <option value="io">Interest Only</option>
                        </select>
                      </MiniField>
                      <MiniField label="Total loan term (yrs)">
                        <NumberInput value={loan.termYears || 30} onChange={(v) => updateLoan(loan.id, { termYears: v })} style={miniInput} integer />
                      </MiniField>
                      {(loan.type || "pi") === "io" && (
                        <MiniField label="IO period (yrs)">
                          <NumberInput value={loan.ioPeriod ?? 5} onChange={(v) => updateLoan(loan.id, { ioPeriod: v })} style={miniInput} integer />
                        </MiniField>
                      )}
                      <MiniField label="Offset balance ($)">
                        <NumberInput value={loan.offsetBalance || 0} onChange={(v) => updateLoan(loan.id, { offsetBalance: v })} style={miniInput} />
                      </MiniField>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Annual payment (computed)</div>
                        <div className="mono" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.accent, padding: "6px 8px", fontSize: 12 }}>
                          {fmt(loanAnnual)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiabRow({ l, earners = [], editing, onEdit, onChange, onRemove }) {
  const ref = useClickOutside(editing, () => onEdit());
  const loanAnnual = computeAnnualPayment(l);
  const type = l.type || "pi";
  return (
    <div
      ref={ref}
      className="fp-row"
      onClick={() => onEdit()}
      style={{ border: `1px solid ${editing ? C.lineHi : C.line}`, background: editing ? C.panelHi : C.panel, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 3, height: 28, background: C.danger }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, color: C.text }}>{l.name}</div>
            <div className="mono" style={{ fontSize: 12, color: C.danger }}>-{fmt(l.balance)}</div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>
            {l.rate}% {type === "io" ? `IO ${l.ioPeriod ?? 5}y → P&I ${(l.termYears || 30) - (l.ioPeriod ?? 5)}y` : `P&I ${l.termYears || 30}y`} · {fmt(loanAnnual)}/yr payment{l.isInvestment ? " · investment" : ""}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }} title="Remove" aria-label="Remove"><Trash2 size={10} /></button>
      </div>
      {editing && (
        <div className="fade-in" onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          <MiniField label="Name"><input value={l.name} onChange={e => onChange({ name: e.target.value })} style={miniInput} /></MiniField>
          <MiniField label="Balance"><NumberInput value={l.balance} onChange={(v) => onChange({ balance: v })} style={miniInput} /></MiniField>
          <MiniField label="Rate %"><NumberInput step={0.1} value={l.rate} onChange={(v) => onChange({ rate: v })} style={miniInput} /></MiniField>
          <MiniField label="Type">
            <select value={type} onChange={e => onChange({ type: e.target.value })} style={miniInput}>
              <option value="pi">Principal &amp; Interest</option>
              <option value="io">Interest Only</option>
            </select>
          </MiniField>
          <MiniField label="Total loan term (yrs)">
            <NumberInput value={l.termYears || 30} onChange={(v) => onChange({ termYears: v })} style={miniInput} integer />
          </MiniField>
          {type === "io" && (
            <MiniField label="IO period (yrs)">
              <NumberInput value={l.ioPeriod ?? 5} onChange={(v) => onChange({ ioPeriod: v })} style={miniInput} integer />
            </MiniField>
          )}
          <MiniField label="Investment loan?">
            <select value={l.isInvestment ? "yes" : "no"} onChange={e => onChange({ isInvestment: e.target.value === "yes" })} style={miniInput}>
              <option value="no">No (not deductible)</option>
              <option value="yes">Yes (interest deductible)</option>
            </select>
          </MiniField>
          {l.isInvestment && (
            <MiniField label="Owned by (for tax)">
              <select value={l.earnerId || ""} onChange={e => onChange({ earnerId: e.target.value || null })} style={miniInput}>
                <option value="">— first AUD earner —</option>
                {earners.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </MiniField>
          )}
          <MiniField label="Offset balance ($)">
            <NumberInput value={l.offsetBalance || 0} onChange={(v) => onChange({ offsetBalance: v })} style={miniInput} />
          </MiniField>
          <div>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Annual payment (computed)</div>
            <div className="mono" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.accent, padding: "6px 8px", fontSize: 12 }}>
              {fmt(loanAnnual)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange, step = 1 }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <NumberInput value={value} onChange={onChange} step={step} className="mono" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "8px 10px", fontSize: 13, width: "100%" }} />
    </label>
  );
}

// NumberInput — a controlled numeric input that holds a local string while editing,
// so clearing the field doesn't snap the value back to 0. Commits a number to onChange
// when the string parses to a valid number; on blur, if invalid/empty, commits 0
// (or null if `allowEmpty` is set).
function NumberInput({ value, onChange, step = 1, min, style, className, integer = false, allowEmpty = false, placeholder }) {
  const [str, setStr] = React.useState(value == null ? "" : String(value));
  const focusedRef = React.useRef(false);
  React.useEffect(() => {
    if (!focusedRef.current) setStr(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="number"
      step={step}
      min={min}
      placeholder={placeholder}
      value={str}
      className={className}
      style={style}
      onFocus={() => { focusedRef.current = true; }}
      onChange={e => {
        const v = e.target.value;
        setStr(v);
        if (v === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        if (v === "-" || v === "." || v === "-.") return;
        const parsed = integer ? parseInt(v, 10) : parseFloat(v);
        if (!isNaN(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (str === "") {
          if (allowEmpty) {
            onChange(null);
          } else {
            onChange(0);
            setStr("0");
          }
          return;
        }
        const parsed = integer ? parseInt(str, 10) : parseFloat(str);
        if (isNaN(parsed)) {
          if (allowEmpty) {
            onChange(null);
            setStr("");
          } else {
            onChange(0);
            setStr("0");
          }
        } else {
          setStr(String(parsed));
        }
      }}
    />
  );
}

function MiniField({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{
        fontSize: 9, color: C.textMute, letterSpacing: "0.15em",
        textTransform: "uppercase", marginBottom: 4,
        minHeight: 24, lineHeight: 1.3,
        display: "flex", alignItems: "flex-end",
      }}>{label}</div>
      {children}
    </label>
  );
}

// Ownership editor — small grid showing each earner with a percentage input.
// User-entered shares should sum to 100; we show a warning if they don't, but persist as entered.
// Cash optimisation editor — global setting in Assumptions.
// Configures whether/where to sweep excess cash above a buffer.
function CashOptimisationEditor({ state, setState }) {
  const opt = state.meta?.cashOptimisation || {
    enabled: false, mode: "off", minBuffer: 50000,
    sweepSourceAssetId: null, sweepTargetOffsetLoanKey: null, sweepTargetEquityAssetId: null,
  };
  const update = (patch) => setState(s => ({ ...s, meta: { ...s.meta, cashOptimisation: { ...opt, ...patch } } }));

  // Build dropdown options
  const cashAssets = state.assets.filter(a => a.category === "cash");
  const equityAssets = state.assets.filter(a => a.category === "equities");
  // Build list of all loans-with-offsets (asset-attached + standalone liabilities)
  const offsetLoans = [];
  state.assets.forEach(a => {
    (a.loans || []).forEach(l => {
      if (l.balance > 0) {
        offsetLoans.push({
          key: `asset:${a.id}:${l.id || "ln"}`,
          label: `${a.name} loan (${fmt(l.balance)} @ ${l.rate}%)`,
        });
      }
    });
  });
  state.liabilities.forEach(l => {
    if (l.balance > 0) {
      offsetLoans.push({
        key: `liab:${l.id}`,
        label: `${l.name} (${fmt(l.balance)} @ ${l.rate}%)`,
      });
    }
  });

  const fieldStyle = { background: "#0f0d0a", border: `1px solid ${C.line}`, color: C.text, padding: "6px 8px", fontSize: 12, fontFamily: "Inter Tight", width: "100%" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      <div>
        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Sweep excess cash to</div>
        <select
          value={opt.enabled ? opt.mode : "off"}
          onChange={e => {
            const v = e.target.value;
            if (v === "off") update({ enabled: false, mode: "off" });
            else update({ enabled: true, mode: v });
          }}
          style={fieldStyle}
        >
          <option value="off">Off (cash stays as cash)</option>
          <option value="offset">Offset account</option>
          <option value="equities">Equities</option>
        </select>
      </div>

      {opt.enabled && (
        <>
          <div>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Minimum cash buffer</div>
            <NumberInput value={opt.minBuffer || 0} step={1000} onChange={(v) => update({ minBuffer: v })} style={fieldStyle} />
          </div>

          <div>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Sweep from (cash asset)</div>
            <select value={opt.sweepSourceAssetId || ""} onChange={e => update({ sweepSourceAssetId: e.target.value || null })} style={fieldStyle}>
              <option value="">— select cash asset —</option>
              {cashAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {opt.mode === "offset" && (
            <div>
              <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>Sweep to (offset loan)</div>
              <select value={opt.sweepTargetOffsetLoanKey || ""} onChange={e => update({ sweepTargetOffsetLoanKey: e.target.value || null })} style={fieldStyle}>
                <option value="">— select loan —</option>
                {offsetLoans.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </div>
          )}

          <div>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
              {opt.mode === "offset" ? "Spillover to (equity asset)" : "Sweep to (equity asset)"}
            </div>
            <select value={opt.sweepTargetEquityAssetId || ""} onChange={e => update({ sweepTargetEquityAssetId: e.target.value || null })} style={fieldStyle}>
              <option value="">— select equity asset —</option>
              {equityAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </>
      )}

      {opt.enabled && (
        <div style={{ gridColumn: "1 / -1", fontSize: 10, color: C.textMute, marginTop: 4 }}>
          {opt.mode === "offset" && "At end of each year, cash above the buffer fills the selected offset (capped at loan balance), then any remainder spills to the selected equity asset."}
          {opt.mode === "equities" && "At end of each year, cash above the buffer is added to the selected equity asset."}
        </div>
      )}
    </div>
  );
}

function OwnershipEditor({ earners, shares, onChange }) {
  const sum = Object.values(shares || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const updateShare = (earnerId, value) => {
    const next = { ...shares };
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    if (pct === 0) delete next[earnerId];
    else next[earnerId] = pct;
    onChange(next);
  };
  // Quick action: split evenly across all earners
  const splitEvenly = () => {
    const eligible = earners;
    if (eligible.length === 0) return;
    const each = Math.floor(100 / eligible.length);
    const remainder = 100 - each * eligible.length;
    const next = {};
    eligible.forEach((e, i) => { next[e.id] = each + (i === 0 ? remainder : 0); });
    onChange(next);
  };
  const giveAllTo = (earnerId) => {
    onChange({ [earnerId]: 100 });
  };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: 6 }}>
        {earners.map(en => (
          <React.Fragment key={en.id}>
            <div style={{ fontSize: 11, color: C.text, alignSelf: "center" }}>{en.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <NumberInput step={5} value={shares?.[en.id] ?? 0} onChange={(v) => updateShare(en.id, v)} style={{ ...miniInput, width: 70, textAlign: "right" }} />
              <span style={{ fontSize: 10, color: C.textMute }}>%</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, marginTop: 4 }}>
        <div style={{ color: sum === 100 ? C.textMute : C.danger }}>
          Total: {sum}% {sum !== 100 && "(must be 100)"}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {earners.length > 1 && (
            <button type="button" onClick={splitEvenly} className="fp-btn" style={{ ...btnGhostXs }}>
              Split evenly
            </button>
          )}
          {earners.length === 1 && (
            <button type="button" onClick={() => giveAllTo(earners[0].id)} className="fp-btn" style={{ ...btnGhostXs }}>
              100% to {earners[0].name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const btnGhost = {
  background: "transparent", border: `1px solid ${C.line}`, color: C.textDim,
  padding: "6px 12px", fontSize: 11, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
  letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "inherit",
};
const btnGhostSm = { ...btnGhost, padding: "5px 8px", fontSize: 10 };
const btnGhostXs = { ...btnGhost, padding: "4px 6px", fontSize: 9 };
const btnTab = {
  background: "transparent", border: "none", padding: "5px 14px",
  fontSize: 10, cursor: "pointer", letterSpacing: "0.1em",
  textTransform: "uppercase", fontFamily: "inherit",
};
const miniInput = {
  background: C.bg, border: `1px solid ${C.line}`, color: C.text,
  padding: "6px 8px", fontSize: 12, width: "100%",
  fontFamily: "'JetBrains Mono', monospace",
};

// =================================================================
// LogicTab — visual flow + calculation cards + rates reference
// =================================================================
function LogicTab({ state, currentRow, selectedYear, setSelectedYear }) {
  const earnerList = currentRow.earnerBreakdown ? Object.values(currentRow.earnerBreakdown) : [];
  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header + year scrubber */}
      <div>
        <div className="serif" style={{ fontSize: 22, fontStyle: "italic", fontWeight: 500 }}>Calculation logic</div>
        <div style={{ color: C.textMute, fontSize: 11, marginTop: 4, letterSpacing: "0.05em" }}>
          Live worked examples · using year +{selectedYear} (age {currentRow.age}) · drag the slider below to change reference year
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.panel, border: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase" }}>Year</div>
        <input type="range" className="slider slider-selection" min={0} max={state.meta.horizonYears}
          value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))} style={{ flex: 1 }} />
        <div className="mono" style={{ fontSize: 13, color: C.selection, minWidth: 90, textAlign: "right" }}>+{selectedYear}</div>
      </div>

      {/* Income flow diagram per earner */}
      <div>
        <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>Income flow</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {earnerList.length === 0 && (
            <div style={{ color: C.textMute, fontSize: 12, fontStyle: "italic", padding: 20, textAlign: "center", border: `1px dashed ${C.line}` }}>
              No active earners at this year (all retired).
            </div>
          )}
          {earnerList.map((e, i) => <IncomeFlow key={i} e={e} />)}
        </div>
      </div>

      {/* Calculation cards */}
      <div>
        <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>Calculation cards</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          <TaxCard earnerList={earnerList} />
          <SuperCard earnerList={earnerList} />
          <LoanCard state={state} />
          <AssetGrowthCard state={state} year={selectedYear} />
          <ExpenseCard state={state} year={selectedYear} />
          <FxCard state={state} earnerList={earnerList} />
        </div>
      </div>

      {/* Rates and constants reference */}
      <div>
        <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>Rates & constants</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          <RatesCard title="ATO 2025–26 resident brackets" rows={[
            ["$0 – $18,200", "0%"],
            ["$18,201 – $45,000", "16%"],
            ["$45,001 – $135,000", "30%"],
            ["$135,001 – $190,000", "37%"],
            ["$190,001+", "45%"],
          ]} note="+ 2% Medicare Levy on income above $27,222" />
          <RatesCard title="Singapore IRAS YA2026 resident" rows={[
            ["S$0 – $20,000", "0%"],
            ["$20,001 – $30,000", "2%"],
            ["$30,001 – $40,000", "3.5%"],
            ["$40,001 – $80,000", "7%"],
            ["$80,001 – $120,000", "11.5%"],
            ["$120,001 – $160,000", "15%"],
            ["$160,001 – $200,000", "18%"],
            ["$200,001 – $240,000", "19%"],
            ["$240,001 – $280,000", "19.5%"],
            ["$280,001 – $320,000", "20%"],
            ["$320,001 – $500,000", "22%"],
            ["$500,001 – $1,000,000", "23%"],
            ["$1,000,001+", "24%"],
          ]} note="No Medicare equivalent · CPF not modelled" />
          <RatesCard title="Super constants (FY2025–26)" rows={[
            ["Concessional cap", `$${(state.meta.concessionalCap || CONCESSIONAL_CAP).toLocaleString()}`],
            ["Non-concessional cap", `$${(state.meta.nonConcessionalCap || NONCONCESSIONAL_CAP).toLocaleString()}`],
            ["Contributions tax", "15%"],
            ["Div 293 threshold", `$${DIV293_THRESHOLD.toLocaleString()}`],
            ["Div 293 extra tax", "15%"],
            ["FX rate (AUD/SGD)", (state.meta.fxSgdAud ?? 1.15).toFixed(3)],
          ]} />
        </div>
      </div>

    </div>
  );
}

// Income flow diagram for a single earner
function IncomeFlow({ e }) {
  if (e.retired) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16, color: C.textMute, fontSize: 12 }}>
        <span style={{ fontStyle: "italic" }}>{e.name}</span> — retired, no active income.
      </div>
    );
  }
  const ccy = e.currency || "AUD";
  const fxNote = ccy === "SGD" ? ` (${e.currency} → AUD @ ${e.fx.toFixed(3)})` : "";
  // Compute "destinations" of the gross income
  const tax = e.tax;
  const netSuper = e.netSuperIn || 0;
  const superTaxesOut = (e.concessionalTax || 0) + (e.div293Tax || 0) + (e.excessConcessionalTax || 0);
  const sharesOut = e.bonusShares || 0;
  const ncc = e.nonConcessional || 0; // after-tax money diverted
  const netCash = e.net; // already excludes shares + super taxes + NCC
  // Sanity: totalGross should equal tax + netSuper + superTaxesOut + sharesOut + ncc + netCash + (small rounding)
  // This is the "where every dollar goes" view

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, color: C.text }}>{e.name}</span>
          <span style={{ fontSize: 10, color: C.textMute, marginLeft: 8, letterSpacing: "0.1em" }}>{ccy}{fxNote}</span>
        </div>
        <div className="mono" style={{ fontSize: 14, color: C.accent }}>{fmt(e.gross)} gross</div>
      </div>

      <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>
        base {fmt(e.base)}{e.bonusCash > 0 && ` + cash bonus ${fmt(e.bonusCash)}`}{e.bonusShares > 0 && ` + share bonus ${fmt(e.bonusShares)}`}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <FlowRow color={C.danger} label="Tax (income)" sub="ATO progressive + Medicare 2%" amount={-tax} />
        {netSuper > 0 && <FlowRow color={C.super_} label="Net into super" sub="concessional × 0.85 + non-concessional within cap" amount={+netSuper} />}
        {superTaxesOut > 0 && (
          <FlowRow color={C.danger} label="Super-related tax (Div 293, excess conc.)" sub={`Div 293 ${fmt(e.div293Tax || 0)} + excess ${fmt(e.excessConcessionalTax || 0)}`} amount={-superTaxesOut} />
        )}
        {ncc > 0 && <FlowRow color={C.textMute} label="Non-concessional contribution" sub="paid from after-tax income" amount={-ncc} />}
        {sharesOut > 0 && <FlowRow color={C.sharePlan} label="Shares to Share Plan" sub={`${e.bonusSharesLocal != null ? "share bonus at face value" : ""}`} amount={+sharesOut} />}
        <FlowRow color={C.cash} label="Net cash to household" sub="covers expenses · school fees · loan repayments" amount={+netCash} bold />
      </div>
    </div>
  );
}

function FlowRow({ color, label, sub, amount, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.bg, borderLeft: `2px solid ${color}` }}>
      <div>
        <div style={{ fontSize: 11, color: C.text }}>{label}</div>
        {sub && <div className="mono" style={{ fontSize: 9, color: C.textMute, marginTop: 2 }}>{sub}</div>}
      </div>
      <div className="mono" style={{ fontSize: 13, color, fontWeight: bold ? 500 : 400 }}>
        {amount >= 0 ? "+" : ""}{fmt(amount)}
      </div>
    </div>
  );
}

// Calculation cards
function CalcCard({ title, formula, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
      <div className="serif" style={{ fontSize: 14, fontStyle: "italic", marginBottom: 8 }}>{title}</div>
      {formula && (
        <div className="mono" style={{ fontSize: 11, color: C.accent, padding: "8px 10px", background: C.bg, border: `1px solid ${C.line}`, marginBottom: 10, lineHeight: 1.5 }}>
          {formula}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function TaxCard({ earnerList }) {
  const audEarner = earnerList.find(e => (e.currency || "AUD") === "AUD" && !e.retired);
  const sgEarner = earnerList.find(e => e.currency === "SGD" && !e.retired);
  return (
    <CalcCard title="Tax" formula={"taxable = gross − salary sacrifice (within cap)\ntax = brackets(taxable) + 2% Medicare + MLS (if no health insurance)"}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: C.textMute }}>ATO progressive on taxable income (gross less salary sacrifice within cap). 2% Medicare Levy. Medicare Levy Surcharge of 1.0–1.5% applies for high earners without private hospital cover.</span>
      </div>
      {audEarner && (
        <div className="mono" style={{ fontSize: 11, marginTop: 8, padding: 8, background: C.bg, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.text }}>{audEarner.name} (AUD)</div>
          <div style={{ color: C.textMute }}>gross {fmt(audEarner.gross)}{audEarner.taxDeductibleSacrifice > 0 ? ` − sal-sac ${fmt(audEarner.taxDeductibleSacrifice)}` : ""} → taxable {fmt(audEarner.taxable)}</div>
          <div style={{ color: C.textMute }}>tax {fmt(audEarner.tax)} ({(audEarner.tax / Math.max(1, audEarner.gross) * 100).toFixed(1)}% of gross)</div>
          <div style={{ color: audEarner.hasPrivateHealth ? C.textMute : C.danger, fontSize: 10 }}>
            private health: {audEarner.hasPrivateHealth ? "yes (no MLS)" : "no (MLS applies)"}
          </div>
        </div>
      )}
      {sgEarner && (
        <div className="mono" style={{ fontSize: 11, marginTop: 8, padding: 8, background: C.bg, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.text }}>{sgEarner.name} (SGD)</div>
          <div style={{ color: C.textMute }}>SGD gross {fmt(sgEarner.grossLocal)} → SGD tax {fmt(sgEarner.taxLocal)} ({(sgEarner.taxLocal / Math.max(1, sgEarner.grossLocal) * 100).toFixed(1)}% eff)</div>
          <div style={{ color: C.selection }}>↳ AUD: gross {fmt(sgEarner.gross)} · tax {fmt(sgEarner.tax)}</div>
        </div>
      )}
      {!audEarner && !sgEarner && <span style={{ fontStyle: "italic", color: C.textMute }}>No active earners at this year.</span>}
    </CalcCard>
  );
}

function SuperCard({ earnerList }) {
  const audEarners = earnerList.filter(e => (e.currency || "AUD") === "AUD" && !e.retired && (e.totalConcessional || 0) > 0);
  return (
    <CalcCard title="Super contributions" formula="net into super = conc.×0.85 (within cap) + non-conc. (within cap)">
      <div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: C.textMute }}>Concessional cap: $30k · 15% contribs tax · Div 293 (extra 15%) when income+conc &gt; $250k.</span>
        </div>
        <div>
          <span style={{ color: C.textMute }}>Non-concessional cap: $120k · paid from after-tax income.</span>
        </div>
      </div>
      {audEarners.map((e, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, marginTop: 8, padding: 8, background: C.bg, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.text }}>{e.name}</div>
          <div style={{ color: C.textMute }}>Super Guarantee {fmt(e.sgContrib)} + sal-sac {fmt(e.extraConcessional)} + match-c {fmt(e.matchConcessional || 0)} = conc {fmt(e.totalConcessional)}</div>
          {e.concessionalExcess > 0 && <div style={{ color: C.danger }}>excess conc {fmt(e.concessionalExcess)} (taxed at MTR)</div>}
          <div style={{ color: C.textMute }}>contribs tax {fmt(e.concessionalTax)}{e.div293Tax > 0 && ` + Div 293 ${fmt(e.div293Tax)}`}</div>
          {e.totalNonConcessional > 0 && (
            <div style={{ color: C.textMute }}>non-conc {fmt(e.totalNonConcessional)}{e.nonConcessionalExcess > 0 && ` (excess ${fmt(e.nonConcessionalExcess)} dropped)`}</div>
          )}
          <div style={{ color: C.good, marginTop: 2 }}>→ net into super {fmt(e.netSuperIn)}</div>
        </div>
      ))}
      {audEarners.length === 0 && <span style={{ fontStyle: "italic", color: C.textMute }}>No active super contributions at this year.</span>}
    </CalcCard>
  );
}

function LoanCard({ state }) {
  const allLoans = [];
  state.assets.forEach(a => {
    (a.loans || []).forEach(l => {
      if (l.balance > 0) allLoans.push({ ...l, owner: a.name });
    });
  });
  state.liabilities.forEach(l => {
    if (l.balance > 0) allLoans.push({ ...l, owner: l.name });
  });
  return (
    <CalcCard
      title="Loans"
      formula={"P&I:  payment = P × r / (1 − (1+r)^−n)\nIO:  payment = balance × r"}
    >
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: C.textMute }}>P&I balance amortises down to zero over the term. IO balance stays flat.</span>
      </div>
      {allLoans.map((l, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, marginTop: 8, padding: 8, background: C.bg, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.text }}>{l.owner}</div>
          <div style={{ color: C.textMute }}>
            {fmt(l.balance)} @ {l.rate}% · {(l.type || "pi") === "io" ? `IO ${l.termYears}y` : `P&I ${l.termYears}y`}
          </div>
          <div style={{ color: C.danger }}>annual payment {fmt(computeAnnualPayment(l))}</div>
        </div>
      ))}
      {allLoans.length === 0 && <span style={{ fontStyle: "italic", color: C.textMute }}>No active loans.</span>}
    </CalcCard>
  );
}

function AssetGrowthCard({ state, year }) {
  return (
    <CalcCard title="Asset growth" formula={"value(t) = value(0) × (1 + growth%/100)^t"}>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: C.textMute }}>Compounded annually. Super and Share Plan also receive contributions on top of growth.</span>
      </div>
      {state.assets.slice(0, 6).map((a, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, marginTop: 6, padding: 6, background: C.bg, border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: C.text }}>{a.name}</span>
          <span style={{ color: C.textMute }}>{a.growth}% · {fmt(a.value)} → ~{fmt(a.value * Math.pow(1 + a.growth / 100, year))}</span>
        </div>
      ))}
      {state.assets.length > 6 && <div style={{ color: C.textMute, fontStyle: "italic", marginTop: 6 }}>(+ {state.assets.length - 6} more assets...)</div>}
    </CalcCard>
  );
}

function ExpenseCard({ state, year }) {
  const expenses = (state.expenses || []).filter(x => year >= (x.startYear ?? 0) && (x.endYear == null || year <= x.endYear));
  return (
    <CalcCard title="Living expenses" formula="amount(t) = amount(0) × (1 + growth%)^(t − startYear)">
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: C.textMute }}>Each item compounds at its own growth rate, active during its [startYear, endYear] window.</span>
      </div>
      {expenses.map((x, i) => {
        const t = year - (x.startYear ?? 0);
        const grown = x.amount * Math.pow(1 + (x.growth || 0) / 100, Math.max(0, t));
        return (
          <div key={i} className="mono" style={{ fontSize: 11, marginTop: 6, padding: 6, background: C.bg, border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.text }}>{x.name}</span>
            <span style={{ color: C.textMute }}>{x.growth || 0}% · {fmt(x.amount)} → {fmt(grown)}</span>
          </div>
        );
      })}
      {expenses.length === 0 && <span style={{ fontStyle: "italic", color: C.textMute }}>No active expenses at this year.</span>}
    </CalcCard>
  );
}

function FxCard({ state, earnerList }) {
  const fx = state.meta.fxSgdAud ?? 1.15;
  const sgEarners = earnerList.filter(e => e.currency === "SGD");
  return (
    <CalcCard title="FX conversion" formula={"AUD value = SGD value × fxSgdAud"}>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: C.textMute }}>Net income for Singapore-paid earners is converted to AUD using a single static rate set in Assumptions.</span>
      </div>
      <div className="mono" style={{ fontSize: 11, marginTop: 6, padding: 6, background: C.bg, border: `1px solid ${C.line}` }}>
        <div style={{ color: C.text }}>1 SGD = {fx.toFixed(3)} AUD</div>
        <div style={{ color: C.textMute }}>(adjustable in Assumptions panel)</div>
      </div>
      {sgEarners.map((e, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, marginTop: 6, padding: 6, background: C.bg, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.text }}>{e.name}</div>
          <div style={{ color: C.selection }}>net SGD {fmt(e.netLocal)} × {fx.toFixed(3)} = AUD {fmt(e.net)}</div>
        </div>
      ))}
    </CalcCard>
  );
}

function RatesCard({ title, rows, note }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 14 }}>
      <div className="serif" style={{ fontSize: 13, fontStyle: "italic", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {rows.map(([k, v], i) => (
          <div key={i} className="mono" style={{ fontSize: 10, display: "flex", justifyContent: "space-between", padding: "4px 6px", background: i % 2 === 0 ? C.bg : "transparent" }}>
            <span style={{ color: C.textDim }}>{k}</span>
            <span style={{ color: C.text }}>{v}</span>
          </div>
        ))}
      </div>
      {note && <div style={{ fontSize: 9, color: C.textMute, marginTop: 8, fontStyle: "italic" }}>{note}</div>}
    </div>
  );
}

// =================================================================
// TraceTab — line-by-line calculation trace for selected year
// =================================================================
function TraceTab({ state, currentRow, selectedYear, setSelectedYear }) {
  const earnerList = currentRow.earnerBreakdown ? Object.values(currentRow.earnerBreakdown) : [];
  const expenseList = currentRow.expenseBreakdown ? Object.values(currentRow.expenseBreakdown) : [];

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div className="serif" style={{ fontSize: 22, fontStyle: "italic", fontWeight: 500 }}>Calculation trace</div>
        <div style={{ color: C.textMute, fontSize: 11, marginTop: 4, letterSpacing: "0.05em" }}>
          Step-by-step computation for year +{selectedYear} (age {currentRow.age}) · drag the slider to inspect any year
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.panel, border: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase" }}>Year</div>
        <input type="range" className="slider slider-selection" min={0} max={state.meta.horizonYears}
          value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))} style={{ flex: 1 }} />
        <div className="mono" style={{ fontSize: 13, color: C.selection, minWidth: 90, textAlign: "right" }}>+{selectedYear}</div>
      </div>

      <TraceSection title="Income & tax (per earner)" subtitle="Salary, bonus split, tax calculation, net income.">
        {earnerList.length === 0 && <TraceLine indent={0} label="No active earners" value="—" muted />}
        {earnerList.map((e, i) => (
          <div key={i} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: i < earnerList.length - 1 ? `1px dashed ${C.line}` : "none" }}>
            <TraceLine indent={0} label={`${e.name}${e.currency && e.currency !== "AUD" ? ` (${e.currency})` : ""}${e.retired ? " — retired" : ""}`} value="" header />
            {!e.retired && (
              <>
                <TraceLine indent={1} label="base salary (this year)" value={fmt(e.base)} explain={e.currency === "SGD" ? `${fmt(e.baseLocal)} SGD × ${e.fx.toFixed(3)}` : null} />
                {e.bonusCash > 0 && <TraceLine indent={1} label="cash bonus" value={fmt(e.bonusCash)} explain={`${fmt(e.base)} × cash bonus rate`} />}
                {e.bonusShares > 0 && <TraceLine indent={1} label="share bonus" value={fmt(e.bonusShares)} explain={`${fmt(e.base)} × share bonus rate · routes to Share Plan`} />}
                <TraceLine indent={1} label="gross income" value={fmt(e.gross)} subtotal />
                <TraceLine indent={1} label="− tax" value={`-${fmt(e.tax)}`} negative explain={e.currency === "SGD" ? "Singapore IRAS" : "ATO progressive + Medicare 2%"} />
                {e.div293Tax > 0 && <TraceLine indent={1} label="− Div 293 (extra 15% on conc.)" value={`-${fmt(e.div293Tax)}`} negative explain="income + conc. > $250k" />}
                {e.excessConcessionalTax > 0 && <TraceLine indent={1} label="− excess concessional tax" value={`-${fmt(e.excessConcessionalTax)}`} negative explain="MTR − 15% offset on excess" />}
                {e.bonusShares > 0 && <TraceLine indent={1} label="− share bonus to Share Plan" value={`-${fmt(e.bonusShares)}`} negative explain="shares routed to asset, not net cash" />}
                {e.nonConcessional > 0 && <TraceLine indent={1} label="− non-concessional contribution" value={`-${fmt(e.nonConcessional)}`} negative explain="paid from after-tax income" />}
                <TraceLine indent={1} label="= net cash to household" value={fmt(e.net)} positive />

                {(e.totalConcessional > 0 || e.totalNonConcessional > 0) && (
                  <>
                    <TraceLine indent={1} label="super contributions" value="" header />
                    {e.sgContrib > 0 && <TraceLine indent={2} label="employer Super Guarantee" value={fmt(e.sgContrib)} />}
                    {e.extraConcessional > 0 && <TraceLine indent={2} label="salary sacrifice (concessional)" value={fmt(e.extraConcessional)} />}
                    {e.matchConcessional > 0 && <TraceLine indent={2} label="company match (concessional)" value={fmt(e.matchConcessional)} />}
                    <TraceLine indent={2} label="total concessional" value={fmt(e.totalConcessional)} subtotal />
                    {e.concessionalExcess > 0 && <TraceLine indent={2} label="of which excess" value={fmt(e.concessionalExcess)} muted explain="stays in fund; extra MTR tax paid personally" />}
                    <TraceLine indent={2} label="− 15% fund tax (on full)" value={`-${fmt(e.totalConcessional * 0.15)}`} negative />
                    {e.nonConcessional > 0 && <TraceLine indent={2} label="non-concessional (personal)" value={fmt(e.nonConcessional)} />}
                    {e.matchNonConcessional > 0 && <TraceLine indent={2} label="company match (non-conc.)" value={fmt(e.matchNonConcessional)} />}
                    {e.totalNonConcessional > 0 && <TraceLine indent={2} label="total non-concessional" value={fmt(e.totalNonConcessional)} subtotal />}
                    {e.nonConcessionalExcess > 0 && <TraceLine indent={2} label="of which excess" value={fmt(e.nonConcessionalExcess)} muted explain="stays in fund (no penalty modelled)" />}
                    <TraceLine indent={2} label="= net into super" value={fmt(e.netSuperIn)} positive />
                  </>
                )}
              </>
            )}
          </div>
        ))}
        <TraceLine indent={0} label="Household total net cash" value={fmt(currentRow.totalNet)} subtotal />
      </TraceSection>

      <TraceSection title="Expenses" subtitle="Living expenses + school fees, both compounded from their start year.">
        {expenseList.map((x, i) => (
          <TraceLine key={i} indent={1} label={x.name} value={fmt(x.amount)} explain={`compounded at ${x.growthPct || 0}% from year ${x.startYear ?? 0}`} />
        ))}
        {(currentRow.schoolFees || 0) > 0 && (
          <TraceLine indent={1} label="School fees (combined)" value={fmt(currentRow.schoolFees)} explain="per kid, growing annually until years remaining = 0" />
        )}
        <TraceLine indent={0} label="Total expenses (this year)" value={fmt((currentRow.expenses || 0) + (currentRow.schoolFees || 0))} subtotal />
      </TraceSection>

      <TraceSection title="Loans" subtitle="Per-loan amortisation. P&I reduces principal; IO holds balance flat.">
        {state.assets.flatMap(a =>
          (a.loans || []).filter(l => l.balance > 0).map((l, i) => (
            <div key={`${a.id}-${i}`}>
              <TraceLine indent={1} label={`${a.name} — Loan ${(a.loans.indexOf(l) + 1)}`} value="" header />
              <TraceLine indent={2} label="balance × rate = interest" value={fmt(l.balance * (l.rate / 100))} explain={`${fmt(l.balance)} × ${l.rate}%`} />
              <TraceLine indent={2} label={(l.type || "pi") === "io" ? "interest-only payment" : `P&I payment (${l.termYears}y term)`}
                value={fmt(computeAnnualPayment(l))}
                explain={(l.type || "pi") === "io" ? "= interest" : `P × r / (1 − (1+r)^−n)`} />
            </div>
          ))
        )}
        {state.liabilities.filter(l => l.balance > 0).map((l, i) => (
          <div key={i}>
            <TraceLine indent={1} label={l.name} value="" header />
            <TraceLine indent={2} label="balance × rate = interest" value={fmt(l.balance * (l.rate / 100))} explain={`${fmt(l.balance)} × ${l.rate}%`} />
            <TraceLine indent={2} label={(l.type || "pi") === "io" ? "interest-only" : `P&I (${l.termYears}y)`} value={fmt(computeAnnualPayment(l))} />
          </div>
        ))}
        <TraceLine indent={0} label="Total loan payments (this year)" value={fmt(currentRow.totalLiabPayment || 0)} subtotal />
      </TraceSection>

      <TraceSection title="Cashflow reconciliation" subtitle="How the year's flows produce the change in cash assets.">
        <TraceLine indent={1} label="Net income (household)" value={fmt(currentRow.totalNet)} positive />
        <TraceLine indent={1} label="Asset income (rents, dividends)" value={fmt(currentRow.assetIncome || 0)} positive />
        <TraceLine indent={1} label="− Living expenses" value={`-${fmt(currentRow.expenses || 0)}`} negative />
        <TraceLine indent={1} label="− School fees" value={`-${fmt(currentRow.schoolFees || 0)}`} negative />
        <TraceLine indent={1} label="− Loan payments" value={`-${fmt(currentRow.totalLiabPayment || 0)}`} negative />
        {currentRow.eventLump != null && currentRow.eventLump !== 0 && (
          <TraceLine indent={1} label={currentRow.eventLump > 0 ? "+ Event income/lump" : "− Event expense"}
            value={(currentRow.eventLump > 0 ? "+" : "") + fmt(currentRow.eventLump)} />
        )}
        <TraceLine indent={0} label="= Net cashflow" value={fmt(currentRow.netCashflow)} subtotal positive={currentRow.netCashflow >= 0} negative={currentRow.netCashflow < 0} />
      </TraceSection>

      <TraceSection title="Net wealth (this year)" subtitle="Sum of asset balances less liabilities.">
        <TraceLine indent={1} label="Property" value={fmt(currentRow.property || 0)} />
        <TraceLine indent={1} label="Equities" value={fmt(currentRow.equities || 0)} />
        <TraceLine indent={1} label="Superannuation" value={fmt(currentRow.super || 0)} />
        <TraceLine indent={1} label="Share Plan" value={fmt(currentRow.sharePlan || 0)} />
        <TraceLine indent={1} label="Cash" value={fmt(currentRow.cash || 0)} />
        <TraceLine indent={1} label="Other" value={fmt(currentRow.other || 0)} />
        <TraceLine indent={1} label="Total assets" value={fmt(currentRow.totalAssets)} subtotal />
        <TraceLine indent={1} label="− Liabilities" value={`-${fmt(currentRow.liabilities)}`} negative />
        <TraceLine indent={0} label="= Net wealth" value={fmt(currentRow.netWealth)} subtotal />
      </TraceSection>
    </div>
  );
}

function TraceSection({ title, subtitle, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: "14px 18px" }}>
      <div className="serif" style={{ fontSize: 16, fontStyle: "italic", marginBottom: 2 }}>{title}</div>
      {subtitle && <div style={{ color: C.textMute, fontSize: 10, letterSpacing: "0.05em", marginBottom: 12 }}>{subtitle}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function TraceLine({ indent = 0, label, value, explain, header, subtotal, positive, negative, muted }) {
  const valueColor = positive ? C.good : negative ? C.danger : muted ? C.textMute : C.text;
  const labelColor = header ? C.text : muted ? C.textMute : C.textDim;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: `${header ? 6 : 3}px 0 ${header ? 4 : 3}px ${indent * 16}px`,
      borderTop: subtotal ? `1px solid ${C.line}` : "none",
      borderBottom: header ? `1px dashed ${C.line}` : "none",
      marginTop: header || subtotal ? 4 : 0,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: header ? 12 : 11, color: labelColor, fontWeight: header || subtotal ? 500 : 400 }}>{label}</span>
        {explain && <span className="mono" style={{ fontSize: 9, color: C.textMute, opacity: 0.8 }}>{explain}</span>}
      </div>
      <span className="mono" style={{ fontSize: header ? 12 : 11, color: valueColor, fontWeight: subtotal ? 500 : 400 }}>{value}</span>
    </div>
  );
}


// =================================================================
// AuthView — sign in / sign up screen, shown when not authenticated
// =================================================================
function AuthView({ onSignedIn }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn?.();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo("Check your email for a confirmation link, then come back and sign in.");
        } else {
          onSignedIn?.();
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setInfo("If an account exists for that email, a reset link has been sent.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    background: "#0f0d0a", border: `1px solid ${C.line}`, color: C.text,
    padding: "10px 12px", fontSize: 13, width: "100%", boxSizing: "border-box",
    fontFamily: "Inter Tight",
  };

  // Link-styled buttons (real buttons so they're keyboard-focusable)
  const authLinkStyle = {
    background: "none", border: "none", padding: 0, font: "inherit",
    color: C.accent, cursor: "pointer", textDecoration: "underline",
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'Inter Tight', system-ui, sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <style>{`
        body { margin: 0; }
        .serif { font-family: 'EB Garamond', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        select, input { font-family: 'Inter Tight', system-ui, sans-serif; }
        input:focus { outline: none; border-color: ${C.accent}; }
      `}</style>
      <div style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "40px 36px",
        maxWidth: 380, width: "100%",
      }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
            <div className="serif" style={{ fontSize: 30, fontStyle: "italic", fontWeight: 500, letterSpacing: "-0.01em" }}>
              The Ledger
            </div>
            <div className="mono" style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.1em", opacity: 0.6 }}>{VERSION}</div>
          </div>
          <div style={{ color: C.textMute, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 6 }}>
            Long-range financial scenarios
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
              Email
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>
          {mode !== "forgot" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                Password
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                style={inputStyle}
              />
              {mode === "signup" && (
                <div style={{ fontSize: 10, color: C.textMute, marginTop: 6 }}>
                  Minimum 6 characters
                </div>
              )}
            </div>
          )}
          {error && (
            <div style={{ background: "#2a1818", border: `1px solid ${C.danger}`, color: C.danger, padding: "8px 10px", fontSize: 11, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ background: "#1a2418", border: `1px solid ${C.good}`, color: C.good, padding: "8px 10px", fontSize: 11, marginBottom: 12 }}>
              {info}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%", padding: "10px 14px", background: C.accent, color: C.bg,
              border: "none", fontSize: 12, letterSpacing: "0.05em",
              textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
              fontFamily: "Inter Tight", fontWeight: 500,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: C.textMute, textAlign: "center" }}>
          {mode === "signin" && (
            <>
              <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }} style={authLinkStyle}>Create account</button>
              <span style={{ margin: "0 8px" }}>·</span>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setInfo(null); }} style={authLinkStyle}>Forgot password?</button>
            </>
          )}
          {mode !== "signin" && (
            <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }} style={authLinkStyle}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
