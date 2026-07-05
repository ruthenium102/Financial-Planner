// Regression tests for the projection engine.
// The tax tests encode published ATO / IRAS figures (2025-26 / YA2026) — if a test
// fails after an engine change, check the maths against the source, not the test.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATE,
  migrateScenario,
  project,
  computeAnnualPayment,
  atoIncomeTax,
  atoTotalTax,
  sgIncomeTax,
  mlsRate,
  genId,
  CONCESSIONAL_CAP,
} from "./engine.js";

// ---------- ATO income tax (2025-26 brackets) ----------
describe("atoIncomeTax", () => {
  it("is nil up to the tax-free threshold", () => {
    expect(atoIncomeTax(0)).toBe(0);
    expect(atoIncomeTax(18200)).toBe(0);
  });
  it("matches the bracket bases at each boundary", () => {
    expect(atoIncomeTax(45000)).toBeCloseTo(4288, 0);
    expect(atoIncomeTax(135000)).toBeCloseTo(31288, 0);
    expect(atoIncomeTax(190000)).toBeCloseTo(51638, 0);
  });
  it("applies 45% above $190k", () => {
    expect(atoIncomeTax(200000)).toBeCloseTo(51638 + 10000 * 0.45, 0);
  });
});

// ---------- Medicare levy (with low-income phase-in) ----------
describe("Medicare levy", () => {
  it("is nil at or below the lower threshold", () => {
    // $27,000 taxable → income tax only, no levy
    expect(atoTotalTax(27000)).toBeCloseTo(atoIncomeTax(27000), 2);
  });
  it("phases in at 10c per dollar of the excess (no cliff)", () => {
    // $30,000: levy = min(2% × 30,000, 10% × (30,000 − 27,222)) = $277.80
    expect(atoTotalTax(30000) - atoIncomeTax(30000)).toBeCloseTo(277.8, 1);
  });
  it("reaches the flat 2% at higher incomes", () => {
    expect(atoTotalTax(50000) - atoIncomeTax(50000)).toBeCloseTo(1000, 1);
  });
});

// ---------- Medicare Levy Surcharge (2025-26 single thresholds) ----------
describe("mlsRate", () => {
  it("is nil at or below $101,000", () => {
    expect(mlsRate(95000)).toBe(0);
    expect(mlsRate(101000)).toBe(0);
  });
  it("is 1% in tier 1 ($101,001–$118,000)", () => {
    expect(mlsRate(101001)).toBe(0.010);
    expect(mlsRate(110000)).toBe(0.010);
    expect(mlsRate(118000)).toBe(0.010);
  });
  it("is 1.25% in tier 2 ($118,001–$158,000)", () => {
    expect(mlsRate(118001)).toBe(0.0125);
    expect(mlsRate(130000)).toBe(0.0125);
  });
  it("is 1.5% in tier 3 (above $158,000)", () => {
    expect(mlsRate(158001)).toBe(0.015);
    expect(mlsRate(500000)).toBe(0.015);
  });
  it("uplifts family thresholds by $1,500 per kid after the first", () => {
    expect(mlsRate(203000, true, 1)).toBe(0.010);  // above 202,000 family floor
    expect(mlsRate(203000, true, 3)).toBe(0);       // floor lifted to 205,000
  });
  it("feeds through atoTotalTax when there's no private cover", () => {
    const withCover = atoTotalTax(110000, true);
    const withoutCover = atoTotalTax(110000, false);
    expect(withoutCover - withCover).toBeCloseTo(110000 * 0.01, 0);
  });
});

// ---------- Singapore income tax (YA2026) ----------
describe("sgIncomeTax", () => {
  it("matches IRAS bracket bases", () => {
    expect(sgIncomeTax(20000)).toBe(0);
    expect(sgIncomeTax(80000)).toBeCloseTo(3350, 0);
    expect(sgIncomeTax(320000)).toBeCloseTo(44550, 0);
  });
});

// ---------- Loan payments ----------
describe("computeAnnualPayment", () => {
  it("computes standard P&I amortisation", () => {
    // $500k @ 6% over 30 years → $36,324.6/yr
    const pmt = computeAnnualPayment({ balance: 500000, originalBalance: 500000, rate: 6, type: "pi", termYears: 30 });
    expect(pmt).toBeCloseTo(500000 * 0.06 / (1 - Math.pow(1.06, -30)), 0);
  });
  it("IO payment is balance × rate", () => {
    expect(computeAnnualPayment({ balance: 400000, rate: 5, type: "io", termYears: 30, ioPeriod: 5 })).toBeCloseTo(20000, 2);
  });
  it("handles zero-rate loans", () => {
    expect(computeAnnualPayment({ balance: 100000, originalBalance: 100000, rate: 0, type: "pi", termYears: 10 })).toBeCloseTo(10000, 2);
  });
});

