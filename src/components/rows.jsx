// Editable row components for each list in the planner (events, earners,
// kids, expenses, assets, liabilities) plus the Assumptions-panel editors.
import { Fragment } from "react";
import { Plus, Trash2, DollarSign, GraduationCap, User } from "lucide-react";
import { C, CATEGORY_META, CATEGORY_ORDER, fmt, fmtCcy, btnGhostSm, btnGhostXs, miniInput } from "../theme.js";
import { useClickOutside } from "./hooks.js";
import { NumberInput, MiniField } from "./fields.jsx";
import { computeAnnualPayment, genId } from "../engine.js";

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
          <Fragment key={en.id}>
            <div style={{ fontSize: 11, color: C.text, alignSelf: "center" }}>{en.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <NumberInput step={5} value={shares?.[en.id] ?? 0} onChange={(v) => updateShare(en.id, v)} style={{ ...miniInput, width: 70, textAlign: "right" }} />
              <span style={{ fontSize: 10, color: C.textMute }}>%</span>
            </div>
          </Fragment>
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

export { EventRow, EarnerRow, KidRow, ExpenseRow, AssetRow, LiabRow, CashOptimisationEditor, OwnershipEditor };
