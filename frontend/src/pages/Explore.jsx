import { useContext, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";
import { RepoContext } from "../App";
import { api } from "../api";
import { applyFilters, filterEdgesToNodes } from "../utils/filterUtils.js";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Metadata ───────────────────────────────────────────────────────────────────

const SPECIAL_LABELS = {
  symbol_count:    "symbol count",
  dead_ratio:      "dead ratio",
  high_risk_ratio: "high-risk %",
  in_cycle_ratio:  "in-cycle %",
};

const FIELD_META = {
  caller_count: { label: "callers",     enriched: false },
  callee_count: { label: "callees",     enriched: false },
  complexity:   { label: "complexity",  enriched: false },
  utility:      { label: "utility",     enriched: true  },
  pagerank:     { label: "pagerank",    enriched: true  },
  xmod_fan_in:  { label: "xmod_fan_in", enriched: true  },
  topo_depth:   { label: "topo_depth",  enriched: true  },
  betweenness:  { label: "betweenness", enriched: true  },
};

const AGGS = ["avg", "min", "max", "sum", "stddev", "count"];

const RISK_COLOR = { critical:"var(--red)", high:"var(--yellow)", medium:"var(--blue)", low:"var(--green)" };
const RISK_BG    = { critical:"var(--red-bg)", high:"var(--yellow-bg)", medium:"var(--blue-bg)", low:"var(--green-bg)" };
const KIND_PALETTE = ["#58a6ff","#3fb950","#e3b341","#f85149","#a371f7","#39c5cf","#ff9966","#56d364"];

const DEFAULT_DIMS     = ["module"];
const DEFAULT_MEASURES = [
  { special: "symbol_count" },
  { special: "dead_ratio"   },
  { field: "caller_count", agg: "avg" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function measureKey(m)   { return m.special ?? `${m.field}_${m.agg}`; }
function measureStr(m)   { return m.special ?? `${m.field}:${m.agg}`; }
function measureLabel(m) {
  if (m.special) return SPECIAL_LABELS[m.special] ?? m.special;
  return FIELD_META[m.field]?.label ?? m.field;
}

function fmt(value, type) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  if (type === "ratio") return `${((value || 0) * 100).toFixed(1)}%`;
  if (type === "float") { const v = value || 0; return v < 0.01 ? v.toExponential(2) : v.toFixed(3); }
  return Math.round(value);
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

function newId() { return Math.random().toString(36).slice(2, 9); }
// matchExpr and applyFilters are imported from ../utils/filterUtils.js

// ── Filter components ──────────────────────────────────────────────────────────

function DimFilterEditor({ filter, availableValues, onUpdate }) {
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:10 }}>
        {["exclude","include","regex"].map(mode => (
          <button key={mode}
            className={`btn btn-sm ${filter.mode === mode ? "" : "btn-ghost"}`}
            style={{ fontSize:11 }}
            onClick={() => onUpdate({ ...filter, mode })}
          >{mode}</button>
        ))}
      </div>
      {filter.mode === "regex" ? (
        <input
          autoFocus
          placeholder="e.g. ^core|utils$  ·  !test (exclude matching)"
          value={filter.pattern}
          onChange={e => onUpdate({ ...filter, pattern: e.target.value })}
          style={{ width:"100%", padding:"5px 8px", fontSize:12, fontFamily:"monospace",
            background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:4, color:"var(--text)" }}
        />
      ) : (
        <>
          <div style={{ fontSize:11, color:"var(--text3)", marginBottom:6 }}>
            {filter.mode === "exclude" ? "Exclude:" : "Only include:"}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {availableValues.map(v => {
              const active = filter.values.includes(v);
              return (
                <button key={v}
                  onClick={() => {
                    const next = active
                      ? filter.values.filter(x => x !== v)
                      : [...filter.values, v];
                    onUpdate({ ...filter, values: next });
                  }}
                  style={{
                    padding:"2px 8px", fontSize:11, borderRadius:4, cursor:"pointer",
                    background: active ? "var(--blue)"    : "var(--bg3)",
                    color:      active ? "#fff"           : "var(--text2)",
                    border:     active ? "1px solid var(--blue)" : "1px solid var(--border2)",
                    fontFamily: "monospace",
                  }}
                >{v}</button>
              );
            })}
            {!availableValues.length && (
              <span style={{ fontSize:11, color:"var(--text3)" }}>Run a query first to see values.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MeasureFilterEditor({ filter, onUpdate }) {
  return (
    <div>
      <div style={{ fontSize:11, color:"var(--text3)", marginBottom:6 }}>
        Filter <span style={{ color:"var(--blue)", fontFamily:"monospace" }}>{filter.label}</span> where:
      </div>
      <input
        autoFocus
        placeholder="> 0.5  |  < 100  |  10..50  |  !10..50  |  != 0"
        value={filter.expr}
        onChange={e => onUpdate({ ...filter, expr: e.target.value })}
        style={{ width:"100%", padding:"5px 8px", fontSize:12, fontFamily:"monospace",
          background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:4, color:"var(--text)" }}
      />
      <div style={{ fontSize:10, color:"var(--text3)", marginTop:6, lineHeight:1.6 }}>
        Ops: <code style={{ color:"var(--text2)" }}>&gt; &gt;= &lt; &lt;= = !=</code>
        &nbsp;·&nbsp; Range: <code style={{ color:"var(--text2)" }}>10..50</code>
        &nbsp;·&nbsp; Outside: <code style={{ color:"var(--text2)" }}>!10..50</code>
      </div>
    </div>
  );
}

function FilterChip({ filter, availableValues, onUpdate, onRemove }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const isSet = filter.kind === "dim"
    ? (filter.mode === "regex" ? !!filter.pattern : filter.values.length > 0)
    : !!filter.expr?.trim();

  function summary() {
    if (filter.kind === "dim") {
      const prefix = filter.mode === "exclude" ? "≠" : filter.mode === "include" ? "=" : "~";
      const body = filter.mode === "regex"
        ? (filter.pattern || "…")
        : filter.values.length
          ? filter.values.slice(0, 2).join(", ") + (filter.values.length > 2 ? ` +${filter.values.length - 2}` : "")
          : "…";
      return `${filter.field} ${prefix} ${body}`;
    }
    return `${filter.label} ${filter.expr || "…"}`;
  }

  const borderColor = isSet ? "var(--blue)" : "var(--border2)";
  const bg          = isSet ? "var(--blue-bg)" : "var(--bg3)";
  const textColor   = isSet ? "var(--blue)"    : "var(--text2)";

  return (
    <span ref={ref} style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
      <span
        onClick={() => setOpen(v => !v)}
        style={{
          display:"inline-flex", alignItems:"center",
          background:bg, border:`1px solid ${borderColor}`, borderRight:"none",
          borderRadius:"6px 0 0 6px", padding:"3px 10px",
          fontSize:12, cursor:"pointer", fontFamily:"monospace", color:textColor,
        }}
      >{summary()}</span>
      <button onClick={onRemove} style={{
        background:bg, border:`1px solid ${borderColor}`, borderLeft:"none",
        borderRadius:"0 6px 6px 0", color:"var(--text3)", cursor:"pointer",
        padding:"3px 6px", fontSize:13, lineHeight:1,
      }}>×</button>

      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:80,
          background:"var(--bg2)", border:"1px solid var(--border2)",
          borderRadius:8, boxShadow:"0 4px 16px #0009", padding:"12px 14px", minWidth:280,
        }}>
          {filter.kind === "dim"
            ? <DimFilterEditor filter={filter} availableValues={availableValues} onUpdate={onUpdate} />
            : <MeasureFilterEditor filter={filter} onUpdate={onUpdate} />
          }
        </div>
      )}
    </span>
  );
}

function AddFilterMenu({ dims, measures, onAdd }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function SectionHeader({ children }) {
    return <div style={{ padding:"5px 12px 2px", fontSize:10, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{children}</div>;
  }
  function Item({ onClick, children }) {
    return (
      <div onClick={onClick}
        style={{ padding:"5px 14px", fontSize:12, cursor:"pointer", fontFamily:"monospace", color:"var(--text)" }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >{children}</div>
    );
  }

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button className="btn btn-sm btn-ghost" style={{ fontSize:12 }} onClick={() => setOpen(v => !v)}>
        + Add filter ▾
      </button>
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:70,
          background:"var(--bg2)", border:"1px solid var(--border2)",
          borderRadius:6, boxShadow:"0 4px 16px #0008", minWidth:170,
        }}>
          <SectionHeader>Dimensions</SectionHeader>
          {dims.map(d => (
            <Item key={d} onClick={() => {
              onAdd({ id:newId(), kind:"dim", field:d, mode:"exclude", values:[], pattern:"" });
              setOpen(false);
            }}>{d}</Item>
          ))}
          {measures.length > 0 && (
            <>
              <div style={{ borderTop:"1px solid var(--border)", marginTop:4 }}>
                <SectionHeader>Measures</SectionHeader>
              </div>
              {measures.map(m => (
                <Item key={measureKey(m)} onClick={() => {
                  onAdd({ id:newId(), kind:"measure", mkey:measureKey(m), label:measureLabel(m) + (m.agg ? ` (${m.agg})` : ""), expr:"" });
                  setOpen(false);
                }}>
                  {measureLabel(m)}{!m.special && <span style={{ color:"var(--text3)", fontSize:10, marginLeft:4 }}>{m.agg}</span>}
                </Item>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── RatioCell ──────────────────────────────────────────────────────────────────

function RatioCell({ value }) {
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

// ── MeasureChip — with inline agg dropdown ─────────────────────────────────────

function MeasureChip({ m, onRemove, onChangeAgg, dragHandleProps }) {
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
      {/* Drag handle */}
      <span
        {...dragHandleProps}
        style={{ padding:"3px 4px 3px 6px", color:"var(--text3)", fontSize:11, cursor:"grab", touchAction:"none" }}
        title="Drag to reorder"
      >⠿</span>
      <span style={{ padding:"3px 8px 3px 2px", color:"var(--text)" }}>{measureLabel(m)}</span>

      {/* Agg selector — only for dynamic (field) measures */}
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

      {/* Agg dropdown */}
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

// ── AddMeasureMenu — flat one-step picker ─────────────────────────────────────

function AddMeasureMenu({ onAdd, hasEnriched }) {
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

// ── DimChip + AddDimMenu ───────────────────────────────────────────────────────

const BUCKET_MODES = ["median", "quartile", "decile"];

// Parse a dim string into {field, mode} if it's bucketed, else null
function parseBucketedDim(d) {
  if (!d.includes(":")) return null;
  const colon = d.indexOf(":");
  const field  = d.slice(0, colon);
  const mode   = d.slice(colon + 1);
  return BUCKET_MODES.includes(mode) ? { field, mode } : null;
}

const DIM_LABELS = {
  module:                  "module",
  risk:                    "risk",
  kind:                    "kind",
  symbol:                  "symbol",
  dead:                    "dead/alive",
  high_risk:               "high-risk",
  in_cycle:                "in-cycle ✦",
  community: "community ✦",
};

function dimDisplayLabel(d) {
  if (DIM_LABELS[d]) return DIM_LABELS[d];
  if (d.includes(":")) {
    const colon = d.indexOf(":");
    const field = d.slice(0, colon), mode = d.slice(colon + 1);
    const base = BUCKET_FIELDS_META[field] ?? field;
    return `${base} (${mode})`;
  }
  return d;
}

function DimChip({ label, index, onRemove, onChangeMode, dragHandleProps }) {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  const bucketed        = parseBucketedDim(label);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Display label: for bucketed dims show just the field name (mode goes in the dropdown button)
  const displayLabel = bucketed
    ? (BUCKET_FIELDS_META[bucketed.field] ?? bucketed.field)
    : dimDisplayLabel(label);

  return (
    <div ref={ref} style={{ display:"flex", alignItems:"center", gap:0, background:"var(--blue-bg)", border:"1px solid var(--blue)", borderRadius:6, position:"relative" }}>
      {/* Drag handle */}
      <span
        {...dragHandleProps}
        style={{ color:"var(--blue)", fontSize:11, cursor:"grab", lineHeight:1, padding:"3px 3px 3px 4px", touchAction:"none" }}
        title="Drag to reorder"
      >⠿</span>

      {/* Index badge */}
      <span style={{ background:"var(--blue)", color:"#fff", borderRadius:"50%", width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, flexShrink:0, margin:"0 4px" }}>{index+1}</span>

      {/* Label */}
      <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text)", padding:"3px 0" }}>{displayLabel}</span>

      {/* Mode dropdown — only for bucketed dims */}
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

      {/* Mode dropdown list */}
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

      {/* Remove button */}
      <button onClick={onRemove} style={{ background:"none", border:"none", color:"var(--text3)", cursor:"pointer", padding:"3px 6px", fontSize:13, lineHeight:1 }}>×</button>
    </div>
  );
}

// ── Sortable wrappers (DnD) ────────────────────────────────────────────────────

function SortableDimChip({ id, label, index, onRemove, onChangeMode }) {
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

function SortableMeasureChip({ id, m, onRemove, onChangeAgg }) {
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

const BUCKET_FIELDS_META = {
  caller_count:    "callers",
  callee_count:    "callees",
  complexity:      "complexity",
  dead_ratio:      "dead ratio",
  high_risk_ratio: "high-risk ratio",
  in_cycle_ratio:  "in-cycle ratio ✦",
  pagerank:        "pagerank ✦",
  utility:         "utility ✦",
  xmod_fan_in:     "xmod_fan_in ✦",
  betweenness:     "betweenness ✦",
};

function AddDimMenu({ available, onAdd }) {
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

  const hasDims = available.length > 0;
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button className="btn btn-sm btn-ghost" style={{ fontSize:12 }} onClick={() => setOpen(v => !v)}>+ Add dimension ▾</button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:50, background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:6, boxShadow:"0 4px 16px #0006", minWidth:180 }}>
          {hasDims && <SectionHeader>Structural</SectionHeader>}
          {available.map(d => (
            <Item key={d} label={dimDisplayLabel(d)} onClick={() => { onAdd(d); setOpen(false); }} />
          ))}
          <div style={{ borderTop:"1px solid var(--border)", marginTop:4 }}>
            <SectionHeader>Bucketed measures</SectionHeader>
          </div>
          {Object.entries(BUCKET_FIELDS_META).map(([field, label]) =>
            ["median","quartile","decile"].map(mode => (
              <Item
                key={`${field}:${mode}`}
                label={`${label} (${mode})`}
                onClick={() => { onAdd(`${field}:${mode}`); setOpen(false); }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── KindFilter ─────────────────────────────────────────────────────────────────
// kinds=[] means ALL selected (no filter). Active = included.

function KindFilter({ availableKinds, kinds, onChange }) {
  const allActive = kinds.length === 0;
  const colorMap  = useRef(new Map());

  function kindColor(k) {
    if (!colorMap.current.has(k))
      colorMap.current.set(k, KIND_PALETTE[colorMap.current.size % KIND_PALETTE.length]);
    return colorMap.current.get(k);
  }

  function toggle(k) {
    if (allActive) {
      // Deselect this one kind
      onChange(availableKinds.filter(x => x !== k));
    } else if (kinds.includes(k)) {
      // Remove: if that empties the selection, treat as "all"
      const next = kinds.filter(x => x !== k);
      onChange(next.length === 0 ? [] : next);
    } else {
      // Add: if now all are selected, treat as "all"
      const next = [...kinds, k];
      onChange(next.length >= availableKinds.length ? [] : next);
    }
  }

  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Kind filter</span>
      <button
        className={`btn btn-sm ${allActive ? "" : "btn-ghost"}`}
        style={{ fontSize:11 }}
        onClick={() => onChange([])}
      >all</button>
      {availableKinds.map(k => {
        const active = allActive || kinds.includes(k);
        const color  = kindColor(k);
        return (
          <button key={k} onClick={() => toggle(k)} style={{
            padding:"3px 10px", fontSize:11, borderRadius:6, cursor:"pointer", border:"none",
            background: active ? color + "22" : "var(--bg3)",
            color:      active ? color : "var(--text3)",
            outline:    active ? `1px solid ${color}` : "1px solid var(--border)",
            transition: "all 0.1s",
          }}>{k}</button>
        );
      })}
    </div>
  );
}

// ── EdgePillbox ────────────────────────────────────────────────────────────────

function EdgePillbox({ edges, nodeModule }) {
  if (!edges?.length) return <span style={{ color:"var(--text3)", fontSize:11 }}>—</span>;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:3, maxWidth:380 }}>
      {edges.map((e, i) => {
        const xmod = e.module !== nodeModule;
        return (
          <span key={i} title={`${e.module}.${e.name} ×${e.call_count}`} style={{
            display:"inline-flex", alignItems:"center", gap:3,
            background: xmod ? "var(--blue-bg)" : "var(--bg3)",
            border:`1px solid ${xmod ? "var(--blue)" : "var(--border2)"}`,
            borderRadius:4, padding:"1px 5px", fontSize:11,
            fontFamily:"monospace", color: xmod ? "var(--blue)" : "var(--text2)",
            whiteSpace:"nowrap",
          }}>
            {e.name}<span style={{ color:"var(--text3)", fontSize:10 }}>×{e.call_count}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── PivotTable ─────────────────────────────────────────────────────────────────

function PivotTable({ data, measures }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const types  = data.measure_types || {};
  const dimKey = data.dimensions?.[0] || "group";

  if (!data?.rows?.length) return (
    <div style={{ padding:"40px 0", textAlign:"center", color:"var(--text3)" }}>No data.</div>
  );

  function toggle(k) {
    setCollapsed(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  return (
    <div className="card" style={{ overflow:"hidden" }}>
      <table>
        <thead>
          <tr>
            <th style={{ minWidth:200 }}>{dimKey === "symbol" ? "symbol · module" : dimKey}</th>
            {measures.map(m => <th key={measureKey(m)} style={{ textAlign:"right", whiteSpace:"nowrap" }}>{measureLabel(m)}{!m.special && <span style={{ color:"var(--text3)", fontSize:10, marginLeft:3 }}>{m.agg}</span>}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const pk         = row.key[dimKey];
            const ks         = JSON.stringify(row.key);
            const hasKids    = row.children?.length > 0;
            const isExpanded = hasKids && !collapsed.has(ks);
            return [
              <tr key={ks} style={{ cursor: hasKids?"pointer":"default" }} onClick={() => hasKids && toggle(ks)}>
                <td>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:16, flexShrink:0, color:"var(--text3)", fontSize:12 }}>{hasKids?(isExpanded?"▼":"▶"):""}</span>
                    {dimKey==="symbol" && pk ? (() => {
                      const [mod, ...rest] = pk.split("::");
                      const name = rest.join("::");
                      return <>
                        <span style={{ fontFamily:"monospace", fontSize:12 }}>{name}</span>
                        <span style={{ fontSize:10, color:"var(--text3)", fontFamily:"monospace" }}>· {mod}</span>
                      </>;
                    })() : <span style={{ fontFamily:"monospace", fontSize:12 }}>{pk ?? "—"}</span>}
                  </div>
                </td>
                {measures.map(m => {
                  const k = measureKey(m);
                  return <td key={k} style={{ textAlign:"right" }}>
                    {types[k]==="ratio" ? <RatioCell value={row.values[k]}/> : <span style={{ fontSize:12 }}>{fmt(row.values[k],types[k])}</span>}
                  </td>;
                })}
              </tr>,
              ...(isExpanded ? (row.children||[]).map(child => {
                const cv = child.key[data.dimensions[1]];
                return <tr key={JSON.stringify(child.key)} style={{ background:"var(--bg3)" }}>
                  <td><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ width:16 }}/><span style={{ width:14, color:"var(--text3)", fontSize:11 }}>└</span><span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text2)" }}>{cv ?? "—"}</span></div></td>
                  {measures.map(m => {
                    const k = measureKey(m);
                    return <td key={k} style={{ textAlign:"right" }}>
                      {types[k]==="ratio" ? <RatioCell value={child.values[k]}/> : <span style={{ fontSize:12, color:"var(--text2)" }}>{fmt(child.values[k],types[k])}</span>}
                    </td>;
                  })}
                </tr>;
              }) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── GraphRenderer ──────────────────────────────────────────────────────────────

function hex(n) { return Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0"); }
function lerpColor(a, b, t) {
  const p = c => [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
  const ca=p(a), cb=p(b);
  return "#"+ca.map((v,i)=>hex(v+(cb[i]-v)*t)).join("");
}

function drawPill(ctx, cx, cy, w, h) {
  const r = h / 2;
  ctx.beginPath();
  // Right cap (clockwise: top → bottom), then implicit line to left cap start,
  // then left cap (clockwise: bottom → top), then closePath draws top line back.
  ctx.arc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.arc(cx - w / 2 + r, cy, r,  Math.PI / 2, Math.PI * 1.5, false);
  ctx.closePath();
}

const MAX_LABEL = 22;

const BLOB_PALETTE = ["#58a6ff","#3fb950","#e3b341","#f85149","#a371f7","#39c5cf","#ff7b54","#56d364"];

// Andrew's monotone chain convex hull
function convexHull(pts) {
  if (pts.length < 3) return pts.map(p => [...p]);
  const s = [...pts].sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (O,A,B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
  const lower = [], upper = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower.at(-2),lower.at(-1),p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = s.length-1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper.at(-2),upper.at(-1),p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

// Draw a smooth blob (filled + stroked) around hull points
function drawBlob(ctx, hull, padding, lineWidth, color) {
  if (!hull?.length) return;
  // Expand each point outward from centroid
  const cx = hull.reduce((s,p)=>s+p[0],0) / hull.length;
  const cy = hull.reduce((s,p)=>s+p[1],0) / hull.length;
  let exp = hull.map(([x,y]) => {
    const dx=x-cx, dy=y-cy, len=Math.sqrt(dx*dx+dy*dy)||1;
    return [x+dx/len*padding, y+dy/len*padding];
  });

  // 2-point degenerate case: the two expanded points are collinear with the
  // centroid, so all bezier midpoints collapse to the same location and the
  // path has zero area (renders as a line, not a blob).
  // Fix: insert two perpendicular "wing" points to form a 4-point diamond,
  // which the bezier smoother then rounds into a proper oval.
  if (exp.length === 2) {
    const dx  = exp[1][0] - exp[0][0];
    const dy  = exp[1][1] - exp[0][1];
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const wing = padding * 0.65;         // perpendicular bulge ≈ 65% of padding
    const nx   = -dy / len * wing;       // perpendicular unit × wing
    const ny   =  dx / len * wing;
    const mx   = (exp[0][0] + exp[1][0]) / 2;
    const my   = (exp[0][1] + exp[1][1]) / 2;
    exp = [exp[0], [mx + nx, my + ny], exp[1], [mx - nx, my - ny]];
  }

  const n = exp.length;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(exp[0][0], exp[0][1], padding, 0, Math.PI*2);
  } else {
    // Smooth path: move to midpoint of each edge, quadratic through vertex
    const mid = i => [(exp[i][0]+exp[(i+1)%n][0])/2, (exp[i][1]+exp[(i+1)%n][1])/2];
    const m0 = mid(0);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid((i+1)%n);
      ctx.quadraticCurveTo(exp[(i+1)%n][0], exp[(i+1)%n][1], m[0], m[1]);
    }
  }
  ctx.closePath();
  ctx.fillStyle   = color + "1e";   // ~12% opacity fill
  ctx.fill();
  ctx.strokeStyle = color + "66";   // ~40% opacity stroke
  ctx.lineWidth   = lineWidth;
  ctx.stroke();
}

// Custom d3 force: pulls each node toward its group's centroid
function makeGroupCentroidForce(strength) {
  let _nodes = [];
  function force(alpha) {
    const centroids = new Map();
    for (const n of _nodes) {
      if (!n.group) continue;
      if (!centroids.has(n.group)) centroids.set(n.group, {x:0, y:0, count:0});
      const c = centroids.get(n.group);
      c.x += n.x; c.y += n.y; c.count++;
    }
    for (const c of centroids.values()) { c.x /= c.count; c.y /= c.count; }
    for (const n of _nodes) {
      if (!n.group) continue;
      const c = centroids.get(n.group);
      if (!c) continue;
      n.vx += (c.x - n.x) * strength * alpha;
      n.vy += (c.y - n.y) * strength * alpha;
    }
  }
  force.initialize = nodes => { _nodes = nodes; };
  return force;
}

// Generate N-step gradients for edge highlight (bright orange → faint cream)
function makeStepColors(n) {
  const a = [255, 149,   0]; // #ff9500 (step 0 = direct)
  const b = [255, 244, 204]; // #fff4cc (step n-1 = faintest)
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
  });
}
function makeStepWidths(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return 2.8 + (0.65 - 2.8) * t;
  });
}
function makeStepArrows(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return Math.round(8 + (4 - 8) * t);
  });
}

/** Pure BFS — returns Map<nodeId, hops> from `start` following `adj`, bounded by `maxD`. */
function bfsFromNode(start, adj, maxD) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const d   = dist.get(cur);
    if (d >= maxD) continue;
    for (const nb of (adj.get(cur) || [])) {
      if (!dist.has(nb)) { dist.set(nb, d + 1); queue.push(nb); }
    }
  }
  return dist;
}

/**
 * Single-select physics: pull BFS-reachable nodes to concentric rings around the
 * pinned selected node (depth 1 → radius radiusPer, depth 2 → 2×radiusPer, …).
 */
function makeSelectionRadialForce(selectedId, bfsDists, radiusPer) {
  let simNodes = [];
  function force(alpha) {
    const sel = simNodes.find(n => n.id === selectedId);
    if (!sel || sel.x == null) return;
    for (const n of simNodes) {
      if (n.id === selectedId || n.x == null) continue;
      const depth = bfsDists.get(n.id);
      if (depth == null) continue;
      const dx = n.x - sel.x, dy = n.y - sel.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const target = depth * radiusPer;
      const k = alpha * 0.14;
      n.vx += (dx / dist) * (target - dist) * k;
      n.vy += (dy / dist) * (target - dist) * k;
    }
  }
  force.initialize = ns => { simNodes = ns; };
  return force;
}

/**
 * Multi-select physics: pull chain nodes toward the centroid of all selected nodes,
 * with strength proportional to alpha.
 */
function makeChainCentroidForce(selectedIds, chainIds) {
  let simNodes = [];
  function force(alpha) {
    const sels = simNodes.filter(n => selectedIds.has(n.id) && n.x != null);
    if (!sels.length) return;
    const cx = sels.reduce((s, n) => s + n.x, 0) / sels.length;
    const cy = sels.reduce((s, n) => s + n.y, 0) / sels.length;
    for (const n of simNodes) {
      if (selectedIds.has(n.id) || !chainIds.has(n.id) || n.x == null) continue;
      n.vx += (cx - n.x) * alpha * 0.06;
      n.vy += (cy - n.y) * alpha * 0.06;
    }
  }
  force.initialize = ns => { simNodes = ns; };
  return force;
}

function GraphRenderer({ data, measures, onNodeClick,
  minWeight, setMinWeight, topK, setTopK,
  colorKeyOverride, setColorKeyOverride, fanOutDepth, setFanOutDepth,
  selectedNodeIds, setSelectedNodeIds, hideIsolated, setHideIsolated }) {
  const containerRef  = useRef(null);
  const fgRef         = useRef(null);
  const [size, setSize]     = useState({ w:800, h:640 });
  const [showSearch, setShowSearch]   = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Tracks the live d3-zoom transform so the wheel-pan handler has a consistent baseline
  const zoomTransformRef = useRef({ k: 1, x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setSize({ w, h: Math.max(600, Math.round(w * 0.68)) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const types     = data?.measure_types || {};
  const isBlobMode = (data?.dimensions?.length ?? 0) >= 2;
  const dim0      = data?.dimensions?.[0];   // outer dim (blob groups in blob mode, node dim in 1d)
  const dim1      = data?.dimensions?.[1];   // inner dim (nodes in blob mode)

  // Resolve color key: override if valid, else first measure
  const allMKeys = measures.map(measureKey);
  const colorKey = (colorKeyOverride && allMKeys.includes(colorKeyOverride))
    ? colorKeyOverride
    : (allMKeys[0] ?? null);

  const sizeKey = (() => {
    const m = measures.find(m => m.special === "symbol_count") || measures[0];
    return m ? measureKey(m) : null;
  })();

  // Min/max across all value rows (leaf rows in blob mode, top-level otherwise)
  const colorStats = useMemo(() => {
    if (!colorKey || !data?.rows) return { min: 0, max: 1 };
    const rows = isBlobMode ? data.rows.flatMap(r => r.children || []) : data.rows;
    const vals = rows.map(r => r.values[colorKey]).filter(v => v != null && isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    const mn = Math.min(...vals), mx = Math.max(...vals);
    return { min: mn, max: mx === mn ? mn + 1 : mx };
  }, [colorKey, data, isBlobMode]);

  // Map outer-dim value → blob color
  const groupColorMap = useMemo(() => {
    if (!isBlobMode || !data?.rows) return new Map();
    return new Map(data.rows.map((r, i) => [r.key[dim0], BLOB_PALETTE[i % BLOB_PALETTE.length]]));
  }, [isBlobMode, data, dim0]);

  const graphData = useMemo(() => {
    if (!data?.rows) return { nodes:[], links:[], isBlobMode:false };

    /**
     * Apply weight/topK limits to raw edge list, then drop any edge where
     * source or target is not in `validIds`.
     *
     * Passing validIds prevents the d3 "node not found" crash that occurs
     * when a filter removes nodes but leaves stale edges referencing them.
     */
    function filterEdges(raw, validIds) {
      let edges = [...(raw || [])];
      if (minWeight > 1) edges = edges.filter(e => e.weight >= minWeight);
      if (topK > 0) {
        const bySource = new Map();
        for (const e of edges) {
          if (!bySource.has(e.source)) bySource.set(e.source, []);
          bySource.get(e.source).push(e);
        }
        edges = [];
        for (const arr of bySource.values()) {
          arr.sort((a,b) => b.weight - a.weight);
          edges.push(...arr.slice(0, topK));
        }
      }
      const mapped = edges.map(e => ({ source:e.source, target:e.target, value:e.weight }));
      // Remove edges that reference nodes outside the current visible set.
      // filterEdgesToNodes also handles d3-mutated source/target objects.
      return filterEdgesToNodes(mapped, validIds);
    }

    function makeColor(vals) {
      const t = colorKey
        ? Math.max(0, Math.min(1, (vals[colorKey] - colorStats.min) / (colorStats.max - colorStats.min)))
        : 0.5;
      return lerpColor("#3fb950","#f85149", t);
    }

    if (isBlobMode) {
      // Nodes = one per unique inner-dim value. The same community can appear
      // as a child under multiple module rows (cross-tab), so deduplicate here:
      // keep the row whose sizeKey measure is highest → that module "wins" and
      // the node belongs to its blob. Edges use bare inner-dim IDs and work
      // correctly with this deduplication.
      const leafRows = data.rows.flatMap(pr =>
        (pr.children || []).map(c => ({ ...c, _group: pr.key[dim0] }))
      );
      const maxSize = Math.max(1, ...leafRows.map(r => r.values[sizeKey] || 0));

      const byInner = new Map(); // innerVal → best row
      for (const r of leafRows) {
        const innerVal = r.key[dim1];
        const existing = byInner.get(innerVal);
        if (!existing || (r.values[sizeKey] || 0) > (existing.values[sizeKey] || 0))
          byInner.set(innerVal, r);
      }

      const nodes = [...byInner.values()].map(r => {
        const id   = r.key[dim1];
        const vals = r.values;
        const sz   = Math.sqrt((vals[sizeKey]||1)/maxSize)*18+4;
        return { id, name:id, values:vals, group:r._group, val:sz, color:makeColor(vals) };
      });
      const validIds = new Set(nodes.map(n => n.id));
      const links = filterEdges(data.leaf_graph_edges, validIds);
      if (hideIsolated) {
        const connected = new Set();
        links.forEach(l => { connected.add(l.source); connected.add(l.target); });
        return { nodes: nodes.filter(n => connected.has(n.id)), links, isBlobMode:true };
      }
      return { nodes, links, isBlobMode:true };
    }

    // Single-dim: top-level rows are nodes
    const maxSize = Math.max(1, ...data.rows.map(r => r.values[sizeKey] || 0));
    const nodes = data.rows.map(r => {
      const id   = r.key[dim0];
      const vals = r.values;
      const sz   = Math.sqrt((vals[sizeKey]||1)/maxSize)*18+4;
      return { id, name:id, values:vals, val:sz, color:makeColor(vals) };
    });
    const validIds = new Set(nodes.map(n => n.id));
    const links = filterEdges(data.graph_edges, validIds);
    if (hideIsolated) {
      const connected = new Set();
      links.forEach(l => { connected.add(l.source); connected.add(l.target); });
      return { nodes: nodes.filter(n => connected.has(n.id)), links, isBlobMode:false };
    }
    return { nodes, links, isBlobMode:false };
  }, [data, minWeight, topK, colorKey, colorStats, sizeKey, dim0, dim1, isBlobMode, hideIsolated]);

  // Build forward + reverse adjacency maps from current graph links
  const { fwdAdj, bwdAdj } = useMemo(() => {
    const fwd = new Map(), bwd = new Map();
    for (const link of graphData.links) {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      if (!fwd.has(src)) fwd.set(src, []);  fwd.get(src).push(tgt);
      if (!bwd.has(tgt)) bwd.set(tgt, []);  bwd.get(tgt).push(src);
    }
    return { fwdAdj: fwd, bwdAdj: bwd };
  }, [graphData.links]);

  // Single-select fan-out: BFS forward from the one selected node (depth ≤ fanOutDepth)
  const bfsDistances = useMemo(() => {
    if (selectedNodeIds.size !== 1) return new Map();
    return bfsFromNode([...selectedNodeIds][0], fwdAdj, fanOutDepth);
  }, [selectedNodeIds, fwdAdj, fanOutDepth]);

  // Multi-select chain mode — proper graph traversal, not array filtering.
  //
  // For each ordered pair (S, T) of selected nodes:
  //   1. Build the "progress subgraph": edges (u→v) where both monotone guards hold
  //      AND the total path length ≤ maxHops. This subgraph only contains edges
  //      that could plausibly be on a valid S→T path.
  //   2. BFS forward from S within that subgraph → forwardReachable
  //   3. BFS backward from T within that subgraph → backwardReachable
  //   4. Keep only edges where source ∈ forwardReachable AND target ∈ backwardReachable.
  //
  // Because we start from S and only follow edges, the result is always connected —
  // a traversal cannot reach a node it has no path to.
  const chainEdgeMap = useMemo(() => {
    if (selectedNodeIds.size < 2) return new Map(); // Map<"u|v", minChainLen>
    const sel = [...selectedNodeIds];
    const fwd = sel.map(s => bfsFromNode(s, fwdAdj, fanOutDepth));
    const bwd = sel.map(t => bfsFromNode(t, bwdAdj, fanOutDepth));

    const result = new Map();

    for (let i = 0; i < sel.length; i++) {
      for (let j = 0; j < sel.length; j++) {
        if (i === j) continue;
        const S = sel[i], T = sel[j];

        // ── Step 1: build the progress subgraph for this (S, T) pair ──────────
        // progressOut[u] = list of v nodes reachable from u via progress edges
        // progressIn[v]  = list of u nodes that lead to v via progress edges
        const progressOut  = new Map();
        const progressIn   = new Map();
        const pairEdgeLens = new Map(); // "u|v" → chain length for this pair

        for (const link of graphData.links) {
          const u = typeof link.source === "object" ? link.source.id : link.source;
          const v = typeof link.target === "object" ? link.target.id : link.target;

          const du  = fwd[i].get(u);  if (du  == null) continue;
          const dvu = fwd[i].get(v);  if (dvu == null || dvu <= du) continue; // fwd guard
          const dv  = bwd[j].get(v);  if (dv  == null) continue;
          const duT = bwd[j].get(u);  if (duT == null || duT <= dv) continue; // bwd guard
          const len = du + 1 + dv;    if (len  > fanOutDepth)       continue;

          pairEdgeLens.set(`${u}|${v}`, len);
          if (!progressOut.has(u)) progressOut.set(u, []);
          progressOut.get(u).push(v);
          if (!progressIn.has(v)) progressIn.set(v, []);
          progressIn.get(v).push(u);
        }

        if (!pairEdgeLens.size) continue;

        // ── Step 2: BFS forward from S in the progress subgraph ───────────────
        const forwardReachable = new Set([S]);
        const fq = [S];
        while (fq.length) {
          const u = fq.shift();
          for (const v of (progressOut.get(u) || [])) {
            if (!forwardReachable.has(v)) { forwardReachable.add(v); fq.push(v); }
          }
        }
        if (!forwardReachable.has(T)) continue; // T unreachable from S → skip pair

        // ── Step 3: BFS backward from T in the progress subgraph ─────────────
        const backwardReachable = new Set([T]);
        const bq = [T];
        while (bq.length) {
          const v = bq.shift();
          for (const u of (progressIn.get(v) || [])) {
            if (!backwardReachable.has(u)) { backwardReachable.add(u); bq.push(u); }
          }
        }

        // ── Step 4: keep only edges in the forward ∩ backward intersection ───
        // An edge (u→v) is on a valid S→T path iff u is forward-reachable from S
        // AND v can reach T backward. This is the only set of edges that cannot
        // produce disconnected subgraphs.
        for (const [key, len] of pairEdgeLens) {
          const bar = key.indexOf("|");
          const u = key.slice(0, bar), v = key.slice(bar + 1);
          if (forwardReachable.has(u) && backwardReachable.has(v)) {
            const prev = result.get(key);
            if (prev == null || len < prev) result.set(key, len);
          }
        }
      }
    }

    return result;
  }, [selectedNodeIds, fwdAdj, bwdAdj, graphData.links, fanOutDepth]);

  // Nodes that lie on at least one connecting chain (+ the selected nodes themselves)
  const chainNodeIds = useMemo(() => {
    if (chainEdgeMap.size === 0) return new Set();
    const ids = new Set(selectedNodeIds);
    for (const key of chainEdgeMap.keys()) {
      const bar = key.indexOf("|");
      ids.add(key.slice(0, bar));
      ids.add(key.slice(bar + 1));
    }
    return ids;
  }, [chainEdgeMap, selectedNodeIds]);

  // Dynamic step arrays — recomputed when fanOutDepth changes
  const stepColors = useMemo(() => makeStepColors(fanOutDepth), [fanOutDepth]);
  const stepWidths = useMemo(() => makeStepWidths(fanOutDepth), [fanOutDepth]);
  const stepArrows = useMemo(() => makeStepArrows(fanOutDepth), [fanOutDepth]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-350).distanceMax(400);
    const link = fg.d3Force("link");
    if (link) link.distance(120);
    fg.d3Force("groupCentroid", graphData.isBlobMode ? makeGroupCentroidForce(0.1) : null);
    fg.d3ReheatSimulation?.();
  }, [graphData]);

  // ── Selection-driven physics ────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Unpin every node first
    for (const n of graphData.nodes) { delete n.fx; delete n.fy; }

    const linkForce = fg.d3Force("link");

    if (selectedNodeIds.size === 1) {
      const selId = [...selectedNodeIds][0];
      const selNode = graphData.nodes.find(n => n.id === selId);
      // Pin the selected node so reachable nodes fan out around it
      if (selNode?.x != null) { selNode.fx = selNode.x; selNode.fy = selNode.y; }

      fg.d3Force("selRadial",    makeSelectionRadialForce(selId, bfsDistances, 120));
      fg.d3Force("chainCentroid", null);
      // Restore uniform link distances (chain mode may have changed them)
      if (linkForce) linkForce.distance(120).strength(0.5);

    } else if (selectedNodeIds.size >= 2) {
      // Pin each selected node so they act as stable poles
      for (const selId of selectedNodeIds) {
        const sn = graphData.nodes.find(n => n.id === selId);
        if (sn?.x != null) { sn.fx = sn.x; sn.fy = sn.y; }
      }
      fg.d3Force("chainCentroid", makeChainCentroidForce(selectedNodeIds, chainNodeIds));
      fg.d3Force("selRadial", null);
      // Chain edges stay at a readable distance; non-chain edges get long slack
      // so unrelated nodes drift to the periphery without crowding the path.
      if (linkForce) {
        linkForce.distance(link => {
          const u = link.source?.id ?? link.source;
          const v = link.target?.id ?? link.target;
          return chainEdgeMap.has(`${u}|${v}`) ? 130 : 260;
        }).strength(link => {
          const u = link.source?.id ?? link.source;
          const v = link.target?.id ?? link.target;
          return chainEdgeMap.has(`${u}|${v}`) ? 0.45 : 0.04;
        });
      }

    } else {
      // No selection — restore defaults
      fg.d3Force("selRadial",    null);
      fg.d3Force("chainCentroid", null);
      if (linkForce) linkForce.distance(120).strength(0.5);
    }

    fg.d3ReheatSimulation?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeIds, bfsDistances, chainNodeIds, chainEdgeMap]);

  // ── Scroll pan / pinch zoom ──────────────────────────────────────────────────
  // onZoom reports {k, x, y} where x/y are graph-space center (NOT d3 translation).
  // Pan formula: new_center = old_center + delta_screen / k
  // ctrlKey = macOS pinch-to-zoom → pass through to d3.
  // All other wheel events → translate the camera.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-to-zoom — let d3 handle
      e.preventDefault();
      e.stopPropagation();
      const fg = fgRef.current;
      if (!fg) return;
      const { k, x, y } = zoomTransformRef.current;
      if (!k) return;
      // Cap per-event delta to prevent momentum-scroll explosions
      const MAX_DELTA = 80;
      const dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaX));
      const dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaY));
      // x/y are graph-space center — move by (delta / k) to stay proportional to zoom
      const newX = x + dx / k;
      const newY = y + dy / k;
      zoomTransformRef.current = { k, x: newX, y: newY };
      fg.centerAt(newX, newY, 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Node search modal (/  or  Cmd+K / Ctrl+K) ───────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Ignore keystrokes when focus is inside an input/textarea/select
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/" ) { e.preventDefault(); setShowSearch(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searchTerms = searchQuery.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const searchMatches = useMemo(() => {
    if (!searchTerms.length) return [];
    return graphData.nodes.filter(n =>
      searchTerms.some(t => n.id.toLowerCase().includes(t))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, graphData.nodes]);

  function applySearch() {
    if (searchMatches.length > 0)
      setSelectedNodeIds(new Set(searchMatches.map(n => n.id)));
  }

  const totalEdges   = data?.graph_edges?.length || 0;
  const visibleEdges = graphData.links.length;

  // Format a color-measure value for the legend
  const colorMeasure = measures.find(m => measureKey(m) === colorKey);
  function fmtLegend(v) {
    if (v == null) return "—";
    const t = colorMeasure ? types[measureKey(colorMeasure)] : null;
    if (t === "ratio") return `${(v*100).toFixed(1)}%`;
    if (t === "float") return v < 0.01 ? v.toExponential(2) : v.toFixed(3);
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  }

  return (
    <div>
      {/* Controls row */}
      <div style={{ display:"flex", gap:20, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
        {/* Color by */}
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Color by:</span>
          <select
            value={colorKey || ""}
            onChange={e => setColorKeyOverride(e.target.value || null)}
            style={{ padding:"3px 8px", fontSize:12, background:"var(--bg3)",
              border:"1px solid var(--border2)", borderRadius:4, color:"var(--text)" }}
          >
            {measures.map(m => (
              <option key={measureKey(m)} value={measureKey(m)}>
                {measureLabel(m)}{!m.special ? ` (${m.agg})` : ""}
              </option>
            ))}
          </select>
        </div>
        {/* Edge weight */}
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Min edge weight:</span>
          <input type="number" min={1} value={minWeight}
            onChange={e => setMinWeight(Math.max(1,+e.target.value))}
            style={{ width:70, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Top edges per node:</span>
          <input type="number" min={0} placeholder="all" value={topK||""}
            onChange={e => setTopK(Math.max(0,+e.target.value||0))}
            style={{ width:70, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }} title="Max hops for fan-out (1 node selected) or chain search (2+ nodes, Shift+click)">Max hops:</span>
          <input type="number" min={1} max={10} value={fanOutDepth}
            onChange={e => setFanOutDepth(Math.max(1, Math.min(10, +e.target.value || 1)))}
            style={{ width:55, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        {selectedNodeIds.size >= 2 && (
          <span style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:11, color:"var(--blue)", fontWeight:600 }}>
              🔗 {selectedNodeIds.size} nodes — showing connecting chains
            </span>
            <button
              onClick={() => setSelectedNodeIds(new Set())}
              style={{ fontSize:11, padding:"2px 7px", background:"var(--bg3)",
                border:"1px solid var(--border2)", borderRadius:4,
                color:"var(--text2)", cursor:"pointer" }}
            >clear</button>
          </span>
        )}
        {/* Hide isolated toggle */}
        <button
          onClick={() => setHideIsolated(v => !v)}
          title="Toggle visibility of nodes with no edges"
          style={{ fontSize:11, padding:"3px 9px", cursor:"pointer", borderRadius:4,
            border:"1px solid var(--border2)",
            background: hideIsolated ? "var(--blue)" : "var(--bg3)",
            color:       hideIsolated ? "#fff"       : "var(--text2)" }}
        >{hideIsolated ? "✕ isolated hidden" : "show isolated"}</button>
        {/* Search shortcut hint */}
        <button
          onClick={() => setShowSearch(true)}
          title="Search and select nodes by name (/ or ⌘K)"
          style={{ fontSize:11, padding:"3px 9px", cursor:"pointer", borderRadius:4,
            border:"1px solid var(--border2)", background:"var(--bg3)", color:"var(--text2)" }}
        >🔍 search <kbd style={{ opacity:0.6, fontSize:10 }}>/</kbd></button>
        <span style={{ fontSize:11, color:"var(--text3)" }}>{visibleEdges} / {totalEdges} edges shown</span>
      </div>

      {/* Graph — full width */}
      <div ref={containerRef} style={{ position:"relative", borderRadius:8, overflow:"hidden", background:"var(--bg2)", border:"1px solid var(--border)" }}>
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={fgRef}
              // key forces full d3 remount when node set changes.
              // Without this, d3's cached node references go stale after filters
              // change the node list, producing "node not found" or "Cannot set
              // property vx on string" crashes.
              key={graphData.nodes.map(n => n.id).sort().join("|")}
              width={size.w} height={size.h}
              graphData={graphData}
              nodeLabel=""
              nodeVal={n => n.val}
              nodeColor={n => n.color}
              onRenderFramePre={graphData.isBlobMode ? (ctx, gs) => {
                // Draw amorphous blobs behind nodes — one per outer-dim group
                const groupPos = new Map();
                for (const node of graphData.nodes) {
                  if (node.x == null) continue;
                  if (!groupPos.has(node.group)) groupPos.set(node.group, []);
                  groupPos.get(node.group).push([node.x, node.y]);
                }
                for (const [group, pts] of groupPos) {
                  const color = groupColorMap.get(group) || "#888888";
                  const hull  = pts.length >= 3 ? convexHull(pts) : pts.map(p => [...p]);
                  drawBlob(ctx, hull, 32/gs, 1.5/gs, color);
                  // Group label at centroid
                  const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
                  const cy = pts.reduce((s,p)=>s+p[1],0)/pts.length;
                  ctx.font         = `bold ${15/gs}px sans-serif`;
                  ctx.fillStyle    = (groupColorMap.get(group)||"#888888") + "99";
                  ctx.textAlign    = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText(String(group), cx, cy);
                }
              } : undefined}
              nodeCanvasObjectMode={() => "replace"}
              nodeCanvasObject={(node, ctx) => {
                const isSelected  = selectedNodeIds.has(node.id);
                const anySelected = selectedNodeIds.size > 0;
                const isReachable = !anySelected ? true
                  : selectedNodeIds.size === 1 ? bfsDistances.has(node.id)
                  : chainNodeIds.has(node.id);

                // For symbol mode the id is "module::name" — show only the name part
                const full  = node.name || "";
                const short = full.includes("::") ? full.split("::").slice(1).join("::") : full;
                const label = short.length > MAX_LABEL ? short.slice(0, MAX_LABEL - 1) + "…" : short;
                const fs    = 11;
                ctx.font    = `600 ${fs}px monospace`;
                const tw    = ctx.measureText(label).width;
                const padX  = 8, padY = 5;
                const w     = Math.max(tw + padX * 2, 30);
                const h     = fs + padY * 2;

                // Dim nodes not on any chain (or not reachable in fan-out mode)
                ctx.globalAlpha = anySelected ? (isReachable ? 1.0 : 0.18) : 1.0;

                // Selection halo — drawn slightly larger, behind the pill
                if (isSelected) {
                  drawPill(ctx, node.x, node.y, w + 7, h + 7);
                  ctx.strokeStyle = "rgba(255,255,255,0.85)";
                  ctx.lineWidth   = 2.5;
                  ctx.stroke();
                }

                // Pill background
                drawPill(ctx, node.x, node.y, w, h);
                ctx.fillStyle   = isSelected ? lerpColor(node.color, "#ffffff", 0.25) : node.color;
                ctx.fill();
                ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.12)";
                ctx.lineWidth   = isSelected ? 1.5 : 0.8;
                ctx.stroke();

                // Label
                ctx.fillStyle    = "#0d1117";
                ctx.textAlign    = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, node.x, node.y);

                ctx.globalAlpha = 1.0;
                // Cache dims for pointer detection
                node.__bckgDimensions = [w, h];
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                const [w = 40, h = 20] = node.__bckgDimensions || [];
                drawPill(ctx, node.x, node.y, w, h);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkWidth={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 0) return Math.log(1 + (link.value||1)) * 0.8 + 0.3;
                if (selectedNodeIds.size === 1) {
                  const d = bfsDistances.get(src);
                  return d != null && d < stepWidths.length ? stepWidths[d] : 0.3;
                }
                // Chain mode: width by min chain length (1-indexed step)
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return 0.3;
                return stepWidths[Math.min(cl - 1, stepWidths.length - 1)];
              }}
              linkColor={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 0) return "#30363d";
                if (selectedNodeIds.size === 1) {
                  const d = bfsDistances.get(src);
                  return d != null && d < stepColors.length ? stepColors[d] : "rgba(48,54,61,0.15)";
                }
                // Chain mode: color by min chain length covering this edge
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return "rgba(48,54,61,0.12)";
                return stepColors[Math.min(cl - 1, stepColors.length - 1)];
              }}
              linkDirectionalArrowLength={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 0) return 5;
                if (selectedNodeIds.size === 1) {
                  const d = bfsDistances.get(src);
                  return d != null && d < stepArrows.length ? stepArrows[d] : 2;
                }
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return 2;
                return stepArrows[Math.min(cl - 1, stepArrows.length - 1)];
              }}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={link => {
                // Control particle count per-link so the library doesn't freeze
                // them when selection state changes. 0 = no particles at all.
                if (selectedNodeIds.size === 0) return 2;
                const u = typeof link.source === "object" ? link.source.id : link.source;
                const v = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 1) return bfsDistances.has(u) ? 2 : 0;
                return chainEdgeMap.has(`${u}|${v}`) ? 2 : 0;
              }}
              linkDirectionalParticleSpeed={0.004}
              linkDirectionalParticleWidth={link => {
                if (selectedNodeIds.size === 0) return 3;
                const u = typeof link.source === "object" ? link.source.id : link.source;
                const v = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 1) return bfsDistances.has(u) ? 5 : 0;
                return chainEdgeMap.has(`${u}|${v}`) ? 5 : 0;
              }}
              linkDirectionalParticleColor={() => "#ffffff"}
              onZoom={t => { zoomTransformRef.current = t; }}
              onNodeClick={(node, event) => {
                const id = node?.id ?? null;
                if (!id) return;
                setSelectedNodeIds(prev => {
                  if (event?.shiftKey) {
                    // Shift+click: toggle node in multi-select set
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  }
                  // Plain click: single-select (or deselect if already sole selection)
                  return prev.size === 1 && prev.has(id) ? new Set() : new Set([id]);
                });
                onNodeClick?.(node);
              }}
              backgroundColor="#0d1117"
            />
          ) : (
            <div style={{ height:520, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text3)" }}>
              No nodes to display.
            </div>
          )}

        {/* ── Node search modal ───────────────────────────────────────── */}
        {showSearch && (
          <div
            style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)",
              display:"flex", alignItems:"flex-start", justifyContent:"center",
              paddingTop:60, zIndex:50 }}
            onClick={e => { if (e.target === e.currentTarget) { setShowSearch(false); setSearchQuery(""); } }}
          >
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)",
              borderRadius:8, padding:16, width:440, maxWidth:"90%",
              boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ marginBottom:8, fontSize:11, color:"var(--text3)" }}>
                Partial name match · separate multiple with <strong style={{ color:"var(--text2)" }}>,</strong> · <kbd style={{ opacity:0.7 }}>Enter</kbd> selects · <kbd style={{ opacity:0.7 }}>Esc</kbd> closes
              </div>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); }
                  if (e.key === "Enter")  { applySearch(); setShowSearch(false); setSearchQuery(""); }
                }}
                placeholder="e.g. parser, resolve_type"
                style={{ width:"100%", padding:"8px 12px", fontSize:13,
                  boxSizing:"border-box", background:"var(--bg3)",
                  border:"1px solid var(--border2)", borderRadius:4,
                  color:"var(--text)", outline:"none" }}
              />
              <div style={{ marginTop:8, fontSize:11, color: searchMatches.length > 0 ? "var(--text2)" : "var(--text3)", minHeight:16 }}>
                {searchTerms.length === 0 ? `${graphData.nodes.length} nodes total`
                  : searchMatches.length === 0 ? "No matches"
                  : <>
                      <span style={{ color:"var(--blue)", fontWeight:600 }}>{searchMatches.length}</span>
                      {" match"}{searchMatches.length !== 1 ? "es" : ""}: {" "}
                      {searchMatches.slice(0,6).map(n => <code key={n.id} style={{ marginRight:4, opacity:0.8 }}>{n.id}</code>)}
                      {searchMatches.length > 6 && <span style={{ opacity:0.5 }}>+{searchMatches.length - 6} more</span>}
                    </>
                }
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Slim legend bar below graph */}
      {colorMeasure && (
        <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8, fontSize:11, color:"var(--text3)" }}>
          <span>Color = {measureLabel(colorMeasure)}{!colorMeasure.special && ` (${colorMeasure.agg})`}</span>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span>{fmtLegend(colorStats.min)}</span>
            <div style={{ width:80, height:6, borderRadius:3, background:"linear-gradient(to right,#3fb950,#f85149)" }} />
            <span>{fmtLegend(colorStats.max)}</span>
          </div>
          {sizeKey && sizeKey !== colorKey && <span>· Size ∝ {measureLabel(measures.find(m=>measureKey(m)===sizeKey))}</span>}
        </div>
      )}
    </div>
  );
}