// ---------- Scenario builders ----------
function baseScenario(overrides = {}) {
  return migrateScenario({
    meta: { currentAge: 45, horizonYears: 20, inflation: 2.5, currency: "AUD", ...(overrides.meta || {}) },
    assets: overrides.assets ?? [{ id: "cash1", name: "Cash", category: "cash", value: 50000, growth: 0, income: 0 }],
    liabilities: overrides.liabilities ?? [],
    earners: overrides.earners ?? [{
      id: "e1", name: "E1", currency: "AUD", salary: 100000, bonusRateCash: 0, bonusRateShares: 0,
      salaryGrowth: 0, taxMode: "ato", taxRate: 32, hasPrivateHealth: true,
      superSgRate: 12, superSgIncludesBonus: false,
      superExtraConcessionalRate: 0, superExtraNonConcessionalRate: 0,
      superMatchConcessionalRate: 0, superMatchNonConcessionalRate: 0,
    }],
    expenses: overrides.expenses ?? [],
    kids: overrides.kids ?? [],
    events: overrides.events ?? [],
  });
}

// ---------- Projection: loans amortise to zero ----------
describe("project — loan amortisation", () => {
  it("pays a P&I loan off by the end of its term", () => {
    const s = baseScenario({
      liabilities: [{ id: "l1", name: "Loan", balance: 300000, originalBalance: 300000, rate: 5, type: "pi", termYears: 10 }],
    });
    const rows = project(s);
    expect(rows[0]["loan_liab:l1"]).toBeGreaterThan(0);
    expect(rows[12]["loan_liab:l1"] ?? 0).toBe(0);
  });
});

// ---------- Div 293 ----------
describe("project — Div 293", () => {
  it("charges 15% on within-cap concessional above the $250k threshold", () => {
    // Salary $260k, SG 12% → $31,200 concessional, capped at $30k.
    // Div-293 income = 260,000 + 30,000 = 290,000 → base = min(30k, 40k) → tax $4,500
    const s = baseScenario({ earners: [{
      id: "e1", name: "E1", currency: "AUD", salary: 260000, bonusRateCash: 0, bonusRateShares: 0,
      salaryGrowth: 0, taxMode: "ato", hasPrivateHealth: true, superSgRate: 12,
    }] });
    const row = project(s)[0];
    expect(row.earnerBreakdown.e1.concessionalWithinCap).toBeCloseTo(CONCESSIONAL_CAP, 2);
    expect(row.earnerBreakdown.e1.div293Tax).toBeCloseTo(4500, 0);
  });
  it("does not double-count salary sacrifice in Div-293 income", () => {
    // Salary $240k + 5% sacrifice ($12k). SG = $28.8k fills most of the cap;
    // deductible sacrifice = $1.2k → taxable $238.8k.
    // Div-293 income = 238,800 + 30,000 = 268,800 → base = min(30k, 18.8k) → tax $2,820.
    // (The old buggy formula gave 240,000 + 30,000 = 270,000 → $3,000.)
    const s = baseScenario({ earners: [{
      id: "e1", name: "E1", currency: "AUD", salary: 240000, salaryGrowth: 0,
      taxMode: "ato", hasPrivateHealth: true, superSgRate: 12, superExtraConcessionalRate: 5,
    }] });
    const row = project(s)[0];
    expect(row.earnerBreakdown.e1.div293Tax).toBeCloseTo(2820, 0);
  });
  it("charges nothing below the threshold", () => {
    const s = baseScenario({ earners: [{
      id: "e1", name: "E1", currency: "AUD", salary: 180000, salaryGrowth: 0,
      taxMode: "ato", hasPrivateHealth: true, superSgRate: 12,
    }] });
    expect(project(s)[0].earnerBreakdown.e1.div293Tax).toBe(0);
  });
});

// ---------- Migration ----------
describe("migrateScenario", () => {
  it("upgrades legacy shapes: cashflow, single loan, sharePlan, superContribRate", () => {
    const m = migrateScenario({
      meta: { currentAge: 50, horizonYears: 10 },
      assets: [
        { id: "p1", name: "House", category: "property", value: 800000, growth: 3, income: 0, loan: { balance: 400000, rate: 5, isInvestment: false } },
        { id: "s1", name: "Plan", category: "sharePlan", value: 50000, growth: 6, income: 2000 },
      ],
      earners: [{ id: "e1", name: "E1", salary: 90000, salaryGrowth: 3, superContribRate: 10.5 }],
      cashflow: { livingExpenses: 40000, expenseGrowth: 2.5 },
    });
    expect(m.assets[0].category).toBe("primaryResidence");
    expect(m.assets[0].loans).toHaveLength(1);
    expect(m.assets[0].loans[0].type).toBeDefined();
    expect(m.assets[1].category).toBe("equities");
    expect(m.assets[1].dividendYield).toBeCloseTo(4, 5); // 2000/50000
    expect(m.earners[0].superSgRate).toBe(10.5);
    expect(m.expenses).toHaveLength(1);
    expect(m.expenses[0].amount).toBe(40000);
  });
  it("adds drawdown defaults", () => {
    const m = migrateScenario({ meta: {}, assets: [], earners: [] });
    expect(m.meta.drawdown).toEqual({ enabled: true, superPreservationAge: 60 });
  });
  it("returns null for garbage input", () => {
    expect(migrateScenario(null)).toBeNull();
    expect(migrateScenario("nope")).toBeNull();
  });
  it("keeps the default state stable through migration", () => {
    const m = migrateScenario(DEFAULT_STATE);
    expect(m.meta.currentAge).toBe(DEFAULT_STATE.meta.currentAge);
    expect(m.assets).toHaveLength(DEFAULT_STATE.assets.length);
  });
});

