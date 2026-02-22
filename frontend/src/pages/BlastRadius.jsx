import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

const DEPTH_COLORS = ["#f85149", "#e3b341", "#58a6ff", "#3fb950", "#a371f7", "#8b949e"];

export default function BlastRadius() {
  const { repoId } = useContext(RepoContext);
  const [query, setQuery] = useState("");
  const [targetHash, setTargetHash] = useState(null);
  const [targetName, setTargetName] = useState("");
  const [depth, setDepth] = useState(4);
  const [showAll, setShowAll] = useState(false);

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["search", repoId, query],
    queryFn: () => api.search(repoId, query),
    enabled: query.length >= 2,
  });

  const { data: blastData, isLoading: blasting } = useQuery({
    queryKey: ["blast", repoId, targetHash, depth],
    queryFn: () => api.blastRadius(repoId, targetHash, depth),
    enabled: !!targetHash,
  });

  const grouped = {};
  if (blastData?.affected_nodes) {
    for (const n of blastData.affected_nodes) {
      const d = n.depth;
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(n);
    }
  }

  const maxAffected = blastData?.affected_count || 0;

  return (
    <div>
      <div className="page-header">
        <h1>💥 Blast Radius</h1>
        <p>Search for any symbol — see the full transitive set of everything that calls it, directly or indirectly.</p>
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "flex-start" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            style={{ width: "100%", fontFamily: "monospace" }}
            placeholder="Search for a function, method, or class..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchResults?.results?.length > 0 && query.length >= 2 && !targetHash && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg2)",
              border: "1px solid var(--border2)", borderRadius: 6, zIndex: 10, maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 24px #0008"
            }}>
              {searchResults.results.map((r) => (
                <div
                  key={r.hash}
                  style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg3)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = ""}
                  onClick={() => { setTargetHash(r.hash); setTargetName(r.name); setQuery(r.name); }}
                >
                  <div style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>{r.module} · {r.caller_count} callers</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--text2)" }}>Depth:</label>
          <select value={depth} onChange={(e) => setDepth(+e.target.value)} style={{ width: 70 }}>
            {[2, 3, 4, 5, 6, 8, 10].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button className="btn" onClick={() => { setTargetHash(null); setQuery(""); }}>Clear</button>
      </div>

      {!targetHash && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
          Search for a symbol above to analyze its blast radius.
        </div>
      )}

      {targetHash && blasting && <div className="loading">Computing blast radius…</div>}

      {targetHash && blastData && (
        <div className="two-col">
          {/* Left: affected nodes by depth */}
          <div>
            {/* Stats row */}
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "var(--red)" }}>{blastData.affected_count}</div>
                <div className="stat-label">Affected symbols</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "var(--yellow)" }}>{blastData.modules_affected.length}</div>
                <div className="stat-label">Affected modules</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "var(--blue)" }}>{depth}</div>
                <div className="stat-label">Max depth searched</div>
              </div>
            </div>

            {/* Target node */}
            <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: "var(--red)" }}>
              <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 600, marginBottom: 4 }}>🎯 TARGET</div>
              <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{blastData.target.name}</div>
              <div style={{ fontSize: 12, color: "var(--text2)" }}>
                {blastData.target.module} · {blastData.target.file_path} · {blastData.target.caller_count} direct callers
              </div>
            </div>

            {/* By depth */}
            {Object.entries(grouped).sort((a, b) => +a[0] - +b[0]).map(([depth_, nodes]) => (
              <div key={depth_} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div className="depth-pill" style={{
                    background: DEPTH_COLORS[+depth_] + "33",
                    color: DEPTH_COLORS[+depth_],
                    border: `1px solid ${DEPTH_COLORS[+depth_]}44`
                  }}>{depth_}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    Depth {depth_} · {nodes.length} {+depth_ === 1 ? "direct caller" : "symbols"}
                    {+depth_ === 1 && nodes.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="card" style={{ overflow: "hidden" }}>
                  {(showAll ? nodes : nodes.slice(0, 8)).map((n) => (
                    <div key={n.hash} style={{
                      padding: "8px 14px", borderBottom: "1px solid var(--border)",
                      display: "flex", gap: 10, fontSize: 12
                    }}>
                      <div style={{ flex: 1 }}>
                        <div className="node-name">{n.name}</div>
                        <div className="node-meta">{n.module}</div>
                      </div>
                    </div>
                  ))}
                  {!showAll && nodes.length > 8 && (
                    <div
                      style={{ padding: "8px 14px", color: "var(--blue)", fontSize: 12, cursor: "pointer" }}
                      onClick={() => setShowAll(true)}
                    >
                      + {nodes.length - 8} more…
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Right: stats panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>Affected Modules</div>
              {blastData.modules_affected.map((mod) => {
                const count = blastData.affected_nodes.filter((n) => n.module === mod).length;
                return (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                    <div style={{ fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mod}</div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{ width: `${(count / blastData.affected_count) * 100}%`, background: "var(--red)" }} />
                    </div>
                    <div style={{ color: "var(--text2)", width: 25, textAlign: "right" }}>{count}</div>
                  </div>
                );
              })}
            </div>

            {blastData.affected_count > 20 && (
              <div className="card" style={{ padding: 14, borderColor: "var(--red)", background: "var(--red-bg)" }}>
                <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 6 }}>⚠ High Risk</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  This symbol has <strong>{blastData.affected_count}</strong> transitive dependents across <strong>{blastData.modules_affected.length}</strong> modules. Changes here have wide blast radius — ensure adequate test coverage of callers before modifying.
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Legend</div>
              {Object.keys(grouped).map((d) => (
                <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <div className="depth-pill" style={{
                    background: DEPTH_COLORS[+d] + "33", color: DEPTH_COLORS[+d],
                    border: `1px solid ${DEPTH_COLORS[+d]}44`
                  }}>{d}</div>
                  <div style={{ color: "var(--text2)" }}>
                    {+d === 1 ? "Direct callers" : `${+d}-hop transitive callers`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
