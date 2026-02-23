import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BUCKET_MODES, BUCKET_FIELDS_META } from "../../utils/exploreConstants.js";
import { parseBucketedDim, dimDisplayLabel } from "../../utils/dimUtils.js";

// ── DimChip ────────────────────────────────────────────────────────────────────

export function DimChip({ label, index, onRemove, onChangeMode, dragHandleProps }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  const bucketed        = parseBucketedDim(label);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const displayLabel = bucketed
    ? (BUCKET_FIELDS_META[bucketed.field] ?? bucketed.field)
    : dimDisplayLabel(label);

  return (
    <div ref={ref} style={{ display:"flex", alignItems:"center", gap:0, background:"var(--blue-bg)", border:"1px solid var(--blue)", borderRadius:6, position:"relative" }}>
      <span
        {...dragHandleProps}
        style={{ color:"var(--blue)", fontSize:11, cursor:"grab", lineHeight:1, padding:"3px 3px 3px 4px", touchAction:"none" }}
        title="Drag to reorder"
      >⠿</span>

      <span style={{ background:"var(--blue)", color:"#fff", borderRadius:"50%", width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, flexShrink:0, margin:"0 4px" }}>{index+1}</span>

      <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text)", padding:"3px 0" }}>{displayLabel}</span>

      {bucketed && (
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background:"var(--bg2)", border:"none",
            borderLeft:"1px solid var(--blue)", borderRight:"1px solid var(--blue)",
            padding:"3px 6px", fontSize:11, color:"var(--blue)", cursor:"pointer",
            fontFamily:"monospace", margin:"0 0 0 4px",
          }}
        >{bucketed.mode} ▾</button>
      )}

      {open && bucketed && (
        <div style={{
          position:"absolute", top:"calc(100% + 3px)", left:0, zIndex:70,
          background:"var(--bg2)", border:"1px solid var(--border2)",
          borderRadius:6, boxShadow:"0 4px 12px #0008", minWidth:90,
        }}>
          {BUCKET_MODES.map(mode => (
            <div
              key={mode}
              onClick={() => { onChangeMode?.(`${bucketed.field}:${mode}`); setOpen(false); }}
              style={{
                padding:"5px 12px", fontSize:12, cursor:"pointer",
                fontFamily:"monospace",
                color:      mode === bucketed.mode ? "var(--blue)" : "var(--text)",
                fontWeight: mode === bucketed.mode ? 700 : 400,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >{mode}</div>
          ))}
        </div>
      )}

      <button onClick={onRemove} style={{ background:"none", border:"none", color:"var(--text3)", cursor:"pointer", padding:"3px 6px", fontSize:13, lineHeight:1 }}>×</button>
    </div>
  );
}

// ── SortableDimChip ────────────────────────────────────────────────────────────

export function SortableDimChip({ id, label, index, onRemove, onChangeMode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity:   isDragging ? 0.45 : 1,
        zIndex:    isDragging ? 50 : "auto",
        display:   "inline-flex",
      }}
    >
      <DimChip
        label={label}
        index={index}
        onRemove={onRemove}
        onChangeMode={onChangeMode}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// ── AddDimMenu ─────────────────────────────────────────────────────────────────

export function AddDimMenu({ available, currentDims = [], onAdd }) {
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
  function Item({ label, onClick }) {
    return (
      <div onClick={onClick}
        style={{ padding:"5px 14px", fontSize:12, cursor:"pointer", fontFamily:"monospace", color:"var(--text)" }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >{label}</div>
    );
  }

  // Bucketed fields whose field is not already in the active dims list
  const availableBucketed = Object.entries(BUCKET_FIELDS_META).filter(
    ([field]) => !currentDims.some(d => d === field || d.startsWith(`${field}:`))
  );

  const hasDims = available.length > 0;
  const hasBucketed = availableBucketed.length > 0;
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button className="btn btn-sm btn-ghost" style={{ fontSize:12 }} onClick={() => setOpen(v => !v)}>+ Add dimension ▾</button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:50, background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:6, boxShadow:"0 4px 16px #0006", minWidth:180 }}>
          {hasDims && <SectionHeader>Structural</SectionHeader>}
          {available.map(d => (
            <Item key={d} label={dimDisplayLabel(d)} onClick={() => { onAdd(d); setOpen(false); }} />
          ))}
          {hasBucketed && (
            <div style={{ borderTop: hasDims ? "1px solid var(--border)" : undefined, marginTop: hasDims ? 4 : 0 }}>
              <SectionHeader>Bucketed measures</SectionHeader>
            </div>
          )}
          {availableBucketed.map(([field, label]) => (
            <Item
              key={field}
              label={label}
              onClick={() => { onAdd(`${field}:quartile`); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
