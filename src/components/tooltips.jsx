// Chart tooltips for the wealth and cashflow views.
import { C, CATEGORY_META, CATEGORY_ORDER, CASHFLOW_INCOME, CASHFLOW_EXPENSE, fmt, fmtFull } from "../theme.js";

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

export { CashflowTooltip, CustomTooltip };
