import { useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

// 20-color palette for community IDs
const PALETTE = [
  "#58a6ff","#3fb950","#f85149","#e3b341","#a371f7","#ff7b72",
  "#79c0ff","#56d364","#ffa657","#d2a8ff","#ff9bce","#7ee787",
  "#f0883e","#bc8cff","#db6d28","#2ea043","#0075ca","#e36209",
  "#39d353","#ff6e40",
];

function commColor(commId, sorted) {
  // stable color assignment by size-rank so biggest communities get the most distinguishable colors
  const rank = sorted.findIndex(c => c.id === commId);
  const hex = PALETTE[rank % PALETTE.length];
  return hex;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Physics (same pattern as ModuleGraph) ────────────────────────────────────
const W = 820, H = 520;

function commRadius(size) {
  return Math.max(14, Math.min(50, 10 + Math.sqrt(size) * 2.8));
}

function initPos(nodes) {
  const pos = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = Math.min(200, 60 + nodes.length * 8);
    pos[n.id] = {
      x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 30,
      y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 30,
      vx: 0, vy: 0,
    };
  });
  return pos;
}

function tick(pos, nodes, edges, alpha) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const forces = {};
  for (const n of nodes) forces[n.id] = { fx: 0, fy: 0 };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos[nodes[i].id], b = pos[nodes[j].id];
      if (!a || !b) continue;
      const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minD = commRadius(nodes[i].size) + commRadius(nodes[j].size) + 24;
      const f = Math.min(Math.max(0, minD - dist) * 0.7 + 5000 / (dist * dist), 250);
      forces[nodes[i].id].fx -= (dx / dist) * f;
      forces[nodes[i].id].fy -= (dy / dist) * f;
      forces[nodes[j].id].fx += (dx / dist) * f;
      forces[nodes[j].id].fy += (dy / dist) * f;
    }
  }
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const ra = commRadius(nodeMap[e.from]?.size || 10);
    const rb = commRadius(nodeMap[e.to]?.size || 10);
    const restLen = ra + rb + 90;
    const f = (dist - restLen) * 0.055;
    forces[e.from].fx += (dx / dist) * f;
    forces[e.from].fy += (dy / dist) * f;
    forces[e.to].fx -= (dx / dist) * f;
    forces[e.to].fy -= (dy / dist) * f;
  }
  for (const n of nodes) {
    if (!pos[n.id]) continue;
    forces[n.id].fx += (W / 2 - pos[n.id].x) * 0.01;
    forces[n.id].fy += (H / 2 - pos[n.id].y) * 0.01;
  }
  for (const n of nodes) {
    if (!pos[n.id]) continue;
    const p = pos[n.id], f = forces[n.id];
    const r = commRadius(n.size);
    p.vx = (p.vx + f.fx * alpha) * 0.72;
    p.vy = (p.vy + f.fy * alpha) * 0.72;
    p.x = Math.max(r + 2, Math.min(W - r - 2, p.x + p.vx));
    p.y = Math.max(r + 2, Math.min(H - r - 2, p.y + p.vy));
  }
}

