import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";
import { RISK_BG, RISK_COLOR } from "../../utils/exploreConstants.js";

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

// ── NodeTable ──────────────────────────────────────────────────────────────────

export function NodeTable({ repoId, hasEnriched, kinds }) {
  const [sortBy,  setSortBy]  = useState("caller_count");
  const [sortDir, setSortDir] = useState("desc");
  const kindsStr = kinds.join(",");

  const { data, isLoading } = useQuery({
    queryKey: ["explore-nodes", repoId, sortBy, sortDir, kindsStr],
    queryFn:  () => api.exploreNodes(repoId, sortBy, sortDir, 200, kindsStr),
  });

  function toggleSort(key) {
    if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
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
        {label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
      </th>
    );
  }

  return (
    <>
      {data?.truncated && (
        <div style={{ background:"var(--yellow-bg,#fffbe6)", border:"1px solid var(--yellow,#f5a623)", borderRadius:6, padding:"6px 12px", marginBottom:8, fontSize:12, color:"var(--text1)" }}>
          ⚠️ Showing top {nodes.length} of <strong>{(data.total_count ?? total).toLocaleString()}</strong> nodes (sorted by {sortBy.replace("_", " ")}). Use Kind filter or add more dims to narrow the set.
        </div>
      )}
      <div style={{ fontSize:12, color:"var(--text2)", marginBottom:10 }}>
        Showing {nodes.length} of {(data?.total_count ?? total).toLocaleString()} nodes
        {kinds.length > 0 && <span style={{ marginLeft:8, color:"var(--blue)" }}>({kinds.join(", ")} only)</span>}
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
                <td>
                  {node.risk && (
                    <span style={{
                      fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10,
                      background: RISK_BG[node.risk]  || "var(--bg3)",
                      color:      RISK_COLOR[node.risk] || "var(--text2)",
                    }}>{node.risk}</span>
                  )}
                </td>
                <td style={{ textAlign:"right", fontWeight: node.caller_count > 10 ? 700 : 400, color: node.caller_count > 10 ? "var(--yellow)" : "var(--text)" }}>{node.caller_count}</td>
                <td style={{ textAlign:"right", color:"var(--text2)" }}>{node.callee_count}</td>
                <td style={{ textAlign:"right", color: node.complexity > 5 ? "var(--red)" : "var(--text2)" }}>{node.complexity}</td>
                {hasEnriched && <td style={{ textAlign:"right", color:"var(--text2)" }}>{node.utility_score != null ? node.utility_score.toFixed(3) : "—"}</td>}
                {hasEnriched && <td style={{ textAlign:"right", color:"var(--text2)" }}>{node.pagerank != null ? node.pagerank.toFixed(4) : "—"}</td>}
                <td><EdgePillbox edges={node.outbound_edges} nodeModule={node.module} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