// ---------- Shortfall drawdown ----------
describe("project — shortfall drawdown", () => {
  const retiredHousehold = (age, extraAssets = [], horizon = 10) => baseScenario({
    meta: { currentAge: age, horizonYears: horizon, retirementSpendingMultiplier: 1.0 },
    assets: [
      { id: "cash1", name: "Cash", category: "cash", value: 10000, growth: 0, income: 0 },
      ...extraAssets,
    ],
    expenses: [{ id: "x1", name: "Living", amount: 60000, growth: 0, startYear: 0, endYear: null }],
    events: [{ id: "r1", name: "Retire", type: "retirement", yearOffset: 0, earnerId: "e1" }],
  });

  it("funds deficits from equities before super", () => {
    const s = retiredHousehold(65, [
      { id: "eq1", name: "Shares", category: "equities", value: 500000, growth: 0, dividendYield: 0 },
      { id: "su1", name: "Super", category: "super", value: 500000, growth: 0, earnerId: "e1" },
    ]);
    const row = project(s)[0];
    expect(row.drawdownFromEquities).toBeGreaterThan(0);
    expect(row.drawdownFromSuper).toBe(0);
    expect(row.cash).toBeGreaterThanOrEqual(0);
  });

  it("does not touch super before preservation age", () => {
    const s = retiredHousehold(50, [
      { id: "su1", name: "Super", category: "super", value: 500000, growth: 0, earnerId: "e1" },
    ]);
    const rows = project(s);
    expect(rows[0].drawdownFromSuper).toBe(0);
    expect(rows[0].drawdownUnmet).toBeGreaterThan(0); // nothing else to sell
    // At 60 the household can access super
    const at60 = rows.find(r => r.age === 60);
    expect(at60.drawdownFromSuper).toBeGreaterThan(0);
  });

  it("leaves cash negative when drawdown is disabled", () => {
    const s = retiredHousehold(65, [
      { id: "eq1", name: "Shares", category: "equities", value: 500000, growth: 0, dividendYield: 0 },
    ]);
    s.meta.drawdown = { enabled: false, superPreservationAge: 60 };
    const row = project(s)[0];
    expect(row.cash).toBeLessThan(0);
    expect(row.equities).toBeCloseTo(500000, 0);
  });

  it("does not compound negative cash balances", () => {
    const s = retiredHousehold(65, []);
    s.meta.drawdown = { enabled: false, superPreservationAge: 60 };
    const rows = project(s);
    // Deficit grows linearly (same 60k/yr), not exponentially
    const d1 = rows[1].cash - rows[0].cash;
    const d5 = rows[5].cash - rows[4].cash;
    expect(Math.abs(d5)).toBeLessThanOrEqual(Math.abs(d1) + 1);
  });
});

// ---------- Franking credits ----------
describe("project — franking credits", () => {
  it("reduces tax for fully franked dividends", () => {
    const franked = baseScenario({ assets: [
      { id: "cash1", name: "Cash", category: "cash", value: 0, growth: 0, income: 0 },
      { id: "eq1", name: "Shares", category: "equities", value: 500000, growth: 0, dividendYield: 4, frankedRate: 100, ownershipShares: { e1: 100 } },
    ] });
    const unfranked = baseScenario({ assets: [
      { id: "cash1", name: "Cash", category: "cash", value: 0, growth: 0, income: 0 },
      { id: "eq1", name: "Shares", category: "equities", value: 500000, growth: 0, dividendYield: 4, frankedRate: 0, ownershipShares: { e1: 100 } },
    ] });
    expect(project(franked)[0].totalTax).toBeLessThan(project(unfranked)[0].totalTax);
  });
});

// ---------- genId ----------
describe("genId", () => {
  it("produces unique prefixed ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => genId("a")));
    expect(ids.size).toBe(200);
    ids.forEach(id => expect(id.startsWith("a")).toBe(true));
  });
});
