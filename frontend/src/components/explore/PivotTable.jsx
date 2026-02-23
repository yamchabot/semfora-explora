import { useState } from "react";
import { measureKey, measureLabel, fmtValue } from "../../utils/measureUtils.js";
import { RatioCell } from "./MeasureControls.jsx";

/** JSX-aware null formatter — returns a styled dash for null values. */
function fmt(value, type) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  return fmtValue(value, type);
}

export function PivotTable({ data, measures }) {
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
            {measures.map(m => (
              <th key={measureKey(m)} style={{ textAlign:"right", whiteSpace:"nowrap" }}>
                {measureLabel(m)}
                {!m.special && <span style={{ color:"var(--text3)", fontSize:10, marginLeft:3 }}>{m.agg}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const pk         = row.key[dimKey];
            const ks         = JSON.stringify(row.key);
            const hasKids    = row.children?.length > 0;
            const isExpanded = hasKids && !collapsed.has(ks);
            return [
              <tr key={ks} style={{ cursor: hasKids ? "pointer" : "default" }} onClick={() => hasKids && toggle(ks)}>
                <td>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:16, flexShrink:0, color:"var(--text3)", fontSize:12 }}>{hasKids ? (isExpanded ? "▼" : "▶") : ""}</span>
                    {dimKey === "symbol" && pk ? (() => {
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
                  return (
                    <td key={k} style={{ textAlign:"right" }}>
                      {types[k] === "ratio"
                        ? <RatioCell value={row.values[k]} />
                        : <span style={{ fontSize:12 }}>{fmt(row.values[k], types[k])}</span>}
                    </td>
                  );
                })}
              </tr>,
              ...(isExpanded ? (row.children || []).map(child => {
                const cv = child.key[data.dimensions[1]];
                return (
                  <tr key={JSON.stringify(child.key)} style={{ background:"var(--bg3)" }}>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:16 }} />
                        <span style={{ width:14, color:"var(--text3)", fontSize:11 }}>└</span>
                        <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text2)" }}>{cv ?? "—"}</span>
                      </div>
                    </td>
                    {measures.map(m => {
                      const k = measureKey(m);
                      return (
                        <td key={k} style={{ textAlign:"right" }}>
                          {types[k] === "ratio"
                            ? <RatioCell value={child.values[k]} />
                            : <span style={{ fontSize:12, color:"var(--text2)" }}>{fmt(child.values[k], types[k])}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              }) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
