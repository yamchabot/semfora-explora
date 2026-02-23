import { useState, useRef, useEffect } from "react";
import { measureKey, measureLabel } from "../../utils/measureUtils.js";

function newId() { return Math.random().toString(36).slice(2, 9); }

// ── DimFilterEditor ────────────────────────────────────────────────────────────

export function DimFilterEditor({ filter, availableValues, onUpdate }) {
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

// ── MeasureFilterEditor ────────────────────────────────────────────────────────

export function MeasureFilterEditor({ filter, onUpdate }) {
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

// ── FilterChip ─────────────────────────────────────────────────────────────────

export function FilterChip({ filter, availableValues, onUpdate, onRemove }) {
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

// ── AddFilterMenu ──────────────────────────────────────────────────────────────

export function AddFilterMenu({ dims, measures, onAdd }) {
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
