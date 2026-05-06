import React, { useState, useEffect, useMemo, useRef } from "react";
import { AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Trash2, TrendingUp, Settings, Download, Upload, RotateCcw, Edit2, X, Home, DollarSign, PiggyBank, Layers, GraduationCap, User, LogOut, Cloud, CloudOff } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

// Supabase client. Reads URL + publishable key from Vite env vars at build time.
// In dev: edit .env.local. In Vercel production: set these as Environment Variables.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);
const supabase = SUPABASE_ENABLED ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

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

// ---------- Defaults ----------
const DEFAULT_STATE = {
  meta: { currentAge: 40, horizonYears: 30, inflation: 2.5, currency: "AUD", fxSgdAud: 1.10, retirementSpendingMultiplier: 0.75 },
  assets: [
    { id: "a1", name: "Cash & savings", category: "cash", value: 0, growth: 4.0, income: 0 },
  ],
  liabilities: [],
  earners: [
    { id: "e1", name: "Earner 1", currency: "AUD",
      salary: 0, bonusRateCash: 0, bonusRateShares: 0, salaryGrowth: 3.0,
      taxMode: "ato", taxRate: 32, hasPrivateHealth: true,
      superSgRate: 12.0, superSgIncludesBonus: false,
      superExtraConcessionalRate: 0, superExtraNonConcessionalRate: 0,
      superMatchConcessionalRate: 0, superMatchNonConcessionalRate: 0 },
  ],
  expenses: [],
  kids: [],
  events: [],
};

