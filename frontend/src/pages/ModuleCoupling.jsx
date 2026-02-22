import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

function InstabilityBar({ value }) {
  const color = value > 0.7 ? "var(--red)" : value > 0.4 ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="bar-bg" style={{ width: 80, maxWidth: 80 }}>
        <div className="bar-fill" style={{ width: `${value * 100}%`, background: color }} />
      </div>
      <span style={{ color, fontWeight: 600 }}>{value.toFixed(2)}</span>
    </div>
  );
}

export default function ModuleCoupling() {
  const { repoId } = useContext(RepoContext);
  const [sort, setSort] = useState("afferent_coupling");
  const [selected, setSelected] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["modules", repoId],
    queryFn: () => api.modules(repoId),
  });

  const { data: edgeData } = useQuery({
    queryKey: ["module-edges", repoId],
    queryFn: () => api.moduleEdges(repoId),
  });

  if (isLoading) return <div className="loading">Loading module metrics…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const modules = [...(data?.modules || [])].sort((a, b) => b[sort] - a[sort]);

  // Build heatmap: top modules by total coupling
  const topModules = modules.slice(0, 12).map((m) => m.module);
  const edgeMap = {};
  for (const e of edgeData?.edges || []) {
    const key = `${e.caller_module}__${e.callee_module}`;
    edgeMap[key] = (edgeMap[key] || 0) + e.edge_count;
  }
  const maxEdge = Math.max(1, ...Object.values(edgeMap));

  function cellColor(count) {
    if (!count) return "var(--bg)";
    const ratio = count / maxEdge;
    if (ratio > 0.6) return "var(--red-bg)";
    if (ratio > 0.3) return "var(--yellow-bg)";
    if (ratio > 0) return "var(--green-bg)";
    return "var(--bg)";
  }
  function cellTextColor(count) {
    if (!count) return "transparent";
    const ratio = count / maxEdge;
    if (ratio > 0.6) return "var(--red)";
    if (ratio > 0.3) return "var(--yellow)";
    return "var(--green)";
  }

  return (
    <div>
      <div className="page-header">
        <h1>🧩 Module Coupling & Cohesion</h1>
        <p>Afferent/efferent coupling and instability scores per module. High instability = depends on many things, few things depend on it.</p>
      </div>

      {/* Insights */}
      {modules.slice(0, 3).filter((m) => m.afferent_coupling > 20 || m.instability > 0.7).map((m) => (
        <div key={m.module} style={{ background: "var(--yellow-bg)", border: "1px solid var(--yellow)", borderRadius: 8, padding: "12px 16px", marginBottom: 12, fontSize: 13, display: "flex", gap: 10 }}>
          <span>⚠️</span>
          <span>
            <strong>{m.module}</strong>{" "}
            {m.afferent_coupling > 20 ? `has ${m.afferent_coupling} afferent couplings — heavily depended upon.` : ""}
            {m.instability > 0.7 ? ` Instability score ${m.instability.toFixed(2)} — depends on many modules.` : ""}
          </span>
        </div>
      ))}

      {/* Sort controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text2)" }}>Sort by:</span>
        {["afferent_coupling", "efferent_coupling", "instability", "symbol_count"].map((k) => (
          <button
            key={k}
            className={`btn btn-sm ${sort === k ? "" : "btn-ghost"}`}
            onClick={() => setSort(k)}
          >
            {k.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Metrics table */}
      <div className="card" style={{ overflow: "hidden", marginBottom: 28 }}>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th title="How many other modules call into this one">Ca (afferent)</th>
              <th title="How many other modules this one calls">Ce (efferent)</th>
              <th title="Ce / (Ca + Ce) — 0 = stable, 1 = unstable">Instability</th>
              <th>Symbols</th>
              <th>Avg Complexity</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr
                key={m.module}
                style={{ cursor: "pointer" }}
                onClick={() => setSelected(selected === m.module ? null : m.module)}
              >
                <td>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{m.module}</span>
                  {m.afferent_coupling > 15 && m.instability < 0.3 && (
                    <span className="badge badge-purple" style={{ marginLeft: 8 }}>stable core</span>
                  )}
                  {m.instability > 0.8 && (
                    <span className="badge badge-red" style={{ marginLeft: 8 }}>unstable</span>
                  )}
                  {m.afferent_coupling > 10 && m.instability > 0.3 && (
                    <span className="badge badge-yellow" style={{ marginLeft: 8 }}>watch</span>
                  )}
                </td>
                <td style={{ color: m.afferent_coupling > 15 ? "var(--blue)" : "var(--text)" }}>{m.afferent_coupling}</td>
                <td style={{ color: m.efferent_coupling > 15 ? "var(--yellow)" : "var(--text)" }}>{m.efferent_coupling}</td>
                <td><InstabilityBar value={m.instability} /></td>
                <td>{m.symbol_count}</td>
                <td style={{ color: m.avg_complexity > 5 ? "var(--red)" : "var(--text2)" }}>{m.avg_complexity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dependency heatmap */}
      {edgeData?.edges?.length > 0 && (
        <div className="section">
          <div className="section-title">Cross-Module Dependency Matrix <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 400 }}>— cell = number of call edges</span></div>
          <div style={{ overflowX: "auto" }}>
            <div className="card" style={{ padding: 16, display: "inline-block", minWidth: "100%" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th style={{ background: "none", fontSize: 10, minWidth: 80 }}>from ↓ to →</th>
                    {topModules.map((m) => (
                      <th key={m} style={{
                        background: "var(--bg3)", fontSize: 10, maxWidth: 80, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 60, writingMode: "vertical-rl",
                        textOrientation: "mixed", height: 80, verticalAlign: "bottom", paddingBottom: 6
                      }} title={m}>{m.split(".").pop()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topModules.map((rowMod) => (
                    <tr key={rowMod}>
                      <th style={{ background: "var(--bg3)", fontSize: 10, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", paddingRight: 8 }} title={rowMod}>{rowMod.split(".").pop()}</th>
                      {topModules.map((colMod) => {
                        const count = rowMod === colMod ? null : edgeMap[`${rowMod}__${colMod}`] || 0;
                        return (
                          <td key={colMod} style={{
                            background: rowMod === colMod ? "var(--bg3)" : cellColor(count),
                            color: cellTextColor(count),
                            textAlign: "center",
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 4,
                            minWidth: 44,
                            height: 36,
                          }}
                            title={`${rowMod} → ${colMod}: ${count || 0} edges`}
                          >
                            {rowMod === colMod ? "—" : count || ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "var(--text2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "var(--red-bg)", border: "1px solid var(--red)" }} /> High coupling</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "var(--yellow-bg)", border: "1px solid var(--yellow)" }} /> Medium</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: "var(--green-bg)", border: "1px solid var(--green)" }} /> Low</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
