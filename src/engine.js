// =================================================================
// engine.js — pure projection engine for The Ledger
// =================================================================
// Everything in this file is framework-free: plain data in, plain data out.
// It covers scenario defaults & migration, Australian (ATO) and Singapore
// (IRAS) tax, super contribution caps, loan amortisation, and the year-by-year
// wealth projection. Keep React and browser APIs out of here so the engine
// stays unit-testable (see engine.test.js).

// ID generator for scenario items (assets, loans, events, ...).
// crypto.randomUUID is available in all modern browsers and Node 19+;
// the fallback covers older WebViews.
export function genId(prefix) {
  const rand = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}${rand}`;
}

// ---------- Defaults ----------
const DEFAULT_STATE = {
  meta: {
    currentAge: 40, horizonYears: 30, inflation: 2.5, currency: "AUD", fxSgdAud: 1.10,
    retirementSpendingMultiplier: 0.75,
    drawdown: { enabled: true, superPreservationAge: 60 },
  },
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
        if (!ln.id) ln.id = genId("ln");
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

  // Shortfall drawdown defaults: fund cash deficits by selling assets
  // (other cash → equities → super once past preservation age).
  if (!out.meta.drawdown) {
    out.meta.drawdown = { enabled: true, superPreservationAge: 60 };
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
// Low-income phase-in (2024-25 single thresholds): no levy below the lower
// threshold; between there and ~$34,027 the levy is 10% of the excess.
const MEDICARE_LEVY_LOWER_THRESHOLD = 27222;
const MEDICARE_LEVY_PHASE_IN_RATE = 0.10;

// Medicare Levy Surcharge (2025-26 thresholds) — applies if no private hospital cover.
// Each band gives the rate paid on income ABOVE its floor:
//   Tier 1: 1.0%  above $101,000 (single) / $202,000 (family)
//   Tier 2: 1.25% above $118,000 / $236,000
//   Tier 3: 1.5%  above $158,000 / $316,000
// Family floors are increased by $1,500 for EACH dependent child after the first.
// Source: ATO, verified May 2026 — https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates
const MLS_BANDS = {
  single: [
    { above: 101000, rate: 0.010 },
    { above: 118000, rate: 0.0125 },
    { above: 158000, rate: 0.015 },
  ],
  family: [
    { above: 202000, rate: 0.010 },
    { above: 236000, rate: 0.0125 },
    { above: 316000, rate: 0.015 },
  ],
};
const MLS_KID_UPLIFT = 1500;  // +$1,500 per kid AFTER the first
// Returns the MLS *rate* that applies at this income level (0 with private cover
// or below the base threshold).
export function mlsRate(income, isFamily = false, dependentKids = 0) {
  const bands = isFamily ? MLS_BANDS.family : MLS_BANDS.single;
  const uplift = isFamily && dependentKids > 1 ? (dependentKids - 1) * MLS_KID_UPLIFT : 0;
  let rate = 0;
  for (const b of bands) {
    if (income > (b.above + uplift)) rate = b.rate;
  }
  return rate;
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
  // Medicare levy with the low-income phase-in: nil up to the lower threshold,
  // then 10c per dollar of the excess until that meets the flat 2% (~$34,027).
  // (Single-person thresholds; the family reduction isn't modelled.)
  tax += Math.min(
    taxableIncome * MEDICARE_LEVY_RATE,
    Math.max(0, (taxableIncome - MEDICARE_LEVY_LOWER_THRESHOLD) * MEDICARE_LEVY_PHASE_IN_RATE)
  );
  if (!hasPrivateHealth) {
    const isFamily = householdMlsIncome != null && householdMlsIncome > (mlsIncome ?? taxableIncome);
    const incomeForMlsCheck = householdMlsIncome ?? mlsIncome ?? taxableIncome;
    // MLS is applied to the individual's MLS income (or fall back to taxable income)
    tax += (mlsIncome ?? taxableIncome) * mlsRate(incomeForMlsCheck, isFamily, dependentKids);
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

      // Div 293: extra 15% on within-cap concessional contributions when Div-293
      // income exceeds $250k. Div-293 income = taxable income + net investment
      // losses (added back) + concessional contributions. (Computed here, after
      // taxable income, so salary sacrifice isn't double-counted.)
      if (concessionalWithinCap > 0) {
        const invLossAddBack = rentalAdj < 0 ? -rentalAdj : 0;
        const div293Income = taxableLocal * fx + invLossAddBack + concessionalWithinCap;
        if (div293Income > DIV293_THRESHOLD) {
          const div293Base = Math.min(concessionalWithinCap, div293Income - DIV293_THRESHOLD);
          div293Tax = div293Base * DIV293_EXTRA_TAX;
        }
      }

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

    // Asset growth — offset accounts don't grow (their benefit is reducing loan interest, not earning return).
    // Negative balances (overdrawn cash) don't compound either — a deficit isn't an asset earning returns.
    assets.forEach(a => {
      if (a.category === "offset") return;
      if (balances[a.id] > 0) balances[a.id] = balances[a.id] * (1 + a.growth / 100);
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

    // ===== Excess offset drain =====
    // For each loan: if offset > loan balance, route the overflow somewhere productive.
    // Route order: configured equity target → first cash asset.
    // Runs every year regardless of whether cash optimisation is enabled.
    Object.keys(offsetByLoan).forEach(key => {
      const overflow = (offsetByLoan[key] || 0) - (liabs[key] || 0);
      if (overflow > 0) {
        offsetByLoan[key] = liabs[key] || 0;
        // Try equity target first (if configured)
        const optDrain = meta.cashOptimisation || {};
        const equityTarget = optDrain.sweepTargetEquityAssetId
          ? assets.find(a => a.id === optDrain.sweepTargetEquityAssetId && a.category === "equities")
          : null;
        if (equityTarget) {
          balances[equityTarget.id] = (balances[equityTarget.id] || 0) + overflow;
        } else {
          // Fallback: first cash asset
          const firstCash = assets.find(a => a.category === "cash");
          if (firstCash) {
            balances[firstCash.id] = (balances[firstCash.id] || 0) + overflow;
          }
          // If no cash asset either, the overflow is silently lost (rare; would mean no cash at all in scenario)
        }
      }
    });
    // ===== END excess offset drain =====

    // ===== Shortfall drawdown =====
    // If the primary cash asset went negative this year (expenses exceeded income —
    // typically in retirement), cover the deficit by drawing down other assets:
    // other cash accounts first, then equities, then super once the household has
    // reached preservation age. Simplifications: sale proceeds aren't CGT-taxed and
    // super withdrawals are tax-free (both reasonable for retirement-phase drawdowns).
    const dd = meta.drawdown || {};
    let drawdownFromCash = 0, drawdownFromEquities = 0, drawdownFromSuper = 0, drawdownUnmet = 0;
    if (dd.enabled !== false && cashAssets.length > 0) {
      const primary = cashAssets[0];
      let shortfall = -(balances[primary.id] || 0);
      if (shortfall > 0) {
        const drawFrom = (asset) => {
          if (shortfall <= 0) return 0;
          const available = Math.max(0, balances[asset.id] || 0);
          const take = Math.min(shortfall, available);
          if (take > 0) {
            balances[asset.id] -= take;
            balances[primary.id] += take;
            shortfall -= take;
          }
          return take;
        };
        cashAssets.slice(1).forEach(a => { drawdownFromCash += drawFrom(a); });
        assets.filter(a => a.category === "equities").forEach(a => { drawdownFromEquities += drawFrom(a); });
        if (age >= (dd.superPreservationAge ?? 60)) {
          assets.filter(a => a.category === "super").forEach(a => { drawdownFromSuper += drawFrom(a); });
        }
        drawdownUnmet = Math.max(0, shortfall);
      }
    }
    // ===== END shortfall drawdown =====

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

    // Per-asset balances flattened (assetbal_<assetId>) so per-category chart views can stack
    // each individual asset within the category as its own band.
    const assetFlat = {};
    assets.forEach(a => {
      assetFlat[`assetbal_${a.id}`] = balances[a.id] || 0;
    });
    // Per-loan offset balances flattened (offsetbal_<loanKey>) so the Mortgage Offset view can
    // stack each loan's offset as its own band.
    const offsetFlat = {};
    Object.keys(offsetByLoan).forEach(key => {
      offsetFlat[`offsetbal_${key}`] = offsetByLoan[key] || 0;
    });

    rows.push({
      year: y, age, ...byCat, totalAssets, liabilities: totalLiab, netWealth, netCashflow,
      totalGross, totalNet, totalTax, expenses, expenseBreakdown,
      schoolFees, earnerBreakdown, feesByKid, allRetired, anyRetired, activeEvents,
      // Per-loan balance fields for stacked liability chart
      ...loanFlat,
      // Per-asset balance fields for per-category stacked chart views
      ...assetFlat,
      // Per-loan offset balance fields for Mortgage Offset view
      ...offsetFlat,
      loanBreakdown,
      // Engine internals exposed for the calculation Trace tab:
      totalLiabPayment, assetIncome, eventLump, eventExpense,
      // Shortfall drawdown (how a cash deficit was funded this year)
      drawdownFromCash, drawdownFromEquities, drawdownFromSuper, drawdownUnmet,
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

// ---------- Exports ----------
export {
  DEFAULT_STATE,
  migrateScenario,
  project,
  computeAnnualPayment,
  isPropertyCategory,
  isInvestmentProperty,
  atoIncomeTax,
  atoTotalTax,
  sgIncomeTax,
  computeEarnerTax,
  ATO_BRACKETS_2025_26,
  SG_BRACKETS,
  MEDICARE_LEVY_RATE,
  CONCESSIONAL_CAP,
  NONCONCESSIONAL_CAP,
  SUPER_CONTRIB_TAX,
  DIV293_THRESHOLD,
  DIV293_EXTRA_TAX,
};
