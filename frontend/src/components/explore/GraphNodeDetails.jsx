import { useState, useRef } from "react";
import { measureKey, measureLabel, fmtValue } from "../../utils/measureUtils.js";

function fmt(value, type) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  return fmtValue(value, type);
}

/**
 * Build the ancestor dim→value pairs for a graph node.
 *
 * Leaf dim is shown as the node name heading (not repeated in the table).
 * Only ancestor dims (groupPath entries) are returned here.
 *
 * dims[0..N-2] → groupPath[0..N-2]   ← returned by this function
 * dims[N-1]    → node.id              ← shown as the name heading
 *
 * For 1-dim mode (no ancestors), returns [] but also returns the leaf dim
 * label so the caller can show it as a badge next to the name.
 */
function buildAncestorEntries(node, dims) {
  if (!node || !dims?.length) return { ancestors: [], leafDim: null };

  const N       = dims.length;
  const leafDim = dims[N - 1];
  const ancestors = [];

  for (let i = 0; i < N - 1; i++) {
    ancestors.push({ dim: dims[i], value: node.groupPath?.[i] ?? null });
  }

  return { ancestors, leafDim };
}

export function GraphNodeDetails({ node, measures, types, dims }) {
  const lastRef = useRef(null);

  // Keep the last non-null node so the panel doesn't blank on mouse-out
  const display = node || lastRef.current;
  if (node) lastRef.current = node;

  const { ancestors, leafDim } = buildAncestorEntries(display, dims);

  // Display name: leaf dim value.  Strip any ancestor prefix from compound ids.
  const rawName  = display?.id ?? display?.name ?? "";
  const leafName = rawName.includes("::") ? rawName.split("::").pop() : rawName;

  return (
    <div className="card" style={{ width:220, flexShrink:0, padding:"14px 16px", minHeight:180 }}>
      {display ? (
        <>
          {/* ── Node name + leaf dim badge ────────────────────────────────── */}
          <div style={{ marginBottom: ancestors.length ? 10 : 8 }}>
            <div style={{
              fontFamily:"monospace", fontWeight:700, fontSize:13,
              color:"var(--text)", wordBreak:"break-all",
            }}>
              {leafName}
            </div>
            {/* Leaf dim label — tells you what kind of thing this node is */}
            {leafDim && (
              <div style={{ fontSize:10, color:"var(--text3)", marginTop:3 }}>
                {leafDim}
              </div>
            )}
            {/* Fall back to old group/module display when no dims prop provided */}
            {!leafDim && (() => {
              const full  = display.name ?? "";
              const [mod, ...rest] = full.split("::");
              return rest.length > 0
                ? <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--text3)", marginTop:2 }}>{mod}</div>
                : display.group
                  ? <div style={{ fontSize:10, color:"var(--blue)", marginTop:2 }}>{display.group}</div>
                  : null;
            })()}
          </div>

          {/* ── Ancestor dimension values ─────────────────────────────────── */}
          {ancestors.length > 0 && (
            <div style={{ marginBottom:10 }}>
              {ancestors.map(({ dim, value }) => (
                <div key={dim} style={{
                  display:"flex", alignItems:"baseline",
                  gap:6, marginBottom:4,
                }}>
                  <span style={{
                    fontSize:10, color:"var(--text3)",
                    fontFamily:"monospace", flexShrink:0, minWidth:52,
                  }}>
                    {dim}
                  </span>
                  <span style={{
                    fontSize:11, color: value ? "var(--text2)" : "var(--text3)",
                    fontFamily:"monospace", wordBreak:"break-all",
                  }}>
                    {value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Measures ─────────────────────────────────────────────────── */}
          {measures.length > 0 && (
            <>
              <div style={{ borderTop:"1px solid var(--border)", marginBottom:8 }}/>
              {measures.map(m => {
                const k = measureKey(m);
                const v = display.values?.[k];
                const t = types?.[k];
                return (
                  <div key={k} style={{
                    display:"flex", justifyContent:"space-between", alignItems:"baseline",
                    marginBottom:7, fontSize:12, gap:8,
                  }}>
                    <span style={{ color:"var(--text3)", flexShrink:0 }}>
                      {measureLabel(m)}
                      {!m.special && <span style={{ fontSize:10, marginLeft:3 }}>{m.agg}</span>}
                    </span>
                    <span style={{
                      fontWeight:600,
                      color: t === "ratio"
                        ? (v > 0.5 ? "var(--red)" : v > 0.25 ? "var(--yellow)" : "var(--green)")
                        : "var(--text)",
                    }}>
                      {fmt(v, t)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </>
      ) : (
        <div style={{ color:"var(--text3)", fontSize:12, textAlign:"center", paddingTop:30 }}>
          Click a node<br/>to see details
        </div>
      )}
    </div>
  );
}