// ── GraphNodeDetails ─────────────────────────────────────────────────────────

function GraphNodeDetails({ node, measures, types }) {
  // `node` is the last-hovered node object (or null before first hover)
  const [pinned, setPinned] = useState(null);
  const lastRef             = useRef(null);

  // Accumulate last seen non-null node so panel doesn't blank on mouse-out
  const display = node || lastRef.current;
  if (node) lastRef.current = node;

  return (
    <div className="card" style={{ width:220, flexShrink:0, padding:"14px 16px", minHeight:180 }}>
      {display ? (
        <>
          {(() => {
            const full = display.name || "";
            const [mod, ...rest] = full.split("::");
            const name = rest.length ? rest.join("::") : full;
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontFamily:"monospace", fontWeight:700, fontSize:13, color:"var(--text)", wordBreak:"break-all" }}>{name}</div>
                {rest.length > 0 && <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--text3)", marginTop:2 }}>{mod}</div>}
                {display.group && <div style={{ fontSize:10, color:"var(--blue)", marginTop:2 }}>{display.group}</div>}
              </div>
            );
          })()}
          {measures.map(m => {
            const k = measureKey(m);
            const v = display.values?.[k];
            const t = types?.[k];
            return (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:7, fontSize:12, gap:8 }}>
                <span style={{ color:"var(--text3)", flexShrink:0 }}>
                  {measureLabel(m)}{!m.special && <span style={{ fontSize:10, marginLeft:3 }}>{m.agg}</span>}
                </span>
                <span style={{ fontWeight:600, color: t==="ratio" ? (v>0.5?"var(--red)":v>0.25?"var(--yellow)":"var(--green)") : "var(--text)" }}>
                  {fmt(v, t)}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <div style={{ color:"var(--text3)", fontSize:12, textAlign:"center", paddingTop:30 }}>
          Click a node<br/>to see details
        </div>
      )}
    </div>
  );
}

