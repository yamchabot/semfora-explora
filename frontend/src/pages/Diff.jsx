import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

function groupRepos(repos) {
  const groups = {};
  for (const r of repos) {
    // "semfora-engine@abc1234" -> project "semfora-engine", commit "abc1234"
    const atIdx = r.id.indexOf("@");
    const project = atIdx === -1 ? r.id : r.id.slice(0, atIdx);
    const commit  = atIdx === -1 ? "HEAD" : r.id.slice(atIdx + 1);
    if (!groups[project]) groups[project] = [];
    groups[project].push({ ...r, project, commit });
  }
  return groups;
}

export default function Diff() {
  const { data: reposData } = useQuery({ queryKey: ["repos"], queryFn: api.repos });
  const repos = reposData?.repos || [];
  const groups = useMemo(() => groupRepos(repos), [repos]);
  const projects = Object.keys(groups).sort();

  const [repoA, setRepoA] = useState("");
  const [repoB, setRepoB] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Set sensible defaults once repos load
  useMemo(() => {
    if (repos.length && !repoA) {
      const first = projects[0];
      const versions = groups[first] || [];
      if (versions.length >= 2) {
        setRepoA(versions[0].id);
        setRepoB(versions[1].id);
      } else if (repos.length >= 2) {
        setRepoA(repos[0].id);
        setRepoB(repos[1].id);
      }
    }
  }, [repos]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["diff", repoA, repoB],
    queryFn: () => api.diff(repoA, repoB),
    enabled: submitted && !!repoA && !!repoB,
  });

  function handleCompare() {
    setSubmitted(true);
    refetch();
  }

  const repoMeta = (id) => repos.find((r) => r.id === id);

  return (
    <div>
      <div className="page-header">
        <h1>🔀 Call Graph Diff</h1>
        <p>
          Compare any two snapshots structurally — same project across commits, or different
          projects entirely. See which symbols and module dependencies changed.
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: 16, marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 12, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Base (older)</div>
            <select value={repoA} onChange={(e) => setRepoA(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select snapshot…</option>
              {projects.map((proj) => (
                <optgroup key={proj} label={proj}>
                  {groups[proj].map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.commit === "HEAD" ? "HEAD" : r.commit} — {r.node_count.toLocaleString()} nodes
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {repoA && repoMeta(repoA) && (
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
                {repoMeta(repoA).node_count.toLocaleString()} nodes · {repoMeta(repoA).edge_count.toLocaleString()} edges
              </div>
            )}
          </div>

          <div style={{ fontSize: 24, color: "var(--text2)", paddingBottom: 8 }}>→</div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", marginBottom: 6 }}>Compare (newer)</div>
            <select value={repoB} onChange={(e) => setRepoB(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select snapshot…</option>
              {projects.map((proj) => (
                <optgroup key={proj} label={proj}>
                  {groups[proj].map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.commit === "HEAD" ? "HEAD" : r.commit} — {r.node_count.toLocaleString()} nodes
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {repoB && repoMeta(repoB) && (
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
                {repoMeta(repoB).node_count.toLocaleString()} nodes · {repoMeta(repoB).edge_count.toLocaleString()} edges
              </div>
            )}
          </div>

          <div style={{ paddingBottom: 2 }}>
            <button className="btn" onClick={handleCompare} disabled={!repoA || !repoB || repoA === repoB}>
              Compare
            </button>
          </div>
        </div>

        {/* Quick-pick same-project pairs */}
        {projects.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 8 }}>Quick compare (adjacent commits):</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {projects.flatMap((proj) => {
                const vers = groups[proj];
                return vers.slice(0, -1).map((v, i) => ({
                  a: vers[i + 1].id,
                  b: v.id,
                  label: `${proj}: ${vers[i + 1].commit.slice(0, 7)} → ${v.commit.slice(0, 7)}`,
                }));
              }).slice(0, 6).map(({ a, b, label }) => (
                <button
                  key={label}
                  className="btn btn-ghost btn-sm"
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                  onClick={() => { setRepoA(a); setRepoB(b); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isLoading && <div className="loading">Computing structural diff…</div>}
      {error && <div className="error">{error.message}</div>}

      {data && (
        <>
          {/* Summary */}
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: data.similarity > 0.8 ? "var(--green)" : data.similarity > 0.5 ? "var(--yellow)" : "var(--red)" }}>
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
              <div className="stat-value" style={{ color: "var(--text2)" }}>{data.nodes_common.toLocaleString()}</div>
              <div className="stat-label">Symbols in common</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Added */}
            {data.added.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: "var(--green)", marginBottom: 10, fontSize: 14 }}>
                  ✦ Added ({data.nodes_added})
                </div>
                <div className="card" style={{ overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                  {data.added.map((n, i) => (
                    <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--green)" }}>{n.name}</span>
                      <span style={{ background: "var(--bg3)", color: "var(--text3)", fontSize: 10, padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>{n.kind}</span>
                      <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>{n.module}</div>
                    </div>
                  ))}
                  {data.nodes_added > data.added.length && (
                    <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                      + {data.nodes_added - data.added.length} more…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Removed */}
            {data.removed.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 10, fontSize: 14 }}>
                  ✕ Removed ({data.nodes_removed})
                </div>
                <div className="card" style={{ overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                  {data.removed.map((n, i) => (
                    <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--red)", textDecoration: "line-through" }}>{n.name}</span>
                      <span style={{ background: "var(--bg3)", color: "var(--text3)", fontSize: 10, padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>{n.kind}</span>
                      <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>{n.module}</div>
                    </div>
                  ))}
                  {data.nodes_removed > data.removed.length && (
                    <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                      + {data.nodes_removed - data.removed.length} more…
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Module edge changes */}
          {(data.module_edges_added.length > 0 || data.module_edges_removed.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
              {data.module_edges_added.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--green)", marginBottom: 10, fontSize: 14 }}>
                    New Module Dependencies ({data.module_edges_added.length})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.module_edges_added.map((e, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "monospace", color: "var(--text2)", fontSize: 11 }}>{e.from}</span>
                        <span style={{ color: "var(--green)" }}>→</span>
                        <span style={{ fontFamily: "monospace", color: "var(--text2)", fontSize: 11 }}>{e.to}</span>
                        <span style={{ marginLeft: "auto", color: "var(--green)", fontWeight: 700 }}>+{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.module_edges_removed.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 10, fontSize: 14 }}>
                    Removed Module Dependencies ({data.module_edges_removed.length})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {data.module_edges_removed.map((e, i) => (
                      <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "monospace", color: "var(--text3)", fontSize: 11, textDecoration: "line-through" }}>{e.from}</span>
                        <span style={{ color: "var(--red)" }}>→</span>
                        <span style={{ fontFamily: "monospace", color: "var(--text3)", fontSize: 11, textDecoration: "line-through" }}>{e.to}</span>
                        <span style={{ marginLeft: "auto", color: "var(--red)", fontWeight: 700 }}>-{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!submitted && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
          Select two snapshots above — or use a quick-compare button — to see the structural diff.
        </div>
      )}
    </div>
  );
}
