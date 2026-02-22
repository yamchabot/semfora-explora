import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

export default function Cycles() {
  const { repoId } = useContext(RepoContext);
  const [expanded, setExpanded] = useState({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["cycles", repoId],
    queryFn: () => api.cycles(repoId),
  });

  if (isLoading) return <div className="loading">Detecting strongly connected components…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const cycles = data?.cycles || [];
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));

  return (
    <div>
      <div className="page-header">
        <h1>🔄 Dependency Cycles</h1>
        <p>
          Strongly connected components — groups of symbols that call each other in a cycle.
          Cycles create tight coupling and make refactoring risky.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{data?.total_cycles || 0}</div>
          <div className="stat-label">Cycles detected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--yellow)" }}>
            {cycles.reduce((s, c) => s + c.size, 0)}
          </div>
          <div className="stat-label">Symbols in cycles</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--blue)" }}>
            {cycles.filter((c) => c.size > 5).length}
          </div>
          <div className="stat-label">Large cycles (5+ nodes)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>
            {cycles.filter((c) => c.cross_module).length}
          </div>
          <div className="stat-label">Cross-module (high risk)</div>
        </div>
      </div>

      {cycles.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No cycles detected</div>
          <div style={{ color: "var(--text2)", fontSize: 13 }}>The call graph is a DAG — no strongly connected components with 2+ nodes.</div>
        </div>
      )}

      {cycles.map((cycle, i) => {
        const severity = cycle.size > 10 ? "var(--red)" : cycle.size > 4 ? "var(--yellow)" : "var(--blue)";
        const modules = [...new Set(cycle.nodes.map((n) => n.module).filter(Boolean))];
        return (
          <div key={i} className="card" style={{ marginBottom: 10, overflow: "hidden", borderColor: severity + "44" }}>
            <div
              style={{
                padding: "12px 16px",
                background: "var(--bg3)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                borderBottom: expanded[i] ? "1px solid var(--border)" : "none",
              }}
              onClick={() => toggle(i)}
            >
              <span style={{ fontSize: 12, color: "var(--text2)" }}>{expanded[i] ? "▾" : "▸"}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>Cycle #{i + 1}</span>
                {cycle.cross_module && (
                  <span style={{ background: "var(--red-bg)", color: "var(--red)", fontSize: 10,
                    fontWeight: 700, padding: "1px 6px", borderRadius: 8, marginLeft: 8 }}>
                    cross-module
                  </span>
                )}
                <span style={{ color: "var(--text2)", fontSize: 12, marginLeft: 8 }}>
                  {modules.join(" ↔ ")}
                </span>
              </div>
              <span style={{
                background: severity + "22", color: severity,
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12
              }}>
                {cycle.size} symbols
              </span>
            </div>

            {expanded[i] && (
              <div>
                {/* Break suggestion */}
                {cycle.break_suggestion && (
                  <div style={{ padding: "12px 16px", background: "var(--blue-bg)",
                    borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: "var(--blue)", marginBottom: 6 }}>
                      ✂ Suggested break point
                    </div>
                    <div style={{ color: "var(--text2)", lineHeight: 1.7 }}>
                      Cut the call from{" "}
                      <code style={{ background: "var(--bg3)", padding: "1px 5px", borderRadius: 3 }}>
                        {cycle.break_suggestion.caller_name}
                      </code>
                      {" → "}
                      <code style={{ background: "var(--bg3)", padding: "1px 5px", borderRadius: 3 }}>
                        {cycle.break_suggestion.callee_name}
                      </code>
                      {" "}(call count: {cycle.break_suggestion.call_count}).
                      This is the lowest-traffic edge in the cycle — least disruptive to remove.
                    </div>
                    {cycle.break_suggestion.caller_module !== cycle.break_suggestion.callee_module && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text3)" }}>
                        {cycle.break_suggestion.caller_module} → {cycle.break_suggestion.callee_module}
                      </div>
                    )}
                  </div>
                )}
                {cycle.nodes.map((node) => (
                  <div
                    key={node.hash}
                    style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, fontSize: 12 }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{node.name}</span>
                      <div style={{ color: "var(--text3)", fontSize: 11 }}>{node.module} · {node.file_path}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
