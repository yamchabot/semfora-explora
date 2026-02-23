import { useState, useRef } from "react";
import { measureKey, measureLabel, fmtValue } from "../../utils/measureUtils.js";

function fmt(value, type) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  return fmtValue(value, type);
}

export function GraphNodeDetails({ node, measures, types }) {
  const [pinned, setPinned] = useState(null);
  const lastRef             = useRef(null);

  // Keep the last non-null node visible so the panel doesn't blank on mouse-out
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
                <span style={{ fontWeight:600, color: t === "ratio" ? (v > 0.5 ? "var(--red)" : v > 0.25 ? "var(--yellow)" : "var(--green)") : "var(--text)" }}>
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
