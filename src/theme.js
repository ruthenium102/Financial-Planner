// =================================================================
// theme.js — design tokens, category metadata, formatters, shared styles
// =================================================================
import { Home, DollarSign, PiggyBank, Layers, TrendingUp } from "lucide-react";
import pkg from "../package.json";

// App version, derived from package.json so the two can't drift.
// Bump the package.json "version" field on every release.
export const VERSION = "v" + pkg.version.split(".").slice(0, 2).join(".");

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

export {
  C, CATEGORY_META, CATEGORY_ORDER, CASHFLOW_INCOME, CASHFLOW_EXPENSE,
  fmt, fmtFull, fmtCcy,
  btnGhost, btnGhostSm, btnGhostXs, btnTab, miniInput,
};