function CommunityGraph({ communities, edges, sorted, onNodeClick, selected }) {
  const [positions, setPositions] = useState({});
  const [hovered, setHovered] = useState(null);
  const [dragging, setDragging] = useState(null);
  const posRef = useRef({});
  const rafRef = useRef();
  const iterRef = useRef(0);
  const draggingRef = useRef(null);
  const svgRef = useRef();

  const nodeKey = communities.map(c => c.id).join(",");

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = initPos(communities.map(c => ({ ...c, id: c.id })));
    iterRef.current = 0;
    const run = () => {
      iterRef.current++;
      const alpha = Math.max(0.003, 0.9 * Math.exp(-iterRef.current / 160));
      tick(posRef.current, communities, edges, alpha);
      setPositions({ ...posRef.current });
      if (iterRef.current < 500) rafRef.current = requestAnimationFrame(run);
    };
    rafRef.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodeKey, edges.length]);

  const handleMouseMove = useCallback((e) => {
    if (!draggingRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    if (posRef.current[draggingRef.current]) {
      posRef.current[draggingRef.current].x = x;
      posRef.current[draggingRef.current].y = y;
      posRef.current[draggingRef.current].vx = 0;
      posRef.current[draggingRef.current].vy = 0;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
  }, []);

  const maxEdge = Math.max(...edges.map(e => e.count), 1);

  return (
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", background: "#0d1117", borderRadius: 8, cursor: dragging ? "grabbing" : "default" }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Edges */}
      {edges.map((e, i) => {
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return null;
        const fromColor = commColor(e.from, sorted);
        const w = 1 + (e.count / maxEdge) * 5;
        const isHi = hovered === e.from || hovered === e.to;
        return (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={isHi ? fromColor : "#30363d"}
            strokeWidth={isHi ? w + 1 : w}
            strokeOpacity={isHi ? 0.8 : 0.3} />
        );
      })}

      {/* Nodes */}
      {communities.map(c => {
        const pos = positions[c.id];
        if (!pos) return null;
        const r = commRadius(c.size);
        const color = commColor(c.id, sorted);
        const isSelected = selected === c.id;
        const isHovered = hovered === c.id;
        // Show short dominant module name
        const modLabel = c.dominant_module.split(".").pop();
        const maxChars = Math.floor((r * 2 - 8) / 6);
        const label = modLabel.length > maxChars ? modLabel.slice(0, maxChars - 1) + "…" : modLabel;

        return (
          <g key={c.id}
            onMouseEnter={() => setHovered(c.id)}
            onMouseLeave={() => setHovered(null)}
            onMouseDown={() => { draggingRef.current = c.id; setDragging(c.id); }}
            onClick={() => onNodeClick && onNodeClick(c)}
            style={{ cursor: "pointer" }}>

            {(isSelected || isHovered) && (
              <circle cx={pos.x} cy={pos.y} r={r + 5}
                fill="none" stroke={color} strokeWidth={1.5}
                strokeDasharray={isSelected ? "none" : "4 2"} opacity={0.6} />
            )}

            {/* Outer ring = purity ring */}
            <circle cx={pos.x} cy={pos.y} r={r}
              fill={hexToRgba(color, 0.15)}
              stroke={color}
              strokeWidth={isSelected ? 2.5 : 1.5} />

            {/* Inner fill proportional to purity */}
            <circle cx={pos.x} cy={pos.y} r={r * c.purity}
              fill={hexToRgba(color, 0.3)} />

            {/* Count */}
            <text x={pos.x} y={pos.y - 3}
              fill={color} fontSize={Math.max(9, Math.min(13, r * 0.45))}
              fontWeight={700} textAnchor="middle" dominantBaseline="middle"
              style={{ pointerEvents: "none", userSelect: "none" }}>
              {c.size}
            </text>
            <text x={pos.x} y={pos.y + r + 11}
              fill={color} fillOpacity={0.7}
              fontSize={9} textAnchor="middle"
              style={{ pointerEvents: "none", userSelect: "none" }}>
              {label}
            </text>
          </g>
        );
      })}

      {/* Hover tooltip */}
      {hovered !== null && positions[hovered] && (() => {
        const c = communities.find(x => x.id === hovered);
        const p = positions[hovered];
        if (!c) return null;
        const color = commColor(c.id, sorted);
        const topMods = Object.entries(c.top_modules).slice(0, 4);
        const lines = [
          `Community ${c.id} — ${c.size} symbols`,
          `Purity: ${(c.purity * 100).toFixed(0)}%`,
          ...topMods.map(([mod, cnt]) => `  ${mod.split(".").pop()}: ${cnt}`),
        ];
        const boxW = Math.max(...lines.map(l => l.length)) * 6.5 + 20;
        const boxH = lines.length * 16 + 14;
        const bx = Math.min(p.x + commRadius(c.size) + 6, W - boxW - 4);
        const by = Math.min(p.y - 10, H - boxH - 4);
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect x={bx} y={by} width={boxW} height={boxH}
              fill="#161b22" stroke={color} strokeWidth={1} rx={4} fillOpacity={0.97} />
            {lines.map((line, i) => (
              <text key={i} x={bx + 10} y={by + 16 + i * 16}
                fill={i <= 1 ? color : "#8b949e"} fontSize={i === 0 ? 11 : 10}
                fontFamily="monospace" fontWeight={i === 0 ? 600 : 400}>
                {line}
              </text>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

// ── Purity badge ─────────────────────────────────────────────────────────────
function PurityBadge({ value }) {
  const color = value > 0.8 ? "var(--green)" : value > 0.5 ? "var(--yellow)" : "var(--red)";
  const label = value > 0.8 ? "pure" : value > 0.5 ? "mixed" : "fragmented";
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, padding: "1px 6px",
      border: `1px solid ${color}`, borderRadius: 10, opacity: 0.85 }}>
      {(value * 100).toFixed(0)}% {label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Communities() {
  const { repoId } = useContext(RepoContext);
  const [resolution, setResolution] = useState(1.0);
  const [pendingRes, setPendingRes] = useState(1.0);
  const [selected, setSelected] = useState(null);
  const [misalignedPage, setMisalignedPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["communities", repoId, resolution],
    queryFn: () => api.communities(repoId, resolution),
    staleTime: 60_000,
  });

  useEffect(() => { setSelected(null); setMisalignedPage(0); }, [repoId]);

  function applyResolution() {
    setResolution(pendingRes);
  }

  const communities = data?.communities || [];
  const communityEdges = (data?.community_edges || []).map(e => ({
    ...e, from: e.from, to: e.to
  }));

  // Sort communities by size (descending) for stable color assignment
  const sorted = useMemo(() =>
    [...communities].sort((a, b) => b.size - a.size),
    [communities]
  );

  const selectedComm = selected !== null ? communities.find(c => c.id === selected) : null;
  const misaligned = data?.misaligned || [];
  const pagedMisaligned = misaligned.slice(misalignedPage * PAGE_SIZE, (misalignedPage + 1) * PAGE_SIZE);

  // Group misaligned by declared module for readability
  const misalignedByModule = useMemo(() => {
    const groups = {};
    for (const m of misaligned) {
      if (!groups[m.declared_module]) groups[m.declared_module] = [];
      groups[m.declared_module].push(m);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [misaligned]);

  const alignmentColor = data
    ? data.alignment_score > 0.8 ? "var(--green)"
      : data.alignment_score > 0.5 ? "var(--yellow)"
      : "var(--red)"
    : "var(--text)";

  return (
    <div>
      <div className="page-header">
        <h1>🔬 Community Detection</h1>
        <p>
          Louvain algorithm finds natural symbol clusters from call-graph density — no file paths,
          no module labels. Compare inferred communities with declared modules to spot structural mismatches.
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Resolution:</span>
        <input
          type="range" min={0.2} max={3.0} step={0.1}
          value={pendingRes}
          onChange={e => setPendingRes(parseFloat(e.target.value))}
          style={{ width: 140 }}
        />
        <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)", minWidth: 32 }}>
          {pendingRes.toFixed(1)}
        </span>
        <button className="btn btn-sm" onClick={applyResolution}
          disabled={pendingRes === resolution || isLoading}>
          Apply
        </button>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>
          Low = fewer large communities · High = many small communities
        </span>
        {data && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text2)" }}>
            {data.community_count} communities · {data.total_nodes.toLocaleString()} symbols
          </span>
        )}
      </div>

      {isLoading && (
        <div className="loading">Running Louvain community detection…</div>
      )}
      {error && <div className="error">{error.message}</div>}

      {data && (
        <>
          {/* Stats */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: alignmentColor }}>
                {(data.alignment_score * 100).toFixed(1)}%
              </div>
              <div className="stat-label">Alignment score</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--blue)" }}>
                {data.community_count}
              </div>
              <div className="stat-label">Inferred communities</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--red)" }}>
                {misaligned.length}
              </div>
              <div className="stat-label">Misaligned symbols</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--text2)" }}>
                {communities.length > 0
                  ? Math.round(data.total_nodes / communities.length)
                  : "—"}
              </div>
              <div className="stat-label">Avg community size</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, marginBottom: 24 }}>
            {/* Community meta-graph */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <strong>Community map</strong>
                <span style={{ color: "var(--text3)", marginLeft: 8 }}>
                  Node size = member count · inner fill = purity · edges = inter-community calls
                </span>
              </div>
              {sorted.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
                  No communities found.
                </div>
              ) : (
                <CommunityGraph
                  communities={sorted}
                  edges={communityEdges}
                  sorted={sorted}
                  onNodeClick={c => setSelected(c.id === selected ? null : c.id)}
                  selected={selected}
                />
              )}
            </div>

            {/* Selected community detail OR community list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedComm ? (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600,
                      color: commColor(selectedComm.id, sorted) }}>
                      Community {selectedComm.id}
                    </span>
                    <PurityBadge value={selectedComm.purity} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.9, marginBottom: 10 }}>
                    <div><strong>Members:</strong> {selectedComm.size}</div>
                    <div><strong>Dominant module:</strong></div>
                    <div style={{ fontFamily: "monospace", fontSize: 11,
                      color: "var(--text)", paddingLeft: 8 }}>
                      {selectedComm.dominant_module}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>
                    Module breakdown
                  </div>
                  {Object.entries(selectedComm.top_modules).map(([mod, cnt]) => {
                    const pct = (cnt / selectedComm.size) * 100;
                    return (
                      <div key={mod} style={{ marginBottom: 5 }}>
                        <div style={{ display: "flex", justifyContent: "space-between",
                          fontSize: 11, marginBottom: 2 }}>
                          <span style={{ fontFamily: "monospace", color: "var(--text2)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            maxWidth: 160 }}>
                            {mod}
                          </span>
                          <span style={{ color: "var(--text3)", flexShrink: 0, marginLeft: 6 }}>
                            {cnt}
                          </span>
                        </div>
                        <div style={{ height: 3, background: "var(--bg3)", borderRadius: 2 }}>
                          <div style={{ height: "100%", width: `${pct}%`,
                            background: commColor(selectedComm.id, sorted), borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: "100%" }}
                    onClick={() => setSelected(null)}>
                    ← Back to list
                  </button>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)",
                    fontSize: 12, fontWeight: 600 }}>
                    Communities
                  </div>
                  <div style={{ maxHeight: 340, overflowY: "auto" }}>
                    {sorted.map(c => {
                      const color = commColor(c.id, sorted);
                      return (
                        <div key={c.id}
                          onClick={() => setSelected(c.id)}
                          style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%",
                            background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontFamily: "monospace",
                              color: "var(--text2)", overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.dominant_module}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>
                            {c.size}
                          </span>
                          <PurityBadge value={c.purity} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Alignment explanation */}
              <div className="card" style={{ padding: 14, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>What this means</div>
                <div>
                  <span style={{ color: alignmentColor, fontWeight: 600 }}>
                    {(data.alignment_score * 100).toFixed(0)}% alignment
                  </span>
                  {" "}between graph clusters and declared modules.
                </div>
                <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 11 }}>
                  High alignment = file structure reflects call graph.{" "}
                  Low alignment = code is organized differently from how it actually calls each other.{" "}
                  Neither is inherently bad — but mismatches reveal where module boundaries are fuzzy.
                </div>
              </div>
            </div>
          </div>

          {/* Misaligned symbols */}
          {misaligned.length > 0 && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                ⚠️ Misaligned Symbols ({misaligned.length})
              </h2>
              <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>
                These symbols belong to a community whose dominant module differs from their declared module.
                They may be good candidates for refactoring or indicate that a module boundary is in the wrong place.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
                {misalignedByModule.slice(0, 8).map(([mod, items]) => (
                  <div key={mod} className="card" style={{ overflow: "hidden" }}>
                    <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text2)" }}>
                        {mod}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--red)",
                        background: "var(--red-bg)", padding: "1px 6px", borderRadius: 10 }}>
                        {items.length} misaligned
                      </span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      {items.slice(0, 12).map(m => (
                        <div key={m.hash} style={{ padding: "6px 14px",
                          borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 600,
                              color: "var(--text)", flex: 1, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.name}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6,
                            color: "var(--text3)" }}>
                            <span style={{ color: "var(--red)" }}>
                              {m.declared_module.split(".").pop()}
                            </span>
                            <span>→</span>
                            <span style={{ color: "var(--green)" }}>
                              {m.inferred_module.split(".").pop()}
                            </span>
                          </div>
                        </div>
                      ))}
                      {items.length > 12 && (
                        <div style={{ padding: "6px 14px", color: "var(--text3)", fontSize: 11 }}>
                          + {items.length - 12} more
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {misalignedByModule.length > 8 && (
                <div style={{ marginTop: 12, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  Showing top 8 modules with misaligned symbols. {misaligned.length} total.
                </div>
              )}
            </div>
          )}

          {misaligned.length === 0 && data.alignment_score > 0 && (
            <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--green)" }}>
              ✓ No misaligned symbols — call graph communities match declared modules well.
            </div>
          )}
        </>
      )}
    </div>
  );
}