// ---------- Storage ----------
const STORAGE_KEY = "fp:scenarios:v14";
const VERSION = "v1.8";


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
  } catch (e) {}
  return null;
}
async function saveToLocalStorage(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

async function loadFromSupabase(userId) {
  if (!supabase || !userId) return null;
  const { data: rows, error } = await supabase
    .from("scenarios")
    .select("id, name, data")
    .eq("user_id", userId);
  if (error) {
    console.error("Supabase load error:", error);
    return null;
  }
  if (!rows || rows.length === 0) return null;
  const scenarios = {};
  rows.forEach(r => { scenarios[r.name] = { ...r.data, _supabaseId: r.id }; });
  // Pick first scenario alphabetically as active by default; useEffect will preserve user's choice
  const active = Object.keys(scenarios).sort()[0];
  return { scenarios, active };
}

// Save the entire wrapper to Supabase by upserting each scenario.
// Uses _supabaseId on the scenario object to identify existing rows.
async function saveToSupabase(userId, data) {
  if (!supabase || !userId || !data?.scenarios) return { ok: false };
  const entries = Object.entries(data.scenarios);
  // Build rows with user_id stamped
  const rows = entries.map(([name, scenObj]) => {
    const { _supabaseId, ...payload } = scenObj;
    return _supabaseId
      ? { id: _supabaseId, user_id: userId, name, data: payload }
      : { user_id: userId, name, data: payload };
  });
  // Upsert (insert new, update existing by id)
  const { data: upserted, error } = await supabase
    .from("scenarios")
    .upsert(rows, { onConflict: "id" })
    .select("id, name");
  if (error) {
    console.error("Supabase save error:", error);
    return { ok: false, error };
  }
  // Return id-mapped names so the caller can stamp _supabaseId back onto the in-memory state
  const idByName = {};
  upserted?.forEach(r => { idByName[r.name] = r.id; });
  return { ok: true, idByName };
}

// Delete a scenario row from Supabase by id
async function deleteFromSupabase(supabaseId) {
  if (!supabase || !supabaseId) return;
  const { error } = await supabase.from("scenarios").delete().eq("id", supabaseId);
  if (error) console.error("Supabase delete error:", error);
}

// Migrate a scenario to ensure all expected fields exist (guards against old saves
// and handcrafted imports). Keeps any values already present.
function migrateScenario(s) {
  if (!s || typeof s !== "object") return null;
  const out = {
    meta: { fxSgdAud: 1.15, retirementSpendingMultiplier: 0.75, ...(s.meta || { currentAge: 45, horizonYears: 45, inflation: 2.5, currency: "AUD" }) },
    assets: Array.isArray(s.assets) ? s.assets.map(a => {
      const aOut = { runningExpenses: 0, earnerId: null, frankedRate: (a.category === "equities") ? 100 : 0, ...a };
      // ===== Category migration =====
      // Legacy "sharePlan" → "equities" (consolidated as "Shares")
      if (aOut.category === "sharePlan") aOut.category = "equities";
      // Legacy "property" → "investmentProperty" if any loan was flagged investment, else "primaryResidence"
      if (aOut.category === "property") {
        const anyInvestment = (a.loans || []).some(l => l.isInvestment) || a.loan?.isInvestment;
        aOut.category = anyInvestment ? "investmentProperty" : "primaryResidence";
      }
      // Convert flat income → dividendYield for equities (yield-based)
      if (aOut.category === "equities" && aOut.dividendYield == null) {
        if (aOut.income > 0 && aOut.value > 0) {
          aOut.dividendYield = (aOut.income / aOut.value) * 100;
        } else {
          aOut.dividendYield = 4;
        }
        aOut.income = 0;
      }
      // Joint ownership migration
      if (!aOut.ownershipShares) {
        if (aOut.earnerId) {
          aOut.ownershipShares = { [aOut.earnerId]: 100 };
        } else {
          aOut.ownershipShares = {};
        }
      }
      // Normalise loan(s): support legacy a.loan (single object) → a.loans (array)
      let loans = Array.isArray(a.loans) ? a.loans.slice() : [];
      if (a.loan) loans.push(a.loan);
      // For investment property: force isInvestment = true on all loans (category drives it)
      // For primary residence: force isInvestment = false
      const isIP = aOut.category === "investmentProperty";
      const isPR = aOut.category === "primaryResidence";
      loans = loans.map(loan => {
        const ln = { isInvestment: false, offsetCashAssetId: null, earnerId: null, ...loan };
        if (isIP) ln.isInvestment = true;
        else if (isPR) ln.isInvestment = false;
        if (!ln.type) {
          if (ln.annualPayment != null) {
            const io = (ln.balance || 0) * ((ln.rate || 0) / 100);
            ln.type = (io > 0 && Math.abs(ln.annualPayment - io) / io < 0.1) ? "io" : "pi";
          } else {
            ln.type = "pi";
          }
        }
        if (!ln.termYears) ln.termYears = 30;
        if (ln.type === "io" && ln.ioPeriod == null) {
          ln.ioPeriod = ln.termYears;
          if (ln.termYears < 30) ln.termYears = 30;
        }
        if (ln.type === "pi" && ln.ioPeriod == null) ln.ioPeriod = 0;
        if (ln.originalBalance == null) ln.originalBalance = ln.balance;
        if (!ln.id) ln.id = `ln${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        delete ln.annualPayment;
        return ln;
      });
      aOut.loans = loans;
      delete aOut.loan;
      return aOut;
    }) : [],
    liabilities: Array.isArray(s.liabilities) ? s.liabilities.map(l => {
      const out = { isInvestment: false, offsetCashAssetId: null, earnerId: null, ...l };
      if (!out.type) {
        if (out.annualPayment != null) {
          const io = (out.balance || 0) * ((out.rate || 0) / 100);
          out.type = (io > 0 && Math.abs(out.annualPayment - io) / io < 0.1) ? "io" : "pi";
        } else {
          out.type = "pi";
        }
      }
      if (!out.termYears) out.termYears = 30;
      if (out.type === "io" && out.ioPeriod == null) {
        out.ioPeriod = out.termYears;
        if (out.termYears < 30) out.termYears = 30;
      }
      if (out.type === "pi" && out.ioPeriod == null) out.ioPeriod = 0;
      if (out.originalBalance == null) out.originalBalance = out.balance;
      delete out.annualPayment;
      return out;
    }) : [],
    earners: Array.isArray(s.earners) ? s.earners.map(e => {
      const out = {
        taxMode: "ato", currency: "AUD",
        bonusRateCash: 0, bonusRateShares: 0,
        hasPrivateHealth: true,
        superSgRate: 12.0, superSgIncludesBonus: false,
        superExtraConcessionalRate: 0, superExtraNonConcessionalRate: 0,
        superMatchConcessionalRate: 0, superMatchNonConcessionalRate: 0,
        ...e
      };
      // Legacy: superContribRate → superSgRate
      if (e.superContribRate != null && e.superSgRate == null) {
        out.superSgRate = e.superContribRate;
      }
      // Legacy: bonusRate → bonusRateCash (single bonus assumed cash)
      if (e.bonusRate != null && e.bonusRateCash == null) {
        out.bonusRateCash = e.bonusRate;
      }
      // Legacy: superMatchRate + superMatchType → split fields
      if (e.superMatchRate != null && e.superMatchConcessionalRate == null && e.superMatchNonConcessionalRate == null) {
        if ((e.superMatchType || "concessional") === "concessional") {
          out.superMatchConcessionalRate = e.superMatchRate;
        } else {
          out.superMatchNonConcessionalRate = e.superMatchRate;
        }
      }
      delete out.superContribRate;
      delete out.bonusRate;
      delete out.superMatchRate;
      delete out.superMatchType;
      return out;
    }) : [],
    kids: Array.isArray(s.kids) ? s.kids : [],
    // Upgrade legacy cashflow.livingExpenses to expense items list
    expenses: Array.isArray(s.expenses) ? s.expenses
      : (s.cashflow ? [{
          id: "legacy",
          name: "Living expenses",
          amount: s.cashflow.livingExpenses || 0,
          growth: s.cashflow.expenseGrowth || 2.5,
          startYear: 0, endYear: null,
        }] : []),
    events: Array.isArray(s.events) ? s.events.map(ev => ({
      // Asset-sale fields are no-ops for non-sale events
      costBase: 0, heldOverYear: true, ownerId: null,
      ...ev,
    })) : [],
  };

  // Post-process: merge any "offset" or cash assets that were linked to a loan onto the loan
  // itself as `loan.offsetBalance`. Then remove the standalone asset. The offset balance now
  // lives on the loan and shows in the wealth chart via projection rows (under the "cash" stack).
  const offsetAssetIds = new Set();
  const balanceByOffsetId = {};
  out.assets.forEach(a => {
    if (a.category === "offset") balanceByOffsetId[a.id] = a.value || 0;
  });

  // Walk all loans (in assets and liabilities), copy balance and mark the asset for removal
  const moveBalanceOntoLoan = (loan) => {
    const linkedId = loan.offsetCashAssetId;
    if (!linkedId) return loan;
    if (loan.offsetBalance == null) {
      // Use the linked asset's value if it exists; else 0
      loan.offsetBalance = balanceByOffsetId[linkedId] ?? 0;
    }
    offsetAssetIds.add(linkedId);
    return { ...loan, offsetBalance: loan.offsetBalance, offsetCashAssetId: null };
  };
  out.assets = out.assets.map(a => ({
    ...a,
    loans: (a.loans || []).map(moveBalanceOntoLoan),
  }));
  out.liabilities = out.liabilities.map(l => moveBalanceOntoLoan(l));
  // Remove the now-orphaned standalone offset assets
  if (offsetAssetIds.size > 0) {
    out.assets = out.assets.filter(a => !offsetAssetIds.has(a.id));
  }
  // Default offsetBalance to 0 on any loan that doesn't have one set
  out.assets = out.assets.map(a => ({
    ...a,
    loans: (a.loans || []).map(l => ({ ...l, offsetBalance: l.offsetBalance ?? 0 })),
  }));
  out.liabilities = out.liabilities.map(l => ({ ...l, offsetBalance: l.offsetBalance ?? 0 }));

  // Cash optimisation defaults
  if (!out.meta.cashOptimisation) {
    out.meta.cashOptimisation = {
      enabled: false,                // off by default
      mode: "off",                   // "off" | "offset" | "equities"
      minBuffer: 50000,              // user-editable $ floor
      sweepSourceAssetId: null,      // designated cash asset to sweep from
      sweepTargetOffsetLoanKey: null, // designated loan whose offset receives the sweep
      sweepTargetEquityAssetId: null, // designated equity asset for spillover or pure-equities sweep
    };
  }

  return out;
}

// ---------- ATO tax (resident individual, 2025-26 FY) ----------
// Brackets unchanged from 2024-25; same rates apply to 2025-26
// Source: ATO, verified Apr 2026
const ATO_BRACKETS_2025_26 = [
  { upTo: 18200,  rate: 0.00, base: 0 },
  { upTo: 45000,  rate: 0.16, base: 0 },
  { upTo: 135000, rate: 0.30, base: 4288 },      // 16% of (45000-18200)
  { upTo: 190000, rate: 0.37, base: 31288 },     // 4288 + 30% of (135000-45000)
  { upTo: Infinity, rate: 0.45, base: 51638 },   // 31288 + 37% of (190000-135000)
];
const MEDICARE_LEVY_RATE = 0.02;

// Medicare Levy Surcharge (2025-26 thresholds) — applies if no private hospital cover.
// Tier 1: 1.0% on income above $101,000 (single) / $202,000 (family)
// Tier 2: 1.25% above $118,000 / $236,000
// Tier 3: 1.5% above $158,000 / $316,000
// Family threshold is increased by $1,500 for EACH dependent child after the first.
// Source: ATO, verified May 2026 — https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates
const MLS_TIERS = {
  single: [
    { threshold: 101000, rate: 0.000 },
    { threshold: 118001, rate: 0.010 },
    { threshold: 158001, rate: 0.0125 },
    { threshold: Infinity, rate: 0.015 },
  ],
  family: [
    { threshold: 202000, rate: 0.000 },
    { threshold: 236001, rate: 0.010 },
    { threshold: 316001, rate: 0.0125 },
    { threshold: Infinity, rate: 0.015 },
  ],
};
const MLS_KID_UPLIFT = 1500;  // +$1,500 per kid AFTER the first
function medicareLevySurcharge(income, isFamily = false, dependentKids = 0) {
  // Returns the MLS rate that applies at this income level
  const tiers = isFamily ? MLS_TIERS.family : MLS_TIERS.single;
  const uplift = isFamily && dependentKids > 1 ? (dependentKids - 1) * MLS_KID_UPLIFT : 0;
  let rate = 0;
  for (const t of tiers) {
    if (income < (t.threshold + uplift)) break;
    rate = t.rate;
  }
  return income * rate;
}

function atoIncomeTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  for (const b of ATO_BRACKETS_2025_26) {
    if (taxableIncome <= b.upTo) {
      const prevUpTo = ATO_BRACKETS_2025_26[ATO_BRACKETS_2025_26.indexOf(b) - 1]?.upTo ?? 0;
      return b.base + (taxableIncome - prevUpTo) * b.rate;
    }
  }
  return 0;
}

// ATO total tax = income tax + Medicare Levy + (optional) Medicare Levy Surcharge.
// `hasPrivateHealth` (default true) suppresses MLS. `householdMlsIncome` is the household's
// MLS-purposes income (taxable + reportable super contribs + net investment losses + reportable FBT),
// used as the basis for MLS family threshold checks. `dependentKids` is the count of kids still in
// dependant period, used for the +$1,500-per-additional-kid family threshold uplift.
// `mlsIncome` is the individual's own MLS-purposes income (used as the *amount* MLS is applied to).
function atoTotalTax(taxableIncome, hasPrivateHealth = true, householdMlsIncome = undefined, dependentKids = 0, mlsIncome = undefined) {
  if (taxableIncome <= 0) return 0;
  let tax = atoIncomeTax(taxableIncome);
  if (taxableIncome > 27222) tax += taxableIncome * MEDICARE_LEVY_RATE;
  if (!hasPrivateHealth) {
    const isFamily = householdMlsIncome != null && householdMlsIncome > (mlsIncome ?? taxableIncome);
    const incomeForMlsCheck = householdMlsIncome ?? mlsIncome ?? taxableIncome;
    const tiers = isFamily ? MLS_TIERS.family : MLS_TIERS.single;
    const uplift = isFamily && dependentKids > 1 ? (dependentKids - 1) * MLS_KID_UPLIFT : 0;
    let rate = 0;
    for (const t of tiers) { if (incomeForMlsCheck < (t.threshold + uplift)) break; rate = t.rate; }
    // MLS is applied to the individual's MLS income (or fall back to taxable income)
    tax += (mlsIncome ?? taxableIncome) * rate;
  }
  return tax;
}

// ---------- Singapore tax (resident individual, YA2026 / income year 2025) ----------
// Rates current as at YA2026; same rates apply going forward unless changed.
// Source: IRAS, verified Apr 2026
const SG_BRACKETS = [
  { upTo: 20000,   rate: 0.00,  base: 0 },
  { upTo: 30000,   rate: 0.02,  base: 0 },
  { upTo: 40000,   rate: 0.035, base: 200 },
  { upTo: 80000,   rate: 0.07,  base: 550 },
  { upTo: 120000,  rate: 0.115, base: 3350 },
  { upTo: 160000,  rate: 0.15,  base: 7950 },
  { upTo: 200000,  rate: 0.18,  base: 13950 },
  { upTo: 240000,  rate: 0.19,  base: 21150 },
  { upTo: 280000,  rate: 0.195, base: 28750 },
  { upTo: 320000,  rate: 0.20,  base: 36550 },
  { upTo: 500000,  rate: 0.22,  base: 44550 },
  { upTo: 1000000, rate: 0.23,  base: 84150 },
  { upTo: Infinity,rate: 0.24,  base: 199150 },
];

function sgIncomeTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  for (let i = 0; i < SG_BRACKETS.length; i++) {
    const b = SG_BRACKETS[i];
    if (taxableIncome <= b.upTo) {
      const prev = i > 0 ? SG_BRACKETS[i - 1].upTo : 0;
      return b.base + (taxableIncome - prev) * b.rate;
    }
  }
  return 0;
}

// Compute tax for an earner based on their tax mode and currency context.
// `gross` is the taxable income (already net of any salary sacrifice for ATO earners).
// Returns tax in the EARNER'S currency (so for SG earners, returns SGD tax).
// `householdMlsIncome` and `mlsIncome` are MLS-purposes income (add-backs included).
// `dependentKids` is the number of kids still in dependant period (for family threshold uplift).
function computeEarnerTax(earner, gross, householdMlsIncome = undefined, dependentKids = 0, mlsIncome = undefined) {
  const mode = earner.taxMode || "ato";
  if (mode === "flat") return gross * ((earner.taxRate || 0) / 100);
  if (mode === "sg")   return sgIncomeTax(gross);
  return atoTotalTax(gross, earner.hasPrivateHealth !== false, householdMlsIncome, dependentKids, mlsIncome);
}

// ---------- Super contribution caps (FY2025-26) ----------
// Source: ATO, verified Apr 2026
// FY2025-26: concessional $30k, non-concessional $120k
// FY2026-27 onwards: concessional $32.5k, non-concessional $130k (legislated)
// We use the current values as a flat assumption; users can override per scenario via meta.
const CONCESSIONAL_CAP = 30000;
const NONCONCESSIONAL_CAP = 120000;
const SUPER_CONTRIB_TAX = 0.15;              // 15% tax on concessional contribs in fund
const DIV293_THRESHOLD = 250000;              // income + concessional > this triggers extra 15%
const DIV293_EXTRA_TAX = 0.15;

// Compute annual loan payment given loan config and current balance.
// - IO loans: during IO period, payment = balance * rate (interest only).
//   After IO period ends, loan converts to P&I and amortises over the REMAINING term.
//   computeAnnualPayment shows the IO-period payment (steady state); the engine handles
//   the post-conversion amortisation year by year.
// - P&I loans: standard amortisation — payment amortises the ORIGINAL balance over termYears.
function computeAnnualPayment(loan) {
  if (!loan) return 0;
  const r = (loan.rate || 0) / 100;
  const type = loan.type || "pi";
  const balance = loan.balance || 0;
  if (type === "io") {
    return balance * r;
  }
  // P&I: amortise the original (or current if not set) over remaining term
  const term = loan.termYears || 30;
  const P = loan.originalBalance || balance;
  if (r === 0) return P / term;
  return P * r / (1 - Math.pow(1 + r, -term));
}

// ---------- Projection engine ----------
// Property categories: "primaryResidence" and "investmentProperty" both behave as property,
// but only investmentProperty generates rental income / negative gearing.
function isPropertyCategory(cat) {
  return cat === "primaryResidence" || cat === "investmentProperty" || cat === "property";
}
function isInvestmentProperty(asset) {
  if (!asset) return false;
  if (asset.category === "investmentProperty") return true;
  // Legacy: a "property" with at least one investment loan
  if (asset.category === "property") {
    return (asset.loans || []).some(l => l.isInvestment);
  }
  return false;
}

function project(state) {
  // Defensive: normalise missing arrays so old/corrupt scenarios don't crash
  const meta = state.meta || { currentAge: 45, horizonYears: 45, inflation: 2.5, currency: "AUD" };
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const liabilities = Array.isArray(state.liabilities) ? state.liabilities : [];
  const earners = Array.isArray(state.earners) ? state.earners : [];
  const kids = Array.isArray(state.kids) ? state.kids : [];
  const events = Array.isArray(state.events) ? state.events : [];
  // Support both old (cashflow.livingExpenses) and new (expenses[]) schemas gracefully
  const expenseItems = Array.isArray(state.expenses) ? state.expenses : (state.cashflow ? [
    { id: "legacy", name: "Living expenses", amount: state.cashflow.livingExpenses || 0, growth: state.cashflow.expenseGrowth || 2.5, startYear: 0, endYear: null }
  ] : []);
  const years = meta.horizonYears || 45;
  const rows = [];

  let balances = {};
  assets.forEach(a => { balances[a.id] = a.value; });

  // Combined liability tracking: asset-attached loans + standalone liabilities
  let liabs = {};          // key → current balance
  let offsetByLoan = {};   // key → current offset balance (lives on loan, mutated by amortisation/sweep)
  let loanMeta = {};       // key → { type, rate, termYears, yearsElapsed, isInvestment, assetId, earnerId }
  assets.forEach(a => {
    const loans = Array.isArray(a.loans) ? a.loans : (a.loan ? [a.loan] : []);
    loans.forEach(loan => {
      if (!loan || loan.balance <= 0) return;
      const key = `asset:${a.id}:${loan.id || "ln"}`;
      liabs[key] = loan.balance;
      offsetByLoan[key] = loan.offsetBalance || 0;
      loanMeta[key] = {
        type: loan.type || "pi",
        rate: loan.rate || 0,
        termYears: loan.termYears || 30,
        ioPeriod: loan.ioPeriod || (loan.type === "io" ? (loan.termYears || 5) : 0),
        originalBalance: loan.originalBalance || loan.balance,
        yearsElapsed: 0,
        isInvestment: !!loan.isInvestment,
        assetId: a.id,
        earnerId: loan.earnerId || a.earnerId || null,
      };
    });
  });
  liabilities.forEach(l => {
    const key = `liab:${l.id}`;
    liabs[key] = l.balance;
    offsetByLoan[key] = l.offsetBalance || 0;
    loanMeta[key] = {
      type: l.type || "pi",
      rate: l.rate || 0,
      termYears: l.termYears || 30,
      ioPeriod: l.ioPeriod || (l.type === "io" ? (l.termYears || 5) : 0),
      originalBalance: l.originalBalance || l.balance,
      yearsElapsed: 0,
      isInvestment: !!l.isInvestment,
      assetId: null,
      earnerId: l.earnerId || null,
    };
  });

  let earnerState = {};
  earners.forEach(e => { earnerState[e.id] = { salary: e.salary, retired: false }; });

  let kidState = {};
  kids.forEach(k => { kidState[k.id] = { fees: k.annualFees, yearsRemaining: k.yearsRemaining }; });

  // Per-expense running amount (compounded each year)
  let expenseState = {};
  expenseItems.forEach(x => { expenseState[x.id] = x.amount; });

  const retirementByEarner = {};
  events.filter(e => e.type === "retirement" && e.earnerId).forEach(e => {
    retirementByEarner[e.earnerId] = e.yearOffset;
  });

  for (let y = 0; y <= years; y++) {
    const age = meta.currentAge + y;

    earners.forEach(e => {
      const retYear = retirementByEarner[e.id];
      if (retYear != null && y >= retYear) earnerState[e.id].retired = true;
    });

    // FX rate: how many AUD per 1 SGD. Default 1.15 if missing.
    const fxSgdAud = (meta.fxSgdAud != null && meta.fxSgdAud > 0) ? meta.fxSgdAud : 1.15;

    // Super caps (allow per-scenario override via meta; otherwise constants)
    const concessionalCap = meta.concessionalCap || CONCESSIONAL_CAP;
    const nonConcessionalCap = meta.nonConcessionalCap || NONCONCESSIONAL_CAP;

    // ========== PROPERTY / INVESTMENT LOAN TAX ATTRIBUTION ==========
    // For each loan, compute this year's interest using offset-aware effective balance.
    // Interest on investment loans is tax-deductible to the linked earner.
    // Rental income minus interest minus running expenses = net rental result (negative gearing if <0).
    // Result is attributed to the loan's earner (or asset's earner) for income-tax adjustment.
    const interestThisYear = {};        // loan key → interest paid this year (used for amortisation later)
    const rentalAdjustmentByEarner = {}; // earnerId → net rental result this year (positive=income, negative=loss)
    let totalRentalIncome = 0, totalRentalExpenses = 0, totalInvestmentInterest = 0;

    // First pass: per-loan interest, accounting for offset
    Object.keys(liabs).forEach(key => {
      if (liabs[key] <= 0) { interestThisYear[key] = 0; return; }
      const m = loanMeta[key];
      if (!m) { interestThisYear[key] = 0; return; }
      // If full term has elapsed, no interest
      if (m.yearsElapsed >= m.termYears) { interestThisYear[key] = 0; return; }
      // Offset: subtract loan's own offsetBalance from interest base (capped at loan balance)
      const offsetAmount = Math.min(Math.max(0, offsetByLoan[key] || 0), liabs[key]);
      const effectiveBalance = Math.max(0, liabs[key] - offsetAmount);
      interestThisYear[key] = effectiveBalance * (m.rate / 100);
    });

    // Helper: distribute an amount across earners according to an asset's ownershipShares.
    // Falls back to first AUD ATO earner if shares are empty/missing.
    const distributeByOwnership = (asset, amount, accumulator) => {
      const shares = asset?.ownershipShares || {};
      const validEntries = Object.entries(shares).filter(([eid, pct]) => earners.some(e => e.id === eid) && pct > 0);
      if (validEntries.length > 0) {
        const totalPct = validEntries.reduce((s, [, p]) => s + p, 0);
        validEntries.forEach(([eid, pct]) => {
          accumulator[eid] = (accumulator[eid] || 0) + amount * (pct / totalPct);
        });
        return;
      }
      // Fallback: legacy earnerId or first AUD earner
      const fallback = asset?.earnerId
        || earners.find(en => (en.currency || "AUD") === "AUD" && (en.taxMode || "ato") === "ato" && !earnerState[en.id].retired)?.id
        || earners[0]?.id;
      if (fallback) accumulator[fallback] = (accumulator[fallback] || 0) + amount;
    };

    // Second pass: per-asset rental result for INVESTMENT properties.
    // Primary residence: no rental income, running expenses are personal (not deductible),
    // mortgage interest is not deductible.
    assets.forEach(a => {
      if (!isInvestmentProperty(a)) return;
      const scale = balances[a.id] / (a.value || 1);
      const grossRental = (a.income || 0) * (isFinite(scale) ? Math.max(0, scale) : 1);
      const runningExp = (a.runningExpenses || 0);
      // Interest on all loans attached to this investment property is deductible
      let propertyInvestmentInterest = 0;
      Object.keys(loanMeta).forEach(key => {
        const m = loanMeta[key];
        if (m.assetId === a.id) {
          propertyInvestmentInterest += interestThisYear[key] || 0;
        }
      });
      const netRental = grossRental - runningExp - propertyInvestmentInterest;
      distributeByOwnership(a, netRental, rentalAdjustmentByEarner);
      totalRentalIncome += grossRental;
      totalRentalExpenses += runningExp;
      totalInvestmentInterest += propertyInvestmentInterest;
    });

    // Standalone investment debts (non-property): interest is deductible to the loan's earner
    Object.keys(loanMeta).forEach(key => {
      const m = loanMeta[key];
      if (m.assetId) return; // already handled above (attached to a property)
      if (!m.isInvestment) return;
      const i = interestThisYear[key] || 0;
      if (i === 0) return;
      const ownerId = m.earnerId || earners[0]?.id;
      if (ownerId) {
        rentalAdjustmentByEarner[ownerId] = (rentalAdjustmentByEarner[ownerId] || 0) - i;
      }
      totalInvestmentInterest += i;
    });
    // ========== END PROPERTY TAX ATTRIBUTION ==========

    let totalGross = 0, totalNet = 0, totalTax = 0;
    // Cashflow chart components — separately track each for stacking
    let cfSalary = 0;        // base salaries across all earners (AUD)
    let cfCashBonus = 0;     // cash bonuses across all earners (AUD)
    // Net rental result (signed; can be negative-geared). Includes rental income minus running
    // expenses minus deductible investment-loan interest. Computed from the rental block above.
    let cfRentalNet = totalRentalIncome - totalRentalExpenses - totalInvestmentInterest;
    const superContribByEarner = {};   // total NET amount entering super (after contribs tax)
    const shareBonusByEarner = {};      // share bonus value (AUD) routed to share plan asset

    // ===== Asset income (non-property): attribute to owner-earner for tax =====
    // Equities and sharePlan use dividendYield (% of value). Other categories use flat income.
    let assetIncome = 0;
    let propertyCashFlow = 0;
    const assetIncomeAdjustmentByEarner = {}; // earnerId → grossed-up dividend/interest income (added to taxable)
    const frankingCreditByEarner = {};        // earnerId → franking credits to offset tax
    assets.forEach(a => {
      if (a.category === "offset") return; // offsets earn no income
      if (a.category === "primaryResidence") return; // PR has no rental, no income
      // Compute gross income for this asset
      let grossIncome;
      if (a.category === "equities") {
        grossIncome = (balances[a.id] || 0) * ((a.dividendYield || 0) / 100);
      } else {
        const scale = balances[a.id] / (a.value || 1);
        grossIncome = (a.income || 0) * (isFinite(scale) ? Math.max(0, scale) : 1);
      }
      if (a.category === "investmentProperty" || a.category === "property") {
        // Investment properties: rent and running expenses go to propertyCashFlow.
        // (Tax effect is handled separately above via rentalAdjustmentByEarner.)
        const runningExp = (a.runningExpenses || 0);
        propertyCashFlow += grossIncome - runningExp;
      } else if (grossIncome > 0) {
        assetIncome += grossIncome;
        const frankedPct = (a.frankedRate || 0) / 100;
        const grossedUp = grossIncome + grossIncome * frankedPct * (30 / 70);
        const frankingCredit = grossIncome * frankedPct * (30 / 70);
        distributeByOwnership(a, grossedUp, assetIncomeAdjustmentByEarner);
        if (frankingCredit > 0) distributeByOwnership(a, frankingCredit, frankingCreditByEarner);
      }
    });

    // ===== CGT on asset-sale events occurring this year =====
    // The "asset sale" event type takes proceeds + cost base. Discounted gain (if held >12 months)
    // adds to owner's taxable income. Net proceeds (after CGT) flow into cash via the lump.
    const cgtAdjustmentByEarner = {}; // earnerId → discounted capital gain (added to taxable)
    let cgtTaxThisYear = 0; // CGT actually paid this year (separate KPI)
    events.forEach(ev => {
      if (ev.type !== "assetSale") return;
      if (y < ev.yearOffset || y >= ev.yearOffset + (ev.duration || 1)) return;
      const proceeds = ev.amount || 0;
      const costBase = ev.costBase || 0;
      const gain = Math.max(0, proceeds - costBase);
      const discountedGain = ev.heldOverYear !== false ? gain * 0.5 : gain;
      const ownerId = ev.ownerId || (earners.find(en => (en.currency || "AUD") === "AUD" && (en.taxMode || "ato") === "ato")?.id);
      if (ownerId && discountedGain > 0) {
        cgtAdjustmentByEarner[ownerId] = (cgtAdjustmentByEarner[ownerId] || 0) + discountedGain;
      }
    });

    // Pre-compute per-earner deductible salary sacrifice (needed for MLS add-back later).
    // This duplicates a small piece of the main earner loop's logic, but doing it here lets us
    // compute MLS income before the main tax computation.
    const deductibleSacrificeByEarner = {};
    earners.forEach(e => {
      const st = earnerState[e.id];
      if (st.retired || (e.currency || "AUD") !== "AUD") { deductibleSacrificeByEarner[e.id] = 0; return; }
      const base = st.salary;
      const bonusCash = base * ((e.bonusRateCash || 0) / 100);
      const bonusShares = base * ((e.bonusRateShares || 0) / 100);
      const grossAud = base + bonusCash + bonusShares;
      const sgBase = (e.superSgIncludesBonus ? grossAud : base);
      const sgContrib = sgBase * ((e.superSgRate ?? 12) / 100);
      const matchConcessional = grossAud * ((e.superMatchConcessionalRate || 0) / 100);
      const extraConcessional = grossAud * ((e.superExtraConcessionalRate || 0) / 100);
      const capRoom = Math.max(0, concessionalCap - sgContrib - matchConcessional);
      deductibleSacrificeByEarner[e.id] = Math.min(extraConcessional, capRoom);
    });

    // Pre-compute household MLS income for family thresholds.
    // ATO definition of MLS income: taxable income + reportable super contribs (deductible sal-sac)
    //   + net investment losses (added back when negative) + (we don't model FBT or trust dist).
    // MLS income per earner = taxable + deductible sal-sac (added back) + max(0, -rentalAdj) (negative
    //   gearing losses added back). Asset income and CGT are already in taxable.
    const mlsIncomeByEarner = {};
    let householdMlsIncome = 0;
    earners.forEach(e => {
      const st = earnerState[e.id];
      if (st.retired || (e.currency || "AUD") !== "AUD" || (e.taxMode || "ato") !== "ato") {
        mlsIncomeByEarner[e.id] = 0;
        return;
      }
      const base = st.salary;
      const bonus = base * (((e.bonusRateCash || 0) + (e.bonusRateShares || 0)) / 100);
      const rentalAdj = rentalAdjustmentByEarner[e.id] || 0;
      const assetAdj = assetIncomeAdjustmentByEarner[e.id] || 0;
      const cgtAdj = cgtAdjustmentByEarner[e.id] || 0;
      const taxableForMls = base + bonus - (deductibleSacrificeByEarner[e.id] || 0) + rentalAdj + assetAdj + cgtAdj;
      // Add back: deductible sacrifice + abs of any negative rental
      const addBackSacrifice = deductibleSacrificeByEarner[e.id] || 0;
      const addBackInvestmentLoss = rentalAdj < 0 ? -rentalAdj : 0;
      const mlsIncome = Math.max(0, taxableForMls) + addBackSacrifice + addBackInvestmentLoss;
      mlsIncomeByEarner[e.id] = mlsIncome;
      householdMlsIncome += mlsIncome;
    });

    // Count of dependent kids in this year (for MLS family threshold uplift)
    const dependentKidsThisYear = kids.filter(k => kidState[k.id]?.yearsRemaining > 0).length;

    // Pre-compute household income for MLS family thresholds (sum of all AUD ATO earners, after rental adj)
    let householdAtoIncome = 0;
    earners.forEach(e => {
      const st = earnerState[e.id];
      if (!st.retired && (e.currency || "AUD") === "AUD" && (e.taxMode || "ato") === "ato") {
        const base = st.salary;
        const bonus = base * (((e.bonusRateCash || 0) + (e.bonusRateShares || 0)) / 100);
        const rentalAdj = rentalAdjustmentByEarner[e.id] || 0;
        const assetAdj = assetIncomeAdjustmentByEarner[e.id] || 0;
        const cgtAdj = cgtAdjustmentByEarner[e.id] || 0;
        householdAtoIncome += base + bonus + rentalAdj + assetAdj + cgtAdj;
      }
    });

    const earnerBreakdown = {};
    earners.forEach(e => {
      const st = earnerState[e.id];
      const base = st.retired ? 0 : st.salary;
      const bonusCash = st.retired ? 0 : base * ((e.bonusRateCash || 0) / 100);
      const bonusShares = st.retired ? 0 : base * ((e.bonusRateShares || 0) / 100);
      const bonus = bonusCash + bonusShares;
      const grossLocal = base + bonus;

      const currency = e.currency || "AUD";
      const fx = currency === "SGD" ? fxSgdAud : 1.0;
      const grossAud = grossLocal * fx;
      const baseAud = base * fx;
      const bonusCashAud = bonusCash * fx;
      const bonusSharesAud = bonusShares * fx;

      // ===== Super contributions: compute first (needed for taxable-income calculation) =====
      let sgContrib = 0, extraConcessional = 0, nonConcessional = 0;
      let matchConcessional = 0, matchNonConcessional = 0;
      let totalConcessional = 0, totalNonConcessional = 0;
      let concessionalWithinCap = 0, concessionalExcess = 0;
      let nonConcessionalWithinCap = 0, nonConcessionalExcess = 0;
      let concessionalTax = 0, div293Tax = 0, excessConcessionalTax = 0;
      let netSuperIn = 0;
      // Salary sacrifice that successfully reduces taxable income (capped at concessional cap minus SG/match)
      let taxDeductibleSacrifice = 0;

      if (!st.retired && currency === "AUD") {
        // SG: by default on base only; opt-in to include bonus
        const sgBase = (e.superSgIncludesBonus ? grossAud : baseAud);
        sgContrib = sgBase * ((e.superSgRate ?? 12) / 100);
        extraConcessional = grossAud * ((e.superExtraConcessionalRate || 0) / 100);
        nonConcessional = grossAud * ((e.superExtraNonConcessionalRate || 0) / 100);
        matchConcessional = grossAud * ((e.superMatchConcessionalRate || 0) / 100);
        matchNonConcessional = grossAud * ((e.superMatchNonConcessionalRate || 0) / 100);

        totalConcessional = sgContrib + extraConcessional + matchConcessional;
        totalNonConcessional = nonConcessional + matchNonConcessional;

        concessionalWithinCap = Math.min(totalConcessional, concessionalCap);
        concessionalExcess = Math.max(0, totalConcessional - concessionalCap);

        // Salary sacrifice that successfully reduces taxable income — only the portion within cap.
        // Order: SG and match are mandatory; sacrifice fills remaining cap room.
        const capRoomAfterSgAndMatch = Math.max(0, concessionalCap - sgContrib - matchConcessional);
        taxDeductibleSacrifice = Math.min(extraConcessional, capRoomAfterSgAndMatch);

        concessionalTax = totalConcessional * SUPER_CONTRIB_TAX;

        // Div 293: applies to within-cap concessional when (taxable income before sacrifice) + concessional > $250k
        const div293Income = grossAud + concessionalWithinCap;
        if (div293Income > DIV293_THRESHOLD) {
          const excessOverThreshold = div293Income - DIV293_THRESHOLD;
          const div293Base = Math.min(concessionalWithinCap, excessOverThreshold);
          div293Tax = div293Base * DIV293_EXTRA_TAX;
        }

        nonConcessionalWithinCap = Math.min(totalNonConcessional, nonConcessionalCap);
        nonConcessionalExcess = Math.max(0, totalNonConcessional - nonConcessionalCap);

        // Excess concessional: still hits the fund and is taxed 15% there. The personal MTR-minus-15%
        // tax is added to taxAud below. The post-15% remainder stays in super (default ATO outcome
        // when user doesn't issue a release authority).
        // Excess non-concessional: already after-tax money — full amount stays in super (no penalty
        // modelled; user assumed not to withdraw via release authority).
        netSuperIn = (concessionalWithinCap + concessionalExcess) * (1 - SUPER_CONTRIB_TAX)
                   + nonConcessionalWithinCap + nonConcessionalExcess;
      }

      // ===== Compute taxable income (now that we know the deductible sacrifice) =====
      // Taxable income for ATO earners = gross − deductible salary sacrifice + rental + asset income (grossed-up) + CGT
      // For SG earners and flat-tax mode, these don't apply.
      const isAudAto = (currency === "AUD" && (e.taxMode || "ato") === "ato");
      const rentalAdj = isAudAto ? (rentalAdjustmentByEarner[e.id] || 0) : 0;
      const assetAdj = isAudAto ? (assetIncomeAdjustmentByEarner[e.id] || 0) : 0;
      const cgtAdj = isAudAto ? (cgtAdjustmentByEarner[e.id] || 0) : 0;
      const frankingCredit = isAudAto ? (frankingCreditByEarner[e.id] || 0) : 0;
      const taxableLocal = (currency === "AUD")
        ? (grossLocal - taxDeductibleSacrifice / fx + (rentalAdj + assetAdj + cgtAdj) / fx)
        : grossLocal;
      const earnerMlsIncome = isAudAto ? (mlsIncomeByEarner[e.id] || 0) : undefined;
      const taxLocalBeforeFranking = computeEarnerTax(e, taxableLocal, currency === "AUD" ? householdMlsIncome : undefined, dependentKidsThisYear, earnerMlsIncome);
      // Franking credits offset tax 1-for-1 (refundable for low-income; here we cap at total tax for simplicity)
      const taxLocal = Math.max(0, taxLocalBeforeFranking - frankingCredit / fx);

      let taxAud = taxLocal * fx;
      // Excess concessional: on ATO earners, taxed at marginal rate over and above the 15% contribs tax
      if (concessionalExcess > 0 && (e.taxMode || "ato") === "ato") {
        const taxAtGross = atoTotalTax(taxableLocal * fx, e.hasPrivateHealth !== false, householdMlsIncome, dependentKidsThisYear, earnerMlsIncome);
        const taxAtPlus1k = atoTotalTax(taxableLocal * fx + 1000, e.hasPrivateHealth !== false, householdMlsIncome, dependentKidsThisYear, earnerMlsIncome);
        const mtr = (taxAtPlus1k - taxAtGross) / 1000;
        excessConcessionalTax = concessionalExcess * Math.max(0, mtr - SUPER_CONTRIB_TAX);
      } else if (concessionalExcess > 0) {
        excessConcessionalTax = concessionalExcess * Math.max(0, ((e.taxRate || 30) / 100) - SUPER_CONTRIB_TAX);
      }
      taxAud += div293Tax + excessConcessionalTax;

      // ===== Net cash to household =====
      // Starts from (gross − tax) in AUD, minus things that don't reach the wallet:
      //   - share bonus value (routed to share plan)
      //   - salary sacrifice (taken pre-tax, but it's the deductible portion that's removed from gross already
      //     via the lower taxable income; for non-deductible excess, those dollars still leave the wallet)
      //   - non-concessional contributions (paid from after-tax cash)
      //   - Div 293 + excess concessional tax (paid by individual)
      // Note: extra concessional NOT in the deductible portion (i.e. the excess amount) is still removed from
      // wallet because it's still going to super; just not tax-deductible.
      const nonDeductibleSacrifice = Math.max(0, extraConcessional - taxDeductibleSacrifice);
      let netAud = grossAud - taxAud - bonusSharesAud - taxDeductibleSacrifice - nonDeductibleSacrifice - nonConcessional;
      // (Note: taxAud already includes div293 and excess concessional tax above)

      const netLocal = taxableLocal - taxLocal;  // simplified local-currency net (for SG earner display)

      totalGross += grossAud;
      totalNet += netAud;
      totalTax += taxAud;
      // Cashflow chart components (salary base + cash bonuses; share bonuses go directly to shares)
      cfSalary += baseAud;
      cfCashBonus += bonusCashAud;
      superContribByEarner[e.id] = netSuperIn;
      shareBonusByEarner[e.id] = bonusSharesAud;
      earnerBreakdown[e.id] = {
        name: e.name, currency, fx,
        baseLocal: base, bonusLocal: bonus, bonusCashLocal: bonusCash, bonusSharesLocal: bonusShares,
        grossLocal, taxableLocal, taxLocal, netLocal,
        base: baseAud, bonus: bonus * fx, bonusCash: bonusCashAud, bonusShares: bonusSharesAud,
        gross: grossAud, taxable: taxableLocal * fx, tax: taxAud, net: netAud,
        retired: st.retired,
        // Super components (AUD only)
        sgContrib, extraConcessional, nonConcessional, matchConcessional, matchNonConcessional,
        taxDeductibleSacrifice,
        totalConcessional, totalNonConcessional,
        concessionalWithinCap, concessionalExcess,
        nonConcessionalWithinCap, nonConcessionalExcess,
        concessionalTax, div293Tax, excessConcessionalTax,
        netSuperIn,
        // Tax-related metadata for transparency
        hasPrivateHealth: e.hasPrivateHealth !== false,
        sgIncludesBonus: !!e.superSgIncludesBonus,
      };
    });

    // Amortisation: use precomputed offset-aware interest. Principal = scheduled payment − interest.
    let totalLiabPayment = 0;
    Object.keys(liabs).forEach(key => {
      if (liabs[key] <= 0) return;
      const m = loanMeta[key];
      if (!m) return;
      if (m.type === "pi" && m.yearsElapsed >= m.termYears) {
        liabs[key] = 0;
        return;
      }
      const r = m.rate / 100;
      const interest = interestThisYear[key] || 0;
      let payment;
      if (m.type === "io") {
        if (m.yearsElapsed < m.ioPeriod) {
          // During the IO period: interest only
          payment = interest;
        } else {
          // After IO period: convert to P&I, amortise current balance over REMAINING term
          const remainingTerm = Math.max(1, m.termYears - m.ioPeriod);
          const yearsInPi = m.yearsElapsed - m.ioPeriod;
          if (yearsInPi >= remainingTerm) {
            // Beyond P&I term too — should have paid off already
            liabs[key] = 0;
            payment = 0;
          } else {
            // P&I payment is computed on the balance AT conversion (capture once via originalBalance)
            // We use current balance as the basis since we don't store conversion balance separately —
            // simpler approximation: amortise over remainingTerm starting now.
            const P = liabs[key] + interest; // approximate balance at start of this year
            const n = remainingTerm - yearsInPi;
            payment = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
            if (payment > liabs[key] + interest) payment = liabs[key] + interest;
          }
        }
      } else {
        const P = m.originalBalance || liabs[key];
        const n = m.termYears;
        payment = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
        if (payment > liabs[key] + interest) payment = liabs[key] + interest;
      }
      const principal = Math.max(0, payment - interest);
      liabs[key] = Math.max(0, liabs[key] - principal);
      totalLiabPayment += payment;
      m.yearsElapsed += 1;
    });

    let schoolFees = 0;
    const feesByKid = {};
    kids.forEach(k => {
      const st = kidState[k.id];
      if (st.yearsRemaining > 0) {
        schoolFees += st.fees;
        feesByKid[k.id] = { name: k.name, fees: st.fees };
      }
    });

    // Determine if household is fully retired this year (used for retirement spending multiplier)
    const allRetiredThisYear = earners.length > 0 && earners.every(e => earnerState[e.id].retired);
    const retirementMult = allRetiredThisYear ? (meta.retirementSpendingMultiplier ?? 1.0) : 1.0;

    // Living expenses: sum active items (within start/end window)
    // When household is fully retired, scale by retirementSpendingMultiplier (default 1.0 = no change).
    let expenses = 0;
    const expenseBreakdown = {};
    expenseItems.forEach(x => {
      const startY = x.startYear ?? 0;
      const endY = x.endYear;
      const active = y >= startY && (endY == null || y <= endY);
      if (active) {
        const adjusted = expenseState[x.id] * retirementMult;
        expenses += adjusted;
        expenseBreakdown[x.id] = { name: x.name, amount: adjusted, growthPct: x.growth || 0, startYear: x.startYear ?? 0 };
      }
    });

    let eventExpense = 0;
    let eventLump = 0;
    let eventLumpCategory = "cash";
    const activeEvents = [];
    events.forEach(e => {
      const active = y >= e.yearOffset && y < e.yearOffset + (e.duration || 1);
      if (!active) return;
      activeEvents.push(e.name);
      if (e.type === "expense") eventExpense += e.amount;
      if (e.type === "lump" && y === e.yearOffset) {
        eventLump += e.amount;
        eventLumpCategory = e.category || "cash";
      }
      if (e.type === "assetSale" && y === e.yearOffset) {
        // Proceeds enter cash; CGT (if any) was added to the owner's taxable income, so the tax bill
        // already captures the CGT cost. Net wealth effect = proceeds (full) less tax bill increase.
        eventLump += e.amount;
        eventLumpCategory = e.category || "cash";
      }
      if (e.type === "income") assetIncome += e.amount;
    });

    const netCashflow = totalNet + assetIncome + propertyCashFlow - expenses - totalLiabPayment - eventExpense - schoolFees;

    // Asset growth — offset accounts don't grow (their benefit is reducing loan interest, not earning return)
    assets.forEach(a => {
      if (a.category === "offset") return;
      balances[a.id] = balances[a.id] * (1 + a.growth / 100);
    });

    earners.forEach(e => {
      const contrib = superContribByEarner[e.id];
      if (!contrib) return;
      const earnerSupers = assets.filter(a => a.category === "super" && a.earnerId === e.id);
      if (earnerSupers.length > 0) {
        const per = contrib / earnerSupers.length;
        earnerSupers.forEach(a => { balances[a.id] += per; });
      } else {
        const anySupers = assets.filter(a => a.category === "super");
        if (anySupers.length > 0) {
          const per = contrib / anySupers.length;
          anySupers.forEach(a => { balances[a.id] += per; });
        }
      }
    });

    // ===== Route share bonus to chosen Shares asset =====
    // Each earner can pick `sharePlanAssetId` — one asset their share bonus vests into.
    // Fallback chain: chosen asset → first equity asset → silently lost (user warning shown elsewhere)
    earners.forEach(e => {
      const shareIn = shareBonusByEarner[e.id];
      if (!shareIn) return;
      const target = e.sharePlanAssetId
        ? assets.find(a => a.id === e.sharePlanAssetId && a.category === "equities")
        : null;
      if (target) {
        balances[target.id] += shareIn;
        return;
      }
      // Fallback: first equity asset (if any)
      const anyEquity = assets.find(a => a.category === "equities");
      if (anyEquity) {
        balances[anyEquity.id] += shareIn;
      }
      // Otherwise lost — earner row shows a warning
    });

    const cashAssets = assets.filter(a => a.category === "cash");
    if (cashAssets.length > 0) balances[cashAssets[0].id] += netCashflow;
    if (eventLump !== 0) {
      const targets = assets.filter(a => a.category === eventLumpCategory);
      if (targets.length > 0) balances[targets[0].id] += eventLump;
      else if (cashAssets.length > 0) balances[cashAssets[0].id] += eventLump;
    }

    // ===== End-of-year cash sweep automation =====
    // If user has enabled cash optimisation, sweep cash above the buffer into the chosen target.
    // Modes: "off" (no sweep) | "offset" (into a designated loan's offsetBalance) | "equities" (into a designated equity asset).
    // For "offset" mode, if the target loan can only absorb part of the excess (because its balance
    // is smaller than excess), the remainder spills to the designated equity asset.
    const opt = meta.cashOptimisation || {};
    if (opt.enabled && opt.mode && opt.mode !== "off") {
      const sourceId = opt.sweepSourceAssetId;
      const sourceAsset = assets.find(a => a.id === sourceId && a.category === "cash");
      if (sourceAsset) {
        const buffer = opt.minBuffer || 0;
        let excess = (balances[sourceAsset.id] || 0) - buffer;
        if (excess > 0) {
          if (opt.mode === "offset" && opt.sweepTargetOffsetLoanKey) {
            const loanKey = opt.sweepTargetOffsetLoanKey;
            if (liabs[loanKey] != null) {
              // Available room = loan balance − current offset balance
              const room = Math.max(0, liabs[loanKey] - (offsetByLoan[loanKey] || 0));
              const intoOffset = Math.min(excess, room);
              if (intoOffset > 0) {
                offsetByLoan[loanKey] = (offsetByLoan[loanKey] || 0) + intoOffset;
                balances[sourceAsset.id] -= intoOffset;
                excess -= intoOffset;
              }
            }
          }
          // Remaining excess (or pure equities mode) flows to the designated equity asset
          if (excess > 0 && opt.sweepTargetEquityAssetId) {
            const equityAsset = assets.find(a => a.id === opt.sweepTargetEquityAssetId && (a.category === "equities"));
            if (equityAsset) {
              balances[equityAsset.id] = (balances[equityAsset.id] || 0) + excess;
              balances[sourceAsset.id] -= excess;
            }
          }
        }
      }
    }
    // ===== END cash sweep =====

    const byCat = { primaryResidence: 0, investmentProperty: 0, equities: 0, cash: 0, offset: 0, super: 0, other: 0 };
    assets.forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + balances[a.id]; });
    // Sum loan-attached offset balances into the cash stack for the wealth chart.
    // (Offsets are conceptually cash that's reducing loan interest — still household money.)
    Object.values(offsetByLoan).forEach(bal => { byCat.offset += bal || 0; });
    const totalAssets = Object.values(byCat).reduce((s, v) => s + v, 0);
    const totalLiab = Object.values(liabs).reduce((s, v) => s + v, 0);
    const netWealth = totalAssets - totalLiab;

    const allRetired = earners.every(e => earnerState[e.id].retired);
    const anyRetired = earners.some(e => earnerState[e.id].retired);

    // Per-loan balances flattened as top-level row fields (loan_KEY) for stacked chart use.
    // Also include a structured loanBreakdown for the Trace tab.
    const loanFlat = {};
    const loanBreakdown = {};
    Object.keys(liabs).forEach(key => {
      loanFlat[`loan_${key}`] = liabs[key];
      loanBreakdown[key] = {
        balance: liabs[key],
        offset: offsetByLoan[key] || 0,
        rate: loanMeta[key]?.rate || 0,
        type: loanMeta[key]?.type,
        assetId: loanMeta[key]?.assetId,
      };
    });

    rows.push({
      year: y, age, ...byCat, totalAssets, liabilities: totalLiab, netWealth, netCashflow,
      totalGross, totalNet, totalTax, expenses, expenseBreakdown,
      schoolFees, earnerBreakdown, feesByKid, allRetired, anyRetired, activeEvents,
      // Per-loan balance fields for stacked liability chart
      ...loanFlat,
      loanBreakdown,
      // Engine internals exposed for the calculation Trace tab:
      totalLiabPayment, assetIncome, eventLump, eventExpense,
      // ===== Cashflow chart fields =====
      // Income-side (positive values stack above x-axis) — cash only, no share grants
      cf_salary: cfSalary,
      cf_cashBonus: cfCashBonus,
      cf_assetIncome: assetIncome,                                // dividends, interest from non-property assets
      cf_rentalPos: cfRentalNet > 0 ? cfRentalNet : 0,            // positive when rent > expenses+interest
      cf_eventIncome: eventLump > 0 ? eventLump : 0,              // one-off positive lumps
      // Expense-side (negative values stack below x-axis)
      cf_living: -expenses,
      cf_schoolFees: -schoolFees,
      cf_loanRepayments: -totalLiabPayment,
      cf_rentalNeg: cfRentalNet < 0 ? cfRentalNet : 0,            // negative-gearing year
      cf_tax: -totalTax,                                          // total household tax (income tax + Medicare + MLS + super excess)
      cf_eventExpense: -eventExpense,
      // Net cashflow — true free cash at end of year (income minus all expenses including tax)
      cf_net: cfSalary + cfCashBonus + assetIncome + cfRentalNet + (eventLump > 0 ? eventLump : 0)
            - expenses - schoolFees - totalLiabPayment - totalTax - eventExpense,
    });

    earners.forEach(e => {
      if (!earnerState[e.id].retired) earnerState[e.id].salary *= (1 + e.salaryGrowth / 100);
    });
    // Grow each expense item by its own growth rate
    expenseItems.forEach(x => {
      expenseState[x.id] *= (1 + (x.growth || 0) / 100);
    });
    kids.forEach(k => {
      const st = kidState[k.id];
      if (st.yearsRemaining > 0) {
        st.fees *= (1 + k.feeGrowth / 100);
        st.yearsRemaining -= 1;
      }
    });
  }

  return rows;
}

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

// Six-dot drag handle to grab a row by. Sits on the left edge.
function DragHandle({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to reorder"
      style={{
        cursor: "grab",
        color: C.textMute,
        opacity: 0.5,
        padding: "0 4px",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        fontSize: 12,
        letterSpacing: "-2px",
      }}
    >
      ⋮⋮
    </div>
  );
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
  const [hoverYear, setHoverYear] = useState(null);
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
  const fileInputRef = useRef(null);

  // Auto-dismiss toasts after 3s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ===== Load scenarios when ready (Supabase if authenticated, else localStorage) =====
  useEffect(() => {
    if (!authReady) return;
    // Reset the supabaseIdByName ref whenever auth state changes — a different user means different IDs
    supabaseIdByName.current = {};
    (async () => {
      let loadedData = null;
      let didMigrateLocal = false;

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
                didMigrateLocal = true;
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
          // Capture supabase id into the ref (not state)
          if (scen._supabaseId) supabaseIdByName.current[name] = scen._supabaseId;
          const m = migrateScenario(scen);
          if (m) {
            // Strip _supabaseId from state so it never triggers re-saves
            const { _supabaseId, ...clean } = m;
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
      setLoaded(true);
      // Reset slider when session changes so the user sees the new horizon
      setSelectedYear(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session?.user?.id]);

  // Track Supabase row IDs by scenario name in a ref — does NOT trigger re-renders or re-saves
  const supabaseIdByName = useRef({});

  // ===== Save scenarios on change =====
  // Debounced save: when scenarios change, wait 800ms then persist. Avoids spamming Supabase
  // on every keystroke. Also writes to localStorage as a fallback cache.
  useEffect(() => {
    if (!loaded) return;
    saveToLocalStorage({ scenarios, active: activeScenario }); // always cache locally
    if (!SUPABASE_ENABLED || !session?.user?.id) return;
    setSyncStatus("saving");
    const handle = setTimeout(async () => {
      // Build scenarios with _supabaseId stamped from the ref (so upsert uses UPDATE for known rows)
      const scenariosWithIds = {};
      for (const [name, scen] of Object.entries(scenarios)) {
        scenariosWithIds[name] = supabaseIdByName.current[name]
          ? { ...scen, _supabaseId: supabaseIdByName.current[name] }
          : scen;
      }
      const result = await saveToSupabase(session.user.id, { scenarios: scenariosWithIds, active: activeScenario });
      if (result.ok) {
        setSyncStatus("idle");
        // Update the ref with any new IDs from the response — does not trigger re-render
        if (result.idByName) {
          for (const [name, id] of Object.entries(result.idByName)) {
            supabaseIdByName.current[name] = id;
          }
        }
      } else {
        setSyncStatus("error");
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [scenarios, activeScenario, loaded, session?.user?.id]);

  const state = scenarios[activeScenario] || DEFAULT_STATE;

  const setState = (updater) => {
    setScenarios(prev => {
      const current = prev[activeScenario] || DEFAULT_STATE;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activeScenario]: next };
    });
  };

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

  const renameScenario = (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    if (scenarios[trimmed]) {
      setToast({ kind: "err", msg: `"${trimmed}" already exists` });
      return;
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
    // Best-effort Supabase delete + clean ref
    if (supabaseId) deleteFromSupabase(supabaseId);
    delete supabaseIdByName.current[name];
  };

  const resetDefaults = () => {
    setConfirmModal({
      msg: `Reset the current scenario "${activeScenario}" to default. Other scenarios are unaffected.`,
      onConfirm: () => {
        setScenarios(prev => ({ ...prev, [activeScenario]: DEFAULT_STATE }));
      },
    });
  };

  // --- Export / Import ---
  const download = (payload, filename) => {
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      setToast({ kind: "ok", msg: `Saved ${filename}` });
    } catch (err) {
      // Fallback: open data URL in new tab so user can save manually
      try {
        const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
        window.open(dataUrl, "_blank");
        setToast({ kind: "warn", msg: "Download may be blocked — opened in new tab. Right-click → Save As." });
      } catch (e2) {
        setToast({ kind: "err", msg: "Could not save: " + err.message });
      }
    }
  };

  const saveAs = () => {
    download(
      { name: activeScenario, scenario: state, exportedAt: new Date().toISOString(), version: 4 },
      `scenario-${activeScenario.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
    );
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.scenarios) {
          const migrated = {};
          Object.entries(data.scenarios).forEach(([n, s]) => {
            const m = migrateScenario(s);
            if (m) migrated[n] = m;
          });
          const overwriteCount = Object.keys(migrated).filter(n => scenarios[n]).length;
          const msg = overwriteCount > 0
            ? `Import ${Object.keys(migrated).length} scenarios? ${overwriteCount} existing scenario(s) with the same name will be overwritten.`
            : `Import ${Object.keys(migrated).length} scenarios?`;
          setConfirmModal({
            msg,
            onConfirm: () => {
              setScenarios(prev => ({ ...prev, ...migrated }));
              if (data.active && migrated[data.active]) setActiveScenario(data.active);
              setToast({ kind: "ok", msg: `Imported ${Object.keys(migrated).length} scenarios` });
            },
          });
        } else if (data.scenario && data.name) {
          const migrated = migrateScenario(data.scenario);
          if (!migrated) {
            setToast({ kind: "err", msg: "Scenario data is invalid" });
            return;
          }
          const name = data.name;
          setScenarios(prev => ({ ...prev, [name]: migrated }));
          setActiveScenario(name);
          setToast({ kind: "ok", msg: `Imported "${name}"` });
        } else {
          setToast({ kind: "err", msg: "Unrecognised file format" });
        }
      } catch (err) {
        setToast({ kind: "err", msg: "Could not parse file: " + err.message });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // --- CRUD helpers ---
  const addAsset = () => {
    const id = `a${Date.now()}`;
    setState(s => ({ ...s, assets: [...s.assets, { id, name: "New asset", category: "cash", value: 10000, growth: 4, income: 0 }] }));
    setEditingAsset(id);
  };
  const addOffset = () => {
    const id = `a${Date.now()}`;
    setState(s => ({ ...s, assets: [...s.assets, { id, name: "Offset account", category: "offset", value: 0, growth: 0, income: 0 }] }));
    setEditingAsset(id);
  };
  const addSuper = () => {
    const id = `a${Date.now()}`;
    setState(s => ({ ...s, assets: [...s.assets, { id, name: "Super", category: "super", value: 0, growth: 7, income: 0 }] }));
    setEditingAsset(id);
  };
  const updateAsset = (id, patch) => setState(s => ({ ...s, assets: s.assets.map(a => a.id === id ? { ...a, ...patch } : a) }));
  const removeAsset = (id) => setState(s => ({ ...s, assets: s.assets.filter(a => a.id !== id) }));

  const addLiab = () => {
    const id = `l${Date.now()}`;
    setState(s => ({ ...s, liabilities: [...s.liabilities, { id, name: "New debt", balance: 0, rate: 6, type: "pi", termYears: 30 }] }));
    setEditingLiab(id);
  };
  const updateLiab = (id, patch) => setState(s => ({ ...s, liabilities: s.liabilities.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const removeLiab = (id) => setState(s => ({ ...s, liabilities: s.liabilities.filter(l => l.id !== id) }));

  const addEarner = () => {
    const id = `earner${Date.now()}`;
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
    const id = `k${Date.now()}`;
    setState(s => ({ ...s, kids: [...s.kids, { id, name: `Kid ${s.kids.length + 1}`, annualFees: 30000, yearsRemaining: 6, feeGrowth: 5 }] }));
    setEditingKid(id);
  };
  const updateKid = (id, patch) => setState(s => ({ ...s, kids: s.kids.map(k => k.id === id ? { ...k, ...patch } : k) }));
  const removeKid = (id) => setState(s => ({ ...s, kids: s.kids.filter(k => k.id !== id) }));

  const addEvent = () => {
    const id = `e${Date.now()}`;
    setState(s => ({ ...s, events: [...s.events, { id, name: "New event", yearOffset: 5, duration: 1, type: "expense", amount: 10000, category: "cash" }] }));
    setEditingEvent(id);
  };
  const updateEvent = (id, patch) => setState(s => ({ ...s, events: s.events.map(e => e.id === id ? { ...e, ...patch } : e) }));
  const removeEvent = (id) => setState(s => ({ ...s, events: s.events.filter(e => e.id !== id) }));

  const addExpense = () => {
    const id = `x${Date.now()}`;
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
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Inter+Tight:wght@300;400;500;600&display=swap');
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
          {SUPABASE_ENABLED && session && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, fontSize: 10, color: C.textMute, letterSpacing: "0.05em" }}>
              {syncStatus === "saving" && <><Cloud size={11} /> Saving…</>}
              {syncStatus === "idle" && <><Cloud size={11} color={C.good} /> Synced</>}
              {syncStatus === "error" && <><CloudOff size={11} color={C.danger} /> Save failed</>}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImport} style={{ display: "none" }} />
          <button onClick={() => fileInputRef.current?.click()} className="fp-btn" style={btnGhost} title="Load scenarios from file">
            <Upload size={13} /> Load
          </button>
          <button onClick={saveAs} className="fp-btn" style={btnGhost} title="Save current scenario to file">
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
              <button onClick={() => deleteScenario(name)} style={{ background: "transparent", border: "none", color: C.textMute, cursor: "pointer", padding: 4, opacity: 0.4 }}>
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
          </div>

          {/* Cash optimisation panel */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
              Cash Optimisation
            </div>
            <CashOptimisationEditor state={state} setState={setState} />
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: C.textMute, letterSpacing: "0.05em" }}>
            Australian tax: ATO 2025–26 progressive + 2% Medicare. Singapore: IRAS resident YA2026. Super: 15% contribs tax on concessional contributions within cap; Division 293 (extra 15%) when income + concessional contribs exceed $250k; excess concessional taxed at marginal rate. Per-earner currency, tax method, and super contribution rates are set in the Income panel.
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
                  <ComposedChart data={displayedProjection} margin={{ top: 36, right: 10, left: 0, bottom: 0 }}
                    onMouseMove={(e) => { if (e && e.activeLabel != null) setHoverYear(e.activeLabel); }}
                    onMouseLeave={() => setHoverYear(null)}
                  >
                    <CartesianGrid stroke={C.line} strokeDasharray="0" vertical={false} />
                    <XAxis dataKey="year" stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(y) => `+${y}`} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} />
                    <YAxis stroke={C.textMute} tick={{ fill: C.textMute, fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v) => fmt(v)} axisLine={{ stroke: C.line }} tickLine={{ stroke: C.line }} width={60} />
                    <Tooltip content={<CustomTooltip events={state.events} />} />
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
                        label={{ value: e.name, position: "top", fill: e.type === "retirement" ? C.accent : C.textMute, fontSize: 13, fontFamily: "Inter Tight", fontWeight: 400 }}
                      />
                    ))}
                  </ComposedChart>
                ) : (
                <AreaChart data={displayedProjection} margin={{ top: 36, right: 10, left: 0, bottom: 0 }}
                  onMouseMove={(e) => { if (e && e.activeLabel != null) setHoverYear(e.activeLabel); }}
                  onMouseLeave={() => setHoverYear(null)}
                >
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
                  <Tooltip content={<CustomTooltip events={state.events} />} />
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
                  {CATEGORY_ORDER.includes(view) && (
                    <Area type="monotone" dataKey={view} stroke={CATEGORY_META[view].color} strokeWidth={2} fill={`url(#grad-${view})`} />
                  )}
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
                      label={{ value: e.name, position: "top", fill: e.type === "retirement" ? C.accent : C.textMute, fontSize: 13, fontFamily: "Inter Tight", fontWeight: 400 }}
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
                <AssetRow a={a} earners={state.earners} offsetAssets={state.assets.filter(x => x.category === "offset")}
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
                <AssetRow a={a} earners={state.earners} offsetAssets={state.assets.filter(x => x.category === "offset")}
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
                <ExpenseRow x={x} maxYear={state.meta.horizonYears} currentAge={state.meta.currentAge}
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
                <LiabRow l={l} earners={state.earners} offsetAssets={state.assets.filter(x => x.category === "offset")}
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
        <LogicTab state={state} currentRow={currentRow} displayMode={displayMode} selectedYear={selectedYear ?? state.meta.horizonYears} setSelectedYear={setSelectedYear} />
      )}

      {activeTab === "trace" && (
        <TraceTab state={state} currentRow={currentRow} displayMode={displayMode} selectedYear={selectedYear ?? state.meta.horizonYears} setSelectedYear={setSelectedYear} projection={displayedProjection} />
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
            <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>Confirm</div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20, lineHeight: 1.5 }}>{confirmModal.msg}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmModal(null)} className="fp-btn" style={btnGhost}>Cancel</button>
              <button onClick={() => { confirmModal.onConfirm?.(); setConfirmModal(null); }}
                className="fp-btn"
                style={{ ...btnGhost, background: C.accent, color: C.bg, borderColor: C.accent }}>
                Confirm
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
        <button onClick={onAdd} className="fp-btn" style={btnGhostSm}><Plus size={12} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label, events }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const activeEvts = events.filter(e => label >= e.yearOffset && label < e.yearOffset + (e.duration || 1));
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
              {ev.amount > 0 && ` · ${fmt(ev.amount)}`}
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
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostSm, color: C.danger }}><Trash2 size={11} /></button>
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
        {canRemove && <button onClick={(ev) => { ev.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}><Trash2 size={10} /></button>}
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
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}><Trash2 size={10} /></button>
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

