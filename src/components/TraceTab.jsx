import { C, fmt } from "../theme.js";
import { computeAnnualPayment } from "../engine.js";

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



export { TraceTab };
