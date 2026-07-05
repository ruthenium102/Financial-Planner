import { C, fmt } from "../theme.js";
import { computeAnnualPayment, CONCESSIONAL_CAP, NONCONCESSIONAL_CAP, DIV293_THRESHOLD } from "../engine.js";

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


export { LogicTab };