// ── NodeTable ──────────────────────────────────────────────────────────────────

function NodeTable({ repoId, hasEnriched, kinds }) {
  const [sortBy,  setSortBy]  = useState("caller_count");
  const [sortDir, setSortDir] = useState("desc");
  const kindsStr = kinds.join(",");

  const { data, isLoading } = useQuery({
    queryKey: ["explore-nodes", repoId, sortBy, sortDir, kindsStr],
    queryFn:  () => api.exploreNodes(repoId, sortBy, sortDir, 200, kindsStr),
  });

  function toggleSort(key) {
    if (sortBy === key) setSortDir(d => d==="desc"?"asc":"desc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  if (isLoading) return <div className="loading">Loading nodes…</div>;
  const nodes = data?.nodes || [];
  const total = data?.total || 0;

  function SortTh({ sortKey, label, enriched }) {
    if (enriched && !hasEnriched) return null;
    const active = sortBy === sortKey;
    return (
      <th onClick={() => toggleSort(sortKey)} style={{ cursor:"pointer", userSelect:"none", textAlign:"right", whiteSpace:"nowrap" }}>
        {label}{active?(sortDir==="desc"?" ↓":" ↑"):""}
      </th>
    );
  }

  return (
    <>
      <div style={{ fontSize:12, color:"var(--text2)", marginBottom:10 }}>
        Showing {nodes.length} of {total} nodes
        {kinds.length>0 && <span style={{ marginLeft:8, color:"var(--blue)" }}>({kinds.join(", ")} only)</span>}
      </div>
      <div className="card" style={{ overflow:"auto" }}>
        <table style={{ minWidth:860 }}>
          <thead>
            <tr>
              <th style={{ minWidth:200 }}>Symbol</th>
              <th>Module · Kind</th>
              <th>Risk</th>
              <SortTh sortKey="caller_count" label="callers" />
              <SortTh sortKey="callee_count" label="callees" />
              <SortTh sortKey="complexity"   label="complexity" />
              {hasEnriched && <SortTh sortKey="utility_score" label="utility"  enriched />}
              {hasEnriched && <SortTh sortKey="pagerank"      label="pagerank" enriched />}
              <th>Calls →</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map(node => (
              <tr key={node.hash}>
                <td>
                  <div style={{ fontFamily:"monospace", fontWeight:600, fontSize:12 }}>{node.name}</div>
                  <div style={{ fontSize:10, color:"var(--text3)", marginTop:2 }}>{node.file_path}:{node.line_start}</div>
                </td>
                <td>
                  <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text2)" }}>{node.module}</span>
                  <span style={{ color:"var(--text3)", margin:"0 4px" }}>·</span>
                  <span style={{ fontSize:11, color:"var(--text3)" }}>{node.kind}</span>
                </td>
                <td>{node.risk&&<span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:RISK_BG[node.risk]||"var(--bg3)", color:RISK_COLOR[node.risk]||"var(--text2)" }}>{node.risk}</span>}</td>
                <td style={{ textAlign:"right", fontWeight:node.caller_count>10?700:400, color:node.caller_count>10?"var(--yellow)":"var(--text)" }}>{node.caller_count}</td>
                <td style={{ textAlign:"right", color:"var(--text2)" }}>{node.callee_count}</td>
                <td style={{ textAlign:"right", color:node.complexity>5?"var(--red)":"var(--text2)" }}>{node.complexity}</td>
                {hasEnriched&&<td style={{ textAlign:"right", color:"var(--text2)" }}>{node.utility_score!=null?node.utility_score.toFixed(3):"—"}</td>}
                {hasEnriched&&<td style={{ textAlign:"right", color:"var(--text2)" }}>{node.pagerank!=null?node.pagerank.toFixed(4):"—"}</td>}
                <td><EdgePillbox edges={node.outbound_edges} nodeModule={node.module}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

// ── URL ↔ state helpers ────────────────────────────────────────────────────────

function parseMeasuresParam(raw) {
  if (!raw) return DEFAULT_MEASURES;
  return raw.split(",").filter(Boolean).map(s => {
    if (SPECIAL_LABELS[s] !== undefined) return { special: s };
    if (s.includes(":")) {
      const colon = s.indexOf(":");
      return { field: s.slice(0, colon), agg: s.slice(colon + 1) };
    }
    return { special: s };
  }).filter(m => m.special ? SPECIAL_LABELS[m.special] !== undefined : FIELD_META[m.field]);
}

function parseFiltersParam(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Explore() {
  const { repoId, setRepoId } = useContext(RepoContext);
  const [searchParams, setSearchParams] = useSearchParams();

  // Lazy-init all state from URL params (runs once on mount)
  const [dims,             setDims]             = useState(() => {
    const d = searchParams.get("d");
    return d ? d.split(",").filter(Boolean) : DEFAULT_DIMS;
  });
  const [measures,         setMeasures]         = useState(() =>
    parseMeasuresParam(searchParams.get("m"))
  );
  const [kinds,            setKinds]            = useState(() => {
    const k = searchParams.get("k");
    return k ? k.split(",").filter(Boolean) : [];
  });
  const [renderer,         setRenderer]         = useState(() =>
    searchParams.get("v") || "graph"
  );
  const [filters,          setFilters]          = useState(() =>
    parseFiltersParam(searchParams.get("f"))
  );
  // ── Graph renderer config (lifted here so URL can persist them) ─────────────
  const [minWeight,        setMinWeight]        = useState(() => parseFloat(searchParams.get("mw")) || 1);
  const [topK,             setTopK]             = useState(() => parseInt(searchParams.get("tk"))   || 0);
  const [colorKeyOverride, setColorKeyOverride] = useState(() => searchParams.get("c") || null);
  const [fanOutDepth,      setFanOutDepth]      = useState(() => parseInt(searchParams.get("hops")) || 5);
  const [selectedNodeIds,  setSelectedNodeIds]  = useState(() => {
    const s = searchParams.get("sel");
    return s ? new Set(s.split(",").filter(Boolean)) : new Set();
  });
  const [hideIsolated, setHideIsolated] = useState(() => searchParams.get("hi") === "1");

  const [selectedNode, setSelectedNode] = useState(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const configCardRef                   = useRef(null);
  const [controlsRect, setControlsRect] = useState({ width: 0, height: 0 });

  // Measure the floating config card so GraphRenderer can offset its center
  useEffect(() => {
    if (!configCardRef.current) {
      setControlsRect({ width: 0, height: 0 });
      return;
    }
    const obs = new ResizeObserver(() => {
      const r = configCardRef.current?.getBoundingClientRect();
      if (r) setControlsRect({ width: r.width, height: r.height });
    });
    obs.observe(configCardRef.current);
    return () => obs.disconnect();
  }, [sidebarOpen]); // re-run when card appears/disappears

  // DnD sensors — require 5px of movement before activating so clicks still work
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDimDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setDims(prev => {
      const oldIdx = prev.indexOf(active.id);
      const newIdx = prev.indexOf(over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function handleMeasureDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setMeasures(prev => {
      const oldIdx = prev.findIndex(m => measureKey(m) === active.id);
      const newIdx = prev.findIndex(m => measureKey(m) === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  // On mount: if URL has a repo param, sync it to context
  useEffect(() => {
    const r = searchParams.get("r");
    if (r && r !== repoId) setRepoId(r);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync all state → URL on every change (replace, not push)
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("r", repoId);
    p.set("v", renderer);
    if (dims.length)                p.set("d", dims.join(","));
    p.set("m", measures.map(measureStr).join(","));
    if (kinds.length)               p.set("k", kinds.join(","));
    if (filters.length)             p.set("f", JSON.stringify(filters));
    // Graph renderer config — only write non-default values to keep URLs clean
    if (minWeight > 1)              p.set("mw",   minWeight);
    if (topK > 0)                   p.set("tk",   topK);
    if (colorKeyOverride)           p.set("c",    colorKeyOverride);
    if (fanOutDepth !== 5)          p.set("hops", fanOutDepth);
    if (selectedNodeIds.size > 0)   p.set("sel",  [...selectedNodeIds].join(","));
    if (hideIsolated)               p.set("hi",   "1");
    setSearchParams(p, { replace: true });
  }, [repoId, renderer, dims, measures, kinds, filters, // eslint-disable-line react-hooks/exhaustive-deps
      minWeight, topK, colorKeyOverride, fanOutDepth, selectedNodeIds, hideIsolated]);

  // Always load available kinds for the selected repo
  const kindsQuery = useQuery({
    queryKey: ["explore-kinds", repoId],
    queryFn:  () => api.exploreKinds(repoId),
  });
  const availableKinds = kindsQuery.data?.kinds || [];

  // Always load distinct dim values for filter chips (independent of Group By)
  const dimValuesQuery = useQuery({
    queryKey: ["explore-dim-values", repoId],
    queryFn:  () => api.exploreDimValues(repoId),
    staleTime: 5 * 60 * 1000, // cache 5 min — these don't change often
  });
  const serverDimValues = dimValuesQuery.data?.dims || {};

  // When no dims selected, fall back to symbol grain (one row per node)
  const effectiveDims = dims.length === 0 ? ["symbol"] : dims;
  // symbolMode: zero-dim fallback OR explicit single symbol dim — both use the grain path
  const symbolMode    = effectiveDims.length === 1 && effectiveDims[0] === "symbol";

  const measuresStr = measures.map(measureStr).join(",");
  const kindsStr    = kinds.join(",");

  const pivotQuery = useQuery({
    queryKey: ["explore", repoId, effectiveDims.join(","), measuresStr, kindsStr],
    queryFn:  () => api.explorePivot(repoId, effectiveDims, measuresStr, kindsStr),
    enabled:  (renderer==="pivot"||renderer==="graph") && measures.length>0,
  });

  const hasEnriched = pivotQuery.data?.has_enriched ?? false;

  const allDims       = ["module", "risk", "kind", "symbol", "dead", "high_risk", "in_cycle", "community"];
  const availableDims = allDims.filter(d => !dims.includes(d));

  // Distinct dimension values for filter chips.
  // Priority: server-fetched (all dims always available) → locally extracted from current pivot rows.
  const dimValues = useMemo(() => {
    // Start from server-fetched values so filters work regardless of current Group By
    const out = { ...serverDimValues };

    // Supplement with locally-extracted values from the current pivot result.
    // This picks up bucketed dim values (which the server endpoint doesn't cover)
    // and refreshes counts when a kind filter is active.
    const rows = pivotQuery.data?.rows;
    if (rows) {
      // Flatten top-level rows + children so 2-dim pivots expose both levels
      const allRows = rows.flatMap(r => [r, ...(r.children || [])]);
      for (const d of [...allDims, ...dims]) {
        const localVals = [...new Set(allRows.map(r => String(r.key[d] ?? "")))].filter(Boolean);
        if (localVals.length > 0) {
          out[d] = [...new Set([...(out[d] || []), ...localVals])].sort();
        }
      }
    }
    return out;
  }, [serverDimValues, pivotQuery.data, dims]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply client-side filters on top of pivot results
  const filteredData = useMemo(() => {
    if (!pivotQuery.data) return null;
    if (!filters.length)  return pivotQuery.data;
    return { ...pivotQuery.data, rows: applyFilters(pivotQuery.data.rows, filters) };
  }, [pivotQuery.data, filters]);

  // Keep GraphRenderer mounted through loading cycles so local selection state
  // (selectedNodeIds) survives measure/kind changes that temporarily null filteredData.
  const lastFilteredDataRef = useRef(null);
  if (filteredData) lastFilteredDataRef.current = filteredData;
  const stableFilteredData = lastFilteredDataRef.current; // non-null after first successful fetch

  function addMeasure(m) {
    if (m.special && measures.find(x => x.special === m.special)) return; // no duplicate specials
    setMeasures(p => [...p, m]);
  }
  function removeMeasure(key) { setMeasures(p => p.filter(m => measureKey(m) !== key)); }
  function changeAgg(key, agg) {
    setMeasures(p => p.map(m => measureKey(m)===key ? {...m, agg} : m));
  }

  // Replace a bucketed dim in-place with the same field but a new mode
  function changeDimMode(oldDim, newDim) {
    setDims(p => p.map(d => d === oldDim ? newDim : d));
  }

  return (
    <div>
      <div className="page-header">
        <h1>📐 Explore</h1>
        <p>Group, filter by kind, pick measures with any aggregation — or browse raw nodes and their edges.</p>
      </div>

      {/* ── Config row: Query Builder + Node Details ──────────────────────── */}
      <div style={{ display:"flex", gap:16, alignItems:"flex-start", marginBottom:20 }}>
      <div className="card" style={{ padding:"16px 20px", flex:1 }}>

        {/* View */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>View</span>
          {[{key:"pivot",label:"📊 Pivot"},{key:"graph",label:"🕸 Graph"},{key:"nodes",label:"🔬 Nodes"}].map(({key,label})=>(
            <button key={key} className={`btn btn-sm ${renderer===key?"":"btn-ghost"}`} onClick={()=>setRenderer(key)}>{label}</button>
          ))}
        </div>

        {/* Group By */}
        {renderer!=="nodes" && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Group by</span>
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDimDragEnd}>
              <SortableContext items={dims} strategy={horizontalListSortingStrategy}>
                {dims.map((d,i) => (
                  <SortableDimChip
                    key={d} id={d} label={d} index={i}
                    onRemove={() => setDims(p => p.filter(x => x !== d))}
                    onChangeMode={newDim => changeDimMode(d, newDim)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <AddDimMenu available={availableDims} onAdd={d=>setDims(p=>[...p,d])}/>
            {symbolMode && (
              <span style={{ fontSize:11, color:"var(--text3)", fontStyle:"italic", marginLeft:4 }}>
                No grouping → showing individual symbols
              </span>
            )}
          </div>
        )}

        {/* Kind filter — always shows, all active by default */}
        <div style={{ marginBottom:12 }}>
          {availableKinds.length > 0
            ? <KindFilter availableKinds={availableKinds} kinds={kinds} onChange={setKinds}/>
            : <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Kind filter</span>
                <span style={{ fontSize:11, color:"var(--text3)" }}>{kindsQuery.isLoading ? "loading…" : "no kinds found"}</span>
              </div>
          }
        </div>

        {/* Measures */}
        {renderer!=="nodes" && (
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, flexWrap:"wrap", marginBottom:12 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80, paddingTop:5 }}>Measures</span>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleMeasureDragEnd}>
                <SortableContext items={measures.map(measureKey)} strategy={horizontalListSortingStrategy}>
                  {measures.map(m => (
                    <SortableMeasureChip
                      key={measureKey(m)}
                      id={measureKey(m)}
                      m={m}
                      onRemove={() => removeMeasure(measureKey(m))}
                      onChangeAgg={agg => changeAgg(measureKey(m), agg)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <AddMeasureMenu onAdd={addMeasure} hasEnriched={hasEnriched}/>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display:"flex", alignItems:"flex-start", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80, paddingTop:5 }}>Filters</span>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
            {filters.map(f => (
              <FilterChip
                key={f.id}
                filter={f}
                availableValues={f.kind === "dim" ? (dimValues[f.field] || []) : []}
                onUpdate={updated => setFilters(p => p.map(x => x.id === f.id ? updated : x))}
                onRemove={() => setFilters(p => p.filter(x => x.id !== f.id))}
              />
            ))}
            <AddFilterMenu
              dims={allDims}
              measures={renderer !== "nodes" ? measures : []}
              onAdd={f => setFilters(p => [...p, f])}
            />
          </div>
        </div>
      </div>{/* end query builder card */}

      {/* Node details panel — visible in graph mode */}
      {renderer === "graph" && (
        <GraphNodeDetails
          node={selectedNode}
          measures={measures}
          types={(renderer === "graph" ? stableFilteredData : filteredData)?.measure_types || {}}
        />
      )}
      </div>{/* end config row */}

      {/* ── Results ───────────────────────────────────────────────────────── */}

      {(renderer==="pivot"||renderer==="graph") && (
        <>
          {measures.length===0 && <div style={{ padding:"40px 0", textAlign:"center", color:"var(--text3)" }}>Select at least one measure.</div>}
          {measures.length>0 && (
            <>
              {pivotQuery.isLoading && <div className="loading">Computing…</div>}
              {pivotQuery.error    && <div className="error">{pivotQuery.error.message}</div>}
              {filteredData && renderer==="pivot" && (
                <>
                  <div style={{ fontSize:12, color:"var(--text2)", marginBottom:10 }}>
                    {symbolMode
                      ? <>
                          {filteredData.rows.length}{pivotQuery.data.symbol_total > filteredData.rows.length && ` of ${pivotQuery.data.symbol_total}`} symbols
                          {pivotQuery.data.symbol_total > 500 && <span style={{ color:"var(--text3)", marginLeft:4 }}>(top {filteredData.rows.length} by caller count)</span>}
                        </>
                      : <>
                          {filteredData.rows.length}{pivotQuery.data.rows.length !== filteredData.rows.length && ` of ${pivotQuery.data.rows.length}`} groups
                          {effectiveDims.length>1&&` · click ▶ to drill into ${effectiveDims[1]}`}
                        </>
                    }
                    {kinds.length>0&&<span style={{ marginLeft:6 }}>· kind: {kinds.join(", ")}</span>}
                    {filters.length>0&&<span style={{ color:"var(--blue)", marginLeft:6 }}>· {filters.length} filter{filters.length>1?"s":""} active</span>}
                  </div>
                  <PivotTable data={filteredData} measures={measures}/>
                </>
              )}
              {renderer==="graph" && stableFilteredData && (
                <GraphRenderer
                  data={stableFilteredData} measures={measures} onNodeClick={setSelectedNode}
                  minWeight={minWeight}               setMinWeight={setMinWeight}
                  topK={topK}                         setTopK={setTopK}
                  colorKeyOverride={colorKeyOverride} setColorKeyOverride={setColorKeyOverride}
                  fanOutDepth={fanOutDepth}           setFanOutDepth={setFanOutDepth}
                  selectedNodeIds={selectedNodeIds}   setSelectedNodeIds={setSelectedNodeIds}
                  hideIsolated={hideIsolated}         setHideIsolated={setHideIsolated}
                />
              )}
            </>
          )}
        </>
      )}

      {renderer==="nodes" && (
        <NodeTable repoId={repoId} hasEnriched={hasEnriched} kinds={kinds}/>
      )}
    </div>
  );
}