function ExpenseRow({ x, maxYear, currentAge, editing, onEdit, onChange, onRemove }) {
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
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}><Trash2 size={10} /></button>
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

function AssetRow({ a, earners, offsetAssets = [], editing, onEdit, onChange, onRemove }) {
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
      id: `ln${Date.now()}`,
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
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}><Trash2 size={10} /></button>
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
          {/* Franking — for equities/sharePlan with yield, OR other assets with positive flat income */}
          {!isOffset && ((a.category === "equities") ? (a.dividendYield ?? 0) > 0 : (a.income > 0 && a.category !== "property" && a.category !== "super")) && (
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

function LiabRow({ l, earners = [], offsetAssets = [], editing, onEdit, onChange, onRemove }) {
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
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="fp-btn" style={{ ...btnGhostXs, color: C.danger }}><Trash2 size={10} /></button>
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
          {earnerList.map((e, i) => <IncomeFlow key={i} e={e} state={state} />)}
        </div>
      </div>

      {/* Calculation cards */}
      <div>
        <div className="serif" style={{ fontSize: 18, fontStyle: "italic", marginBottom: 12 }}>Calculation cards</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          <TaxCard earnerList={earnerList} />
          <SuperCard earnerList={earnerList} />
          <LoanCard state={state} currentRow={currentRow} />
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
function IncomeFlow({ e, state }) {
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

function LoanCard({ state, currentRow }) {
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
function TraceTab({ state, currentRow, selectedYear, setSelectedYear, projection }) {
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

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'Inter Tight', system-ui, sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Inter+Tight:wght@300;400;500;600&display=swap');
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
              <a onClick={() => { setMode("signup"); setError(null); setInfo(null); }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>Create account</a>
              <span style={{ margin: "0 8px" }}>·</span>
              <a onClick={() => { setMode("forgot"); setError(null); setInfo(null); }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>Forgot password?</a>
            </>
          )}
          {mode === "signup" && (
            <a onClick={() => { setMode("signin"); setError(null); setInfo(null); }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>
              Back to sign in
            </a>
          )}
          {mode === "forgot" && (
            <a onClick={() => { setMode("signin"); setError(null); setInfo(null); }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>
              Back to sign in
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
