// =================================================================
// storage.js — persistence layer for The Ledger
// =================================================================
// Three storage backends, all speaking the same wrapper format
// { scenarios: { [name]: scenarioObj }, active: string }:
//   - Supabase (cloud sync, optimistic concurrency via a version column)
//   - localStorage (offline cache / no-auth fallback)
//   - local .json files (File System Access API on Chrome/Edge, download elsewhere)

import { createClient } from "@supabase/supabase-js";

// Supabase client. Reads URL + publishable key from Vite env vars at build time.
// In dev: edit .env.local. In Vercel production: set these as Environment Variables.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);

// ===== File workflow helpers =====
// File System Access API support detection (Chrome/Edge/Brave on desktop = yes; Safari/Firefox = no)
function canAutosaveToFile() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

// Strip internal fields like _supabaseId and _version from each scenario before serialising to file.
function stripInternalFields(scenarios) {
  const clean = {};
  for (const [name, scen] of Object.entries(scenarios || {})) {
    const { _supabaseId, _version, ...rest } = scen || {};
    clean[name] = rest;
  }
  return clean;
}

// Write scenarios to a FileSystemFileHandle (Chrome/Edge silent autosave path)
async function writeJsonToFileHandle(handle, payload) {
  const cleanPayload = { ...payload, scenarios: stripInternalFields(payload.scenarios) };
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(cleanPayload, null, 2));
  await writable.close();
}

// Trigger a download of the given JSON payload (Safari/Firefox manual-save path)
function downloadJson(payload, filename) {
  const cleanPayload = { ...payload, scenarios: stripInternalFields(payload.scenarios) };
  const blob = new Blob([JSON.stringify(cleanPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "the-ledger.json";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
const supabase = SUPABASE_ENABLED ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------- localStorage ----------
const STORAGE_KEY = "fp:scenarios:v14";

// =================================================================
// Storage layer — Supabase when authenticated, localStorage as fallback
// =================================================================
//
// The app keeps a small wrapper { scenarios: { [name]: scenarioObj }, active: string }.
// In Supabase each scenario is a row keyed by id with name + data (jsonb). We collapse
// the rows into the wrapper format for the React state.
//
// Local fallback (localStorage) is used when Supabase is disabled OR a user is logged out.
// On first sign-in, if Supabase has no rows but localStorage does, we migrate it up.

async function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt cache — treat as empty */ }
  return null;
}
async function saveToLocalStorage(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota/private mode — best-effort */ }
}

async function loadFromSupabase(userId) {
  if (!supabase || !userId) return null;
  const { data: rows, error } = await supabase
    .from("scenarios")
    .select("id, name, data, version")
    .eq("user_id", userId);
  if (error) {
    console.error("Supabase load error:", error);
    return null;
  }
  if (!rows || rows.length === 0) return null;
  const scenarios = {};
  rows.forEach(r => { scenarios[r.name] = { ...r.data, _supabaseId: r.id, _version: r.version || 0 }; });
  // Pick first scenario alphabetically as active by default; useEffect will preserve user's choice
  const active = Object.keys(scenarios).sort()[0];
  return { scenarios, active };
}

// Save the entire wrapper to Supabase using per-row updates with optimistic concurrency.
// For each existing row (has _supabaseId): UPDATE WHERE id = ? AND version = ?
// If matched: row updated, returns new version.
// If not matched: stale write detected — returns { stale: true, conflicts: [scenarioName, ...] }
// New rows (no _supabaseId): plain insert.
async function saveToSupabase(userId, data) {
  if (!supabase || !userId || !data?.scenarios) return { ok: false };
  const entries = Object.entries(data.scenarios);

  // All rows save in parallel; each result records what happened to that row.
  const results = await Promise.all(entries.map(async ([name, scenObj]) => {
    const { _supabaseId, _version, ...payload } = scenObj;
    if (_supabaseId) {
      // Existing row — optimistic concurrency update
      const expectedVersion = _version || 0;
      const { data: updated, error } = await supabase
        .from("scenarios")
        .update({ name, data: payload, version: expectedVersion + 1 })
        .eq("id", _supabaseId)
        .eq("version", expectedVersion)
        .select("id, name, version");
      if (error) {
        console.error("Supabase update error:", error);
        return { name, error };
      }
      // Empty result = row exists but version didn't match — stale write
      if (!updated || updated.length === 0) return { name, conflict: true };
      return { name, id: updated[0].id, version: updated[0].version };
    }
    // New row — insert
    const { data: inserted, error } = await supabase
      .from("scenarios")
      .insert({ user_id: userId, name, data: payload, version: 1 })
      .select("id, name, version");
    if (error) {
      console.error("Supabase insert error:", error);
      return { name, error };
    }
    return inserted && inserted[0]
      ? { name, id: inserted[0].id, version: inserted[0].version }
      : { name };
  }));

  const idByName = {};
  const versionByName = {};
  const conflicts = [];
  let firstError = null;
  for (const r of results) {
    if (r.error) firstError = firstError || r.error;
    else if (r.conflict) conflicts.push(r.name);
    else if (r.id) { idByName[r.name] = r.id; versionByName[r.name] = r.version; }
  }
  if (firstError) return { ok: false, error: firstError, idByName, versionByName };
  if (conflicts.length > 0) return { ok: false, stale: true, conflicts, idByName, versionByName };
  return { ok: true, idByName, versionByName };
}

// Delete a scenario row from Supabase by id
async function deleteFromSupabase(supabaseId) {
  if (!supabase || !supabaseId) return;
  const { error } = await supabase.from("scenarios").delete().eq("id", supabaseId);
  if (error) console.error("Supabase delete error:", error);
}

// Remove the cached wrapper (used on sign-out so financial data doesn't
// linger in the browser on shared machines).
function clearLocalStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
}

// ---------- Exports ----------
export {
  SUPABASE_ENABLED,
  supabase,
  canAutosaveToFile,
  stripInternalFields,
  writeJsonToFileHandle,
  downloadJson,
  STORAGE_KEY,
  loadFromLocalStorage,
  saveToLocalStorage,
  clearLocalStorage,
  loadFromSupabase,
  saveToSupabase,
  deleteFromSupabase,
};
