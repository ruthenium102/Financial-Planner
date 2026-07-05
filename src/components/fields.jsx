// Small building-block components: inputs, labels, section headers, drag list.
import React from "react";
import { Plus } from "lucide-react";
import { C, btnGhostSm } from "../theme.js";
import { useDragReorder } from "./hooks.js";

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

// ---------- Sub-components ----------
function Section({ title, subtitle, onAdd, bordered, children }) {
  return (
    <div style={{ padding: "24px", borderTop: bordered ? `1px solid ${C.line}` : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div className="serif" style={{ fontSize: 18, fontStyle: "italic", fontWeight: 500 }}>{title}</div>
          {subtitle && <div style={{ color: C.textMute, fontSize: 10, marginTop: 2, letterSpacing: "0.05em" }}>{subtitle}</div>}
        </div>
        <button onClick={onAdd} className="fp-btn" style={btnGhostSm} title={`Add ${title}`} aria-label={`Add ${title}`}><Plus size={12} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
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


export { DragList, Section, Kpi, NumberField, NumberInput, MiniField };
