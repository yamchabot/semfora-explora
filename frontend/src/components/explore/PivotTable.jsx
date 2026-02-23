import { useState } from "react";
import { measureKey, measureLabel, fmtValue } from "../../utils/measureUtils.js";
import { RatioCell } from "./MeasureControls.jsx";

/** JSX-aware null formatter — returns a styled dash for null values. */
function fmt(value, type) {
  if (value == null) return <span style={{ color:"var(--text3)" }}>—</span>;
  return fmtValue(value, type);
}

/**
 * Recursive row renderer.  Handles 1..N levels of nesting by calling itself
 * for each expanded row's children.
 *
 * @param {object[]} rows          - rows at this level
 * @param {string[]} dims          - all dimension keys, in order
 * @param {object[]} measures      - active measure objects
 * @param {object}   types         - { measureCol → type }
 * @param {number}   depth         - current nesting depth (0 = root)
 * @param {Set}      collapsed     - set of JSON.stringify(key) for collapsed rows
 * @param {Function} toggle        - toggle(ks) — flip collapsed state
 */
function renderRows(rows, dims, measures, types, depth, collapsed, toggle) {
  const dimKey    = dims[depth] ?? "group";
  const indent    = depth * 20;           // px indent per level
  const bgVar     = depth === 0 ? undefined : `var(--bg${Math.min(depth + 2, 4)})`;
  const result    = [];

  for (const row of rows) {
    const ks      = JSON.stringify(row.key);
    const hasKids = row.children?.length > 0;
    const isExp   = hasKids && !collapsed.has(ks);
    const cellVal = row.key[dimKey];

    result.push(
      <tr
        key={ks}
        style={{ cursor: hasKids ? "pointer" : "default", background: bgVar }}
        onClick={() => hasKids && toggle(ks)}
      >
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: indent }}>
            <span style={{ width: 16, flexShrink: 0, color: "var(--text3)", fontSize: 12 }}>
              {hasKids ? (isExp ? "▼" : "▶") : <span style={{ width: 16, display: "inline-block" }} />}
            </span>
            {/* Symbol grain: split "module::name" for readable display */}
            {dimKey === "symbol" && cellVal ? (() => {
              const [mod, ...rest] = cellVal.split("::");
              const name = rest.join("::");
              return (
                <>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{name}</span>
                  <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "monospace" }}>· {mod}</span>
                </>
              );
            })() : (
              <span style={{ fontFamily: "monospace", fontSize: 12, color: depth > 0 ? "var(--text2)" : undefined }}>
                {cellVal ?? "—"}
              </span>
            )}
          </div>
        </td>
        {measures.map(m => {
          const k = measureKey(m);
          return (
            <td key={k} style={{ textAlign: "right" }}>
              {types[k] === "ratio"
                ? <RatioCell value={row.values?.[k]} />
                : <span style={{ fontSize: 12 }}>{fmt(row.values?.[k], types[k])}</span>}
            </td>
          );
        })}
      </tr>
    );

    // Recurse into children when expanded
    if (isExp && row.children?.length) {
      result.push(
        ...renderRows(row.children, dims, measures, types, depth + 1, collapsed, toggle)
      );
    }
  }

  return result;
}

export function PivotTable({ data, measures }) {
  const [collapsed, setCollapsed] = useState(new Set());

  const types = data.measure_types || {};
  const dims  = data.dimensions ?? ["group"];

  if (!data?.rows?.length) return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text3)" }}>No data.</div>
  );

  function toggle(k) {
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table>
        <thead>
          <tr>
            <th style={{ minWidth: 200 }}>
              {dims[0] === "symbol" ? "symbol · module" : dims.join(" › ")}
            </th>
            {measures.map(m => (
              <th key={measureKey(m)} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {measureLabel(m)}
                {!m.special && (
                  <span style={{ color: "var(--text3)", fontSize: 10, marginLeft: 3 }}>{m.agg}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderRows(data.rows, dims, measures, types, 0, collapsed, toggle)}
        </tbody>
      </table>
    </div>
  );
}
