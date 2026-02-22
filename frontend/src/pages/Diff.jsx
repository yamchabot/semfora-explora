import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function Diff() {
  const [repoA, setRepoA] = useState("semfora-engine");
  const [repoB, setRepoB] = useState("adk-playground");
  const [submitted, setSubmitted] = useState(false);

  const { data: reposData } = useQuery({ queryKey: ["repos"], queryFn: api.repos });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["diff", repoA, repoB],
    queryFn: () => api.diff(repoA, repoB),
    enabled: submitted,
  });

  const repos = reposData?.repos || [];

  function handleCompare() {
    setSubmitted(true);
    refetch();
  }

  return (
    <div>
      <div className="page-header">
        <h1>🔀 Call Graph Diff</h1>
        <p>
          Compare two indexed repos structurally. See which symbols were added, removed, and which
          module-level dependencies changed — not just line diffs.
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: 16, marginBottom: 24, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>BASE</label>
          <select value={repoA} onChange={(e) => setRepoA(e.target.value)}>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div style={{ color: "var(--text2)", fontSize: 18 }}>→</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>COMPARE</label>
          <select value={repoB} onChange={(e) => setRepoB(e.target.value)}>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <button className="btn" onClick={handleCompare}>Compare</button>
      </div>

      {isLoading && <div className="loading">Computing structural diff…</div>}
      {error && <div className="error">{error.message}</div>}

      {data && (
        <>
          {/* Summary stats */}
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--blue)" }}>
                {(data.similarity * 100).toFixed(1)}%
              </div>
              <div className="stat-label">Structural similarity</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--green)" }}>+{data.nodes_added}</div>
              <div className="stat-label">Symbols added</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--red)" }}>-{data.nodes_removed}</div>
              <div className="stat-label">Symbols removed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--text2)" }}>{data.nodes_common}</div>
              <div className="stat-label">Symbols in common</div>
            </div>
          </div>

          <div className="two-col">
            {/* Symbol changes */}
            <div>
              {data.added.length > 0 && (
                <div className="section">
                  <div className="section-title" style={{ color: "var(--green)" }}>
                    ✦ Added in {repoB} ({data.nodes_added})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.added.slice(0, 30).map((n, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, fontSize: 12 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--green)" }}>{n.name}</span>
                          <div style={{ color: "var(--text3)", fontSize: 11 }}>{n.module} · {n.file_path}</div>
                        </div>
                        <span style={{ background: "var(--bg3)", color: "var(--text2)", fontSize: 10, padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>{n.kind}</span>
                      </div>
                    ))}
                    {data.nodes_added > 30 && (
                      <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                        + {data.nodes_added - 30} more…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {data.removed.length > 0 && (
                <div className="section">
                  <div className="section-title" style={{ color: "var(--red)" }}>
                    ✕ Removed from {repoA} ({data.nodes_removed})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.removed.slice(0, 30).map((n, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, fontSize: 12 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--red)", textDecoration: "line-through" }}>{n.name}</span>
                          <div style={{ color: "var(--text3)", fontSize: 11 }}>{n.module} · {n.file_path}</div>
                        </div>
                        <span style={{ background: "var(--bg3)", color: "var(--text2)", fontSize: 10, padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>{n.kind}</span>
                      </div>
                    ))}
                    {data.nodes_removed > 30 && (
                      <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                        + {data.nodes_removed - 30} more…
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Module edge changes */}
            <div>
              {data.module_edges_added.length > 0 && (
                <div className="section">
                  <div className="section-title" style={{ color: "var(--green)" }}>New Module Dependencies</div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.module_edges_added.map((e, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{e.from}</span>
                        <span style={{ color: "var(--green)" }}>→</span>
                        <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{e.to}</span>
                        <span style={{ marginLeft: "auto", color: "var(--green)", fontWeight: 700 }}>+{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.module_edges_removed.length > 0 && (
                <div className="section">
                  <div className="section-title" style={{ color: "var(--red)" }}>Removed Module Dependencies</div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.module_edges_removed.map((e, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontFamily: "monospace", color: "var(--text2)", textDecoration: "line-through" }}>{e.from}</span>
                        <span style={{ color: "var(--red)" }}>→</span>
                        <span style={{ fontFamily: "monospace", color: "var(--text2)", textDecoration: "line-through" }}>{e.to}</span>
                        <span style={{ marginLeft: "auto", color: "var(--red)", fontWeight: 700 }}>-{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Summary</div>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.8 }}>
                  <div><strong style={{ color: "var(--text)" }}>{repoA}</strong> — {repos.find(r => r.id === repoA)?.node_count?.toLocaleString()} symbols</div>
                  <div><strong style={{ color: "var(--text)" }}>{repoB}</strong> — {repos.find(r => r.id === repoB)?.node_count?.toLocaleString()} symbols</div>
                  <div style={{ marginTop: 8 }}>
                    These repos share <strong style={{ color: "var(--blue)" }}>{data.nodes_common}</strong> symbols by name+module.
                    Structural similarity: <strong style={{ color: data.similarity > 0.7 ? "var(--green)" : data.similarity > 0.3 ? "var(--yellow)" : "var(--red)" }}>
                      {(data.similarity * 100).toFixed(1)}%
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!submitted && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
          Select two indexed repos above and click Compare to see the structural diff.
        </div>
      )}
    </div>
  );
}
