import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AGGS, SPECIAL_LABELS, FIELD_META } from "../../utils/exploreConstants.js";
import { measureKey, measureLabel } from "../../utils/measureUtils.js";

// ── RatioCell ──────────────────────────────────────────────────────────────────

export function RatioCell({ value }) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  const pct   = Math.round((value || 0) * 100);
  const color = pct > 50 ? "var(--red)" : pct > 25 ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div className="bar-bg" style={{ width:44 }}>
        <div className="bar-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
      <span style={{ color, fontWeight:600, fontSize:12, minWidth:32 }}>{pct}%</span>
    </div>
  );
}

// ── MeasureChip ────────────────────────────────────────────────────────────────

export function MeasureChip({ m, onRemove, onChangeAgg, dragHandleProps }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <span ref={ref} style={{
      display:"inline-flex", alignItems:"center", gap:0,
      background:"var(--bg3)", border:"1px solid var(--border2)",
      borderRadius:6, fontSize:12, userSelect:"none", position:"relative",
    }}>
      <span
        {...dragHandleProps}
        style={{ padding:"3px 4px 3px 6px", color:"var(--text3)", fontSize:11, cursor:"grab", touchAction:"none" }}
        title="Drag to reorder"
      >⠿</span>
      <span style={{ padding:"3px 8px 3px 2px", color:"var(--text)" }}>{measureLabel(m)}</span>

      {!m.special && (
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background:"var(--bg2)", border:"none", borderLeft:"1px solid var(--border2)",
            borderRight:"1px solid var(--border2)", padding:"3px 6px", fontSize:11,
            color:"var(--blue)", cursor:"pointer", fontFamily:"monospace",
          }}
        >{m.agg} ▾</button>
      )}

      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 3px)", left:0, zIndex:70,
          background:"var(--bg2)", border:"1px solid var(--border2)",
          borderRadius:6, boxShadow:"0 4px 12px #0008", minWidth:80,
        }}>
          {AGGS.map(agg => (
            <div
              key={agg}
              onClick={() => { onChangeAgg(agg); setOpen(false); }}
              style={{
                padding:"5px 12px", fontSize:12, cursor:"pointer",
                fontFamily:"monospace", color: agg === m.agg ? "var(--blue)" : "var(--text)",
                fontWeight: agg === m.agg ? 700 : 400,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >{agg}</div>
          ))}
        </div>
      )}

      <button
        onClick={onRemove}
        style={{ background:"none", border:"none", color:"var(--text3)", cursor:"pointer", padding:"3px 6px", fontSize:13, lineHeight:1 }}
      >×</button>
    </span>
  );
}

// ── SortableMeasureChip ────────────────────────────────────────────────────────

export function SortableMeasureChip({ id, m, onRemove, onChangeAgg }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <span
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity:   isDragging ? 0.45 : 1,
        zIndex:    isDragging ? 50 : "auto",
        display:   "inline-flex",
      }}
    >
      <MeasureChip
        m={m}
        onRemove={onRemove}
        onChangeAgg={onChangeAgg}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </span>
  );
}

// ── AddMeasureMenu ─────────────────────────────────────────────────────────────

export function AddMeasureMenu({ onAdd, hasEnriched }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function SectionHeader({ children }) {
    return <div style={{ padding:"5px 12px 2px", fontSize:10, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{children}</div>;
  }

  function Item({ onClick, children, disabled }) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        style={{ padding:"5px 14px", fontSize:12, cursor: disabled ? "not-allowed" : "pointer", color: disabled ? "var(--text3)" : "var(--text)", opacity: disabled ? 0.5 : 1 }}
        onMouseEnter={e => !disabled && (e.currentTarget.style.background = "var(--bg3)")}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >{children}</div>
    );
  }

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button className="btn btn-sm btn-ghost" style={{ fontSize:12 }} onClick={() => setOpen(v => !v)}>
        + Add measure ▾
      </button>
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:60,
          background:"var(--bg2)", border:"1px solid var(--border2)",
          borderRadius:6, boxShadow:"0 4px 16px #0008", minWidth:160,
        }}>
          <SectionHeader>Specials</SectionHeader>
          {Object.entries(SPECIAL_LABELS).map(([key, label]) => (
            <Item key={key} onClick={() => { onAdd({ special: key }); setOpen(false); }}>{label}</Item>
          ))}
          <div style={{ borderTop:"1px solid var(--border)", marginTop:4 }}>
            <SectionHeader>Fields → avg by default</SectionHeader>
            {Object.entries(FIELD_META).map(([key, { label, enriched }]) => {
              const unavail = enriched && !hasEnriched;
              return (
                <Item
                  key={key}
                  disabled={unavail}
                  onClick={() => { onAdd({ field: key, agg: "avg" }); setOpen(false); }}
                >
                  {label}{enriched ? <span style={{ color:"var(--text3)", marginLeft:4 }}>✦</span> : ""}
                </Item>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
