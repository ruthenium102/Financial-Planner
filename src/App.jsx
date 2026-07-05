import { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Settings, Download, Upload, RotateCcw, X, LogOut, Cloud, CloudOff } from "lucide-react";
import { DEFAULT_STATE, migrateScenario, project, genId } from "./engine.js";
import {
  SUPABASE_ENABLED, supabase, canAutosaveToFile, downloadJson, writeJsonToFileHandle,
  loadFromLocalStorage, saveToLocalStorage, clearLocalStorage,
  loadFromSupabase, saveToSupabase, deleteFromSupabase,
} from "./storage.js";
import {
  VERSION, C, CATEGORY_META, CATEGORY_ORDER, CASHFLOW_INCOME, CASHFLOW_EXPENSE,
  fmt, btnGhost, btnTab,
} from "./theme.js";
import { DragList, Section, Kpi, NumberField } from "./components/fields.jsx";
import { CashflowTooltip, CustomTooltip } from "./components/tooltips.jsx";
import { EventRow, EarnerRow, KidRow, ExpenseRow, AssetRow, LiabRow, CashOptimisationEditor } from "./components/rows.jsx";
import { LogicTab } from "./components/LogicTab.jsx";
import { TraceTab } from "./components/TraceTab.jsx";
import { AuthView } from "./components/AuthView.jsx";

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
    // Deletion is permanent (state + cloud row, no undo) — always confirm first.
    setConfirmModal({
      title: "Delete scenario",
      msg: `Delete "${name}" permanently? This removes it from every device and cannot be undone. Use Save As first if you want a file backup.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
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
        setToast({ kind: "ok", msg: `Deleted "${name}"` });
      },
    });
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
        /* Planner layout: chart + input column side by side on wide screens,
           stacked on phones so the input panels get the full width. */
        .fp-main-grid { display: grid; grid-template-columns: 1fr 400px; gap: 0; }
        .fp-main-chart { border-right: 1px solid ${C.line}; }
        @media (max-width: 900px) {
          .fp-main-grid { grid-template-columns: 1fr; }
          .fp-main-chart { border-right: none; border-bottom: 1px solid ${C.line}; }
        }
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

      <div className="fp-main-grid">
        <div className="fp-main-chart">
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
                style={{ ...btnGhost, background: confirmModal.danger ? C.danger : C.accent, color: C.bg, borderColor: confirmModal.danger ? C.danger : C.accent }}>
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

