import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import DiffGraph from "../components/DiffGraph";
import { BuildingCanvas, LAYER_COLORS } from "./Building";

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
  const [graphMode, setGraphMode] = useState("neighborhood"); // "neighborhood" | "changed-only"
  const [graphContext, setGraphContext] = useState(4);
  const [vizTab, setVizTab] = useState("graph"); // "graph" | "building"

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

  const { data: graphData, isLoading: graphLoading } = useQuery({
    queryKey: ["diff-graph", repoA, repoB, graphContext],
    queryFn: () => api.diffGraph(repoA, repoB, graphContext),
    enabled: submitted && !!repoA && !!repoB,
  });

  const { data: buildingData, isLoading: buildingLoading } = useQuery({
    queryKey: ["diff-building", repoA, repoB],
    queryFn: () => api.diffBuilding(repoA, repoB),
    enabled: submitted && !!repoA && !!repoB && vizTab === "building",
  });

  const [selectedBuildingNode, setSelectedBuildingNode] = useState(null);

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
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10 }}>Quick compare (adjacent commits):</div>
            {projects.map((proj) => {
              const vers = groups[proj];
              const pairs = vers.slice(0, -1).map((v, i) => ({
                a: vers[i + 1].id,
                b: v.id,
                label: `${vers[i + 1].commit.slice(0, 7)} → ${v.commit.slice(0, 7)}`,
              }));
              if (pairs.length === 0) return null;
              return (
                <div key={proj} style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", marginRight: 8, fontFamily: "monospace" }}>{proj}</span>
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    {pairs.map(({ a, b, label }) => (
                      <button
                        key={label}
                        className="btn btn-ghost btn-sm"
                        style={{ fontFamily: "monospace", fontSize: 11 }}
                        onClick={() => { setRepoA(a); setRepoB(b); }}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isLoading && <div className="loading">Computing structural diff…</div>}
      {error && <div className="error">{error.message}</div>}

      {data && (() => {
        // Sort everything once before rendering
        const added = [...data.added].sort((a, b) =>
          (a.module || "").localeCompare(b.module || "") || a.name.localeCompare(b.name));
        const removed = [...data.removed].sort((a, b) =>
          (a.module || "").localeCompare(b.module || "") || a.name.localeCompare(b.name));
        const modAdded = [...data.module_edges_added].sort((a, b) =>
          a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        const modRemoved = [...data.module_edges_removed].sort((a, b) =>
          a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        return (<>
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

          {/* ── Visual Diff Views ───────────────────────────────────── */}
          <div className="card" style={{ padding: 16, marginBottom: 20 }}>
            {/* Tab bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <button className={`btn btn-sm ${vizTab === "graph" ? "" : "btn-ghost"}`}
                onClick={() => setVizTab("graph")}>
                📊 Graph View
              </button>
              <button className={`btn btn-sm ${vizTab === "building" ? "" : "btn-ghost"}`}
                onClick={() => setVizTab("building")}>
                🏗️ Building View
              </button>

              {vizTab === "graph" && (
                <>
                  {graphData?.github_compare_url && (
                    <a href={graphData.github_compare_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "var(--blue)", display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                      View on GitHub
                    </a>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text2)" }}>Context:</span>
                    {[2, 4, 6].map(n => (
                      <button key={n} className={`btn btn-sm ${graphContext === n ? "" : "btn-ghost"}`}
                        style={{ minWidth: 30, fontSize: 11 }}
                        onClick={() => setGraphContext(n)}>{n}</button>
                    ))}
                    <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
                    <button className={`btn btn-sm ${graphMode === "neighborhood" ? "" : "btn-ghost"}`}
                      style={{ fontSize: 11 }}
                      onClick={() => setGraphMode("neighborhood")}>Neighborhood</button>
                    <button className={`btn btn-sm ${graphMode === "changed-only" ? "" : "btn-ghost"}`}
                      style={{ fontSize: 11 }}
                      onClick={() => setGraphMode("changed-only")}>Changed only</button>
                  </div>
                </>
              )}

              {vizTab === "building" && buildingData && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 12, alignItems: "center" }}>
                  {[
                    { color: "#3fb950", label: `+${buildingData.stats.added} added` },
                    { color: "#f85149", label: `-${buildingData.stats.removed} removed` },
                  ].map(({ color, label }) => (
                    <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
                      <span style={{ color }}>{label}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>
                    ({buildingData.stats.common} unchanged hidden)
                  </span>
                </div>
              )}
            </div>

            {/* Graph tab */}
            {vizTab === "graph" && (
              <>
                {graphLoading && (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
                    Building graph…
                  </div>
                )}
                {graphData && !graphLoading && graphData.nodes.length === 0 && (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
                    No changed nodes with graph connections found.
                  </div>
                )}
                {graphData && !graphLoading && graphData.nodes.length > 0 && (
                  <DiffGraph nodes={graphData.nodes} edges={graphData.edges} mode={graphMode} />
                )}
              </>
            )}

            {/* Building tab */}
            {vizTab === "building" && (
              <>
                {buildingLoading && (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
                    Building layout…
                  </div>
                )}
                {buildingData && !buildingLoading && (() => {
                  // Only show changed nodes — common/unchanged are not what we're here to see
                  const changedNodes = buildingData.nodes.filter(n => n.diff_status !== "common");
                  const changedHashes = new Set(changedNodes.map(n => n.hash));
                  // Include edges where at least one endpoint is changed (shows connections to context)
                  const changedEdges = buildingData.edges.filter(
                    e => changedHashes.has(e.from) && changedHashes.has(e.to)
                  );
                  return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
                    <div style={{ overflow: "hidden" }}>
                      <BuildingCanvas
                        nodes={changedNodes}
                        edges={changedEdges}
                        onNodeClick={setSelectedBuildingNode}
                        selected={selectedBuildingNode?.hash}
                        getDiffStatus={(n) => n.diff_status}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {selectedBuildingNode ? (
                        <div className="card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4,
                            color: selectedBuildingNode.diff_status === "added" ? "var(--green)"
                              : selectedBuildingNode.diff_status === "removed" ? "var(--red)"
                              : "var(--text2)" }}>
                            {selectedBuildingNode.diff_status?.toUpperCase()}
                            {selectedBuildingNode.is_load_bearing ? " · LOAD-BEARING" : ""}
                          </div>
                          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, marginBottom: 6, wordBreak: "break-all" }}>
                            {selectedBuildingNode.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.8 }}>
                            <div>{selectedBuildingNode.module}</div>
                            <div>{LAYER_COLORS[selectedBuildingNode.layer ?? 4]?.label} layer</div>
                            <div>{selectedBuildingNode.caller_count} callers</div>
                          </div>
                        </div>
                      ) : (
                        <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                          Click a node to inspect
                        </div>
                      )}
                      <div className="card" style={{ padding: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>How to read</div>
                        {[
                          { color: "#3fb950", label: "Green = added in newer snapshot" },
                          { color: "#f85149", label: "Red/strikethrough = removed" },
                        ].map(({ color, label }) => (
                          <div key={label} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginBottom: 6, fontSize: 11 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 2 }} />
                            <span style={{ color: "var(--text2)" }}>{label}</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
                          Only changed symbols shown. Layer = structural role: Foundation (most called) → Leaves (entry points).
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                          Layer shifts = architectural drift (e.g. Features→Platform = accidentally became shared infra).
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })()}
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Added */}
            {added.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: "var(--green)", marginBottom: 10, fontSize: 14 }}>
                  ✦ Added ({data.nodes_added})
                </div>
                <div className="card" style={{ overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                  {added.map((n, i) => (
                    <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--green)" }}>{n.name}</span>
                      <span style={{ background: "var(--bg3)", color: "var(--text3)", fontSize: 10, padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>{n.kind}</span>
                      <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>{n.module}</div>
                    </div>
                  ))}
                  {data.nodes_added > added.length && (
                    <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                      + {data.nodes_added - added.length} more…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Removed */}
            {removed.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 10, fontSize: 14 }}>
                  ✕ Removed ({data.nodes_removed})
                </div>
                <div className="card" style={{ overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                  {removed.map((n, i) => (
                    <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--red)", textDecoration: "line-through" }}>{n.name}</span>
                      <span style={{ background: "var(--bg3)", color: "var(--text3)", fontSize: 10, padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>{n.kind}</span>
                      <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>{n.module}</div>
                    </div>
                  ))}
                  {data.nodes_removed > removed.length && (
                    <div style={{ padding: "8px 14px", color: "var(--text2)", fontSize: 12 }}>
                      + {data.nodes_removed - removed.length} more…
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Module edge changes */}
          {(modAdded.length > 0 || modRemoved.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
              {modAdded.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--green)", marginBottom: 10, fontSize: 14 }}>
                    New Module Dependencies ({modAdded.length})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {modAdded.map((e, i) => (
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
              {modRemoved.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 10, fontSize: 14 }}>
                    Removed Module Dependencies ({modRemoved.length})
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {modRemoved.map((e, i) => (
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
        </>);
      })()}

      {!submitted && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
          Select two snapshots above — or use a quick-compare button — to see the structural diff.
        </div>
      )}
    </div>
  );
}
