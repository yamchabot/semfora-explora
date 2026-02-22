import { useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

// ── Color helpers ─────────────────────────────────────────────────────────────
function instabilityColor(instability) {
  // 0 = stable = green, 1 = unstable = red via HSL
  const hue = Math.round((1 - instability) * 120); // 120=green, 0=red
  return {
    fill:   `hsl(${hue},55%,12%)`,
    stroke: `hsl(${hue},70%,45%)`,
    text:   `hsl(${hue},70%,60%)`,
  };
}

const COMM_PALETTE = [
  "#58a6ff","#3fb950","#f85149","#e3b341","#a371f7","#ff7b72",
  "#79c0ff","#56d364","#ffa657","#d2a8ff","#ff9bce","#7ee787",
  "#f0883e","#bc8cff","#db6d28","#2ea043","#0075ca","#e36209",
];

// ── Physics engine (reused from DiffGraph but with variable radii) ────────────
const W = 860, H = 540;

function nodeRadius(symbolCount) {
  return Math.max(8, Math.min(38, 6 + Math.sqrt(symbolCount) * 2.2));
}

function initPositions(nodes) {
  const pos = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = Math.min(220, 60 + nodes.length * 6);
    pos[n.id] = {
      x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 30,
      y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 30,
      vx: 0, vy: 0,
    };
  });
  return pos;
}

function runTick(pos, nodes, edges, alpha) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const forces = {};
  for (const n of nodes) forces[n.id] = { fx: 0, fy: 0 };

  // Repulsion — radius-aware
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos[nodes[i].id], b = pos[nodes[j].id];
      if (!a || !b) continue;
      const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minDist = nodeRadius(nodes[i].symbol_count) + nodeRadius(nodes[j].symbol_count) + 20;
      const strength = Math.max(0, minDist - dist) * 0.6 + 4000 / (dist * dist);
      const f = Math.min(strength, 200);
      forces[nodes[i].id].fx -= (dx / dist) * f;
      forces[nodes[i].id].fy -= (dy / dist) * f;
      forces[nodes[j].id].fx += (dx / dist) * f;
      forces[nodes[j].id].fy += (dy / dist) * f;
    }
  }

  // Springs
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const ra = nodeRadius(nodeMap[e.from]?.symbol_count || 10);
    const rb = nodeRadius(nodeMap[e.to]?.symbol_count || 10);
    const restLen = ra + rb + 80 + Math.sqrt(e.count || 1) * 0.5;
    const f = (dist - restLen) * 0.06;
    forces[e.from].fx += (dx / dist) * f;
    forces[e.from].fy += (dy / dist) * f;
    forces[e.to].fx -= (dx / dist) * f;
    forces[e.to].fy -= (dy / dist) * f;
  }

  // Center gravity
  for (const n of nodes) {
    if (!pos[n.id]) continue;
    forces[n.id].fx += (W / 2 - pos[n.id].x) * 0.01;
    forces[n.id].fy += (H / 2 - pos[n.id].y) * 0.01;
  }

  // Integrate
  for (const n of nodes) {
    if (!pos[n.id]) continue;
    const p = pos[n.id], f = forces[n.id];
    const r = nodeRadius(n.symbol_count);
    p.vx = (p.vx + f.fx * alpha) * 0.72;
    p.vy = (p.vy + f.fy * alpha) * 0.72;
    p.x = Math.max(r + 2, Math.min(W - r - 2, p.x + p.vx));
    p.y = Math.max(r + 2, Math.min(H - r - 2, p.y + p.vy));
  }
}

// ── Graph canvas ──────────────────────────────────────────────────────────────
function ModuleForceGraph({ nodes, edges, onNodeClick, selected, colorFn, labelFn }) {
  const [positions, setPositions] = useState({});
  const [hovered, setHovered] = useState(null);
  const [dragging, setDragging] = useState(null);
  const posRef = useRef({});
  const rafRef = useRef();
  const iterRef = useRef(0);
  const draggingRef = useRef(null);
  const svgRef = useRef();

  const nodeIds = useMemo(() => nodes.map(n => n.id).join(","), [nodes]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = initPositions(nodes);
    iterRef.current = 0;

    function tick() {
      iterRef.current++;
      const alpha = Math.max(0.003, 0.9 * Math.exp(-iterRef.current / 150));
      runTick(posRef.current, nodes, edges, alpha);
      setPositions({ ...posRef.current });
      if (iterRef.current < 500) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodeIds, edges.length]);

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
      if (iterRef.current >= 500) {
        iterRef.current = 460;
        const resume = () => {
          iterRef.current++;
          runTick(posRef.current, nodes, edges, 0.08);
          setPositions({ ...posRef.current });
          if (iterRef.current < 480) rafRef.current = requestAnimationFrame(resume);
        };
        rafRef.current = requestAnimationFrame(resume);
      }
    }
  }, [nodes, edges]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
  }, []);

  const maxEdgeCount = Math.max(...edges.map(e => e.count), 1);

  return (
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", background: "#0d1117", borderRadius: 8,
        cursor: dragging ? "grabbing" : "default" }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <defs>
        <marker id="arrow-mod" markerWidth="7" markerHeight="7" refX="20" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="#30363d" fillOpacity={0.7} />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((e, i) => {
        const a = positions[e.from], b = positions[e.to];
        if (!a || !b) return null;
        const w = 0.8 + Math.log1p(e.count) / Math.log1p(maxEdgeCount) * 4;
        const isHighlighted = hovered === e.from || hovered === e.to;
        return (
          <line key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={isHighlighted ? "#58a6ff" : "#30363d"}
            strokeWidth={w}
            strokeOpacity={isHighlighted ? 0.8 : 0.35}
            markerEnd="url(#arrow-mod)"
          />
        );
      })}

      {/* Nodes */}
      {nodes.map(n => {
        const pos = positions[n.id];
        if (!pos) return null;
        const r = nodeRadius(n.symbol_count);
        const c = colorFn(n);
        const isSelected = selected === n.id;
        const isHovered = hovered === n.id;
        const label = labelFn ? labelFn(n) : n.label;
        const maxChars = Math.floor((r * 2 - 4) / 6);
        const displayLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;

        return (
          <g key={n.id}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
            onMouseDown={() => { draggingRef.current = n.id; setDragging(n.id); }}
            onClick={() => onNodeClick && onNodeClick(n)}
            style={{ cursor: "pointer" }}
          >
            {(isSelected || isHovered) && (
              <circle cx={pos.x} cy={pos.y} r={r + 5}
                fill="none" stroke={c.stroke} strokeWidth={1.5}
                strokeDasharray={isSelected ? "none" : "4 2"}
                opacity={0.6} />
            )}
            <circle cx={pos.x} cy={pos.y} r={r}
              fill={c.fill} stroke={c.stroke}
              strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
            />
            <text x={pos.x} y={pos.y + 1}
              fill={c.text} fontSize={Math.max(8, Math.min(11, r * 0.55))}
              fontWeight={600} textAnchor="middle" dominantBaseline="middle"
              style={{ pointerEvents: "none", userSelect: "none" }}>
              {displayLabel}
            </text>
          </g>
        );
      })}

      {/* Hover tooltip */}
      {hovered && positions[hovered] && (() => {
        const n = nodes.find(x => x.id === hovered);
        const p = positions[hovered];
        if (!n) return null;
        const c = colorFn(n);
        const lines = [
          n.full_name || n.id,
          `${n.symbol_count} symbols · complexity ${n.complexity}`,
          `instability ${n.instability?.toFixed(2)} (Ca:${n.afferent} Ce:${n.efferent})`,
          n.submodule_count ? `${n.submodule_count} sub-modules` : null,
        ].filter(Boolean);
        const boxW = Math.max(...lines.map(l => l.length)) * 6.5 + 20;
        const boxH = lines.length * 16 + 14;
        const bx = Math.min(p.x + nodeRadius(n.symbol_count) + 6, W - boxW - 4);
        const by = Math.min(p.y - 10, H - boxH - 4);
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect x={bx} y={by} width={boxW} height={boxH}
              fill="#161b22" stroke={c.stroke} strokeWidth={1} rx={4} fillOpacity={0.97} />
            {lines.map((line, i) => (
              <text key={i} x={bx + 10} y={by + 16 + i * 16}
                fill={i === 0 ? c.text : "#8b949e"} fontSize={i === 0 ? 11 : 10}
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ModuleGraph() {
  const { repoId } = useContext(RepoContext);
  const [depth, setDepth] = useState(2);
  const [selected, setSelected] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["module-graph", repoId, depth],
    queryFn: () => api.moduleGraph(repoId, depth),
  });

  // Reset selection when repo changes
  useEffect(() => { setSelected(null); setSelectedNode(null); }, [repoId]);

  function handleNodeClick(n) {
    setSelected(n.id);
    setSelectedNode(n);
  }

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const maxDepth = data?.max_depth || 4;

  // Sort edges by count for the selected node's connections
  const relatedEdges = selectedNode
    ? edges
        .filter(e => e.from === selectedNode.id || e.to === selectedNode.id)
        .sort((a, b) => b.count - a.count)
    : [];

  const totalSymbols = nodes.reduce((s, n) => s + n.symbol_count, 0);
  const avgInstability = nodes.length
    ? (nodes.reduce((s, n) => s + n.instability, 0) / nodes.length).toFixed(2)
    : "—";
  const mostCoupled = [...nodes].sort((a, b) => (b.afferent + b.efferent) - (a.afferent + a.efferent))[0];

  return (
    <div>
      <div className="page-header">
        <h1>🗺️ Module Graph</h1>
        <p>
          Module-level architecture. Node size = symbol count, color = instability (green=stable, red=unstable).
          Adjust depth to roll up fine-grained path modules into coarser groups.
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Path depth:</span>
          {[1, 2, 3, 4, 5, 6].filter(d => d <= Math.max(maxDepth, 2)).map(d => (
            <button key={d}
              className={`btn btn-sm ${depth === d ? "" : "btn-ghost"}`}
              style={{ minWidth: 32 }}
              onClick={() => setDepth(d)}>
              {d}
            </button>
          ))}
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>
            {depth === 1 ? "top-level only" : `first ${depth} path segments`}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 12, color: "var(--text2)" }}>
          <span>{nodes.length} modules</span>
          <span>{edges.length} dependencies</span>
        </div>
      </div>

      {isLoading && <div className="loading">Computing module graph…</div>}
      {error && <div className="error">{error.message}</div>}

      {data && (
        <>
          {/* Stats */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--blue)" }}>{nodes.length}</div>
              <div className="stat-label">Modules at depth {depth}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--text)" }}>{totalSymbols.toLocaleString()}</div>
              <div className="stat-label">Total symbols</div>
            </div>
            <div className="stat-card">
              <div className="stat-value"
                style={{ color: parseFloat(avgInstability) > 0.6 ? "var(--red)" : parseFloat(avgInstability) > 0.4 ? "var(--yellow)" : "var(--green)" }}>
                {avgInstability}
              </div>
              <div className="stat-label">Avg instability</div>
            </div>
            {mostCoupled && (
              <div className="stat-card">
                <div className="stat-value" style={{ fontSize: 14, color: "var(--yellow)", fontFamily: "monospace" }}>
                  {mostCoupled.label}
                </div>
                <div className="stat-label">Most coupled module</div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
            <div className="card" style={{ overflow: "hidden", padding: 0 }}>
              {nodes.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
                  No module data available for this repo at depth {depth}.
                </div>
              ) : (
                <ModuleForceGraph
                  nodes={nodes}
                  edges={edges}
                  onNodeClick={handleNodeClick}
                  selected={selected}
                  colorFn={(n) => instabilityColor(n.instability ?? 0.5)}
                  labelFn={(n) => n.label}
                />
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Selected node detail */}
              {selectedNode ? (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase" }}>
                    Module
                  </div>
                  <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, marginBottom: 10,
                    wordBreak: "break-all",
                    color: instabilityColor(selectedNode.instability).text }}>
                    {selectedNode.full_name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 2 }}>
                    <div><strong>Symbols:</strong> {selectedNode.symbol_count}</div>
                    <div><strong>Sub-modules:</strong> {selectedNode.submodule_count}</div>
                    <div><strong>Intra calls:</strong> {selectedNode.intra_calls}</div>
                    <div><strong>Afferent (Ca):</strong>{" "}
                      <span style={{ color: "var(--green)" }}>{selectedNode.afferent}</span>
                    </div>
                    <div><strong>Efferent (Ce):</strong>{" "}
                      <span style={{ color: "var(--red)" }}>{selectedNode.efferent}</span>
                    </div>
                    <div><strong>Instability:</strong>{" "}
                      <span style={{
                        color: selectedNode.instability > 0.7 ? "var(--red)"
                          : selectedNode.instability > 0.4 ? "var(--yellow)" : "var(--green)",
                        fontWeight: 700 }}>
                        {selectedNode.instability.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {relatedEdges.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>
                        Connections
                      </div>
                      <div style={{ maxHeight: 160, overflowY: "auto" }}>
                        {relatedEdges.slice(0, 10).map((e, i) => {
                          const isOut = e.from === selectedNode.id;
                          const other = isOut ? e.to : e.from;
                          return (
                            <div key={i} style={{ fontSize: 11, padding: "3px 0",
                              borderBottom: "1px solid var(--border)",
                              display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ color: isOut ? "var(--red)" : "var(--green)",
                                fontSize: 10, width: 14, textAlign: "center" }}>
                                {isOut ? "→" : "←"}
                              </span>
                              <span style={{ fontFamily: "monospace", color: "var(--text2)",
                                fontSize: 11, flex: 1, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {other.split(".").pop()}
                              </span>
                              <span style={{ color: "var(--text3)", fontSize: 10 }}>
                                {e.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  Click a module to inspect
                </div>
              )}

              {/* Legend */}
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Legend</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {[
                    { color: "hsl(120,70%,45%)", label: "Stable (Ca≫Ce)" },
                    { color: "hsl(60,70%,45%)",  label: "Balanced" },
                    { color: "hsl(0,70%,45%)",   label: "Unstable (Ce≫Ca)" },
                  ].map(({ color, label }) => (
                    <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: color, opacity: 0.8 }} />
                      <span style={{ fontSize: 10, color: "var(--text3)", textAlign: "center", lineHeight: 1.3 }}>{label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.7 }}>
                  <div>Node size = symbol count</div>
                  <div>Edge width = call volume</div>
                  <div>Ca = afferent (callers from outside)</div>
                  <div>Ce = efferent (calls to outside)</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ color: "var(--green)" }}>Stable</span> modules are depended-on foundations.{" "}
                    <span style={{ color: "var(--red)" }}>Unstable</span> ones depend heavily on others.
                  </div>
                </div>
              </div>

              {/* Module table */}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600 }}>
                  All modules
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {[...nodes].sort((a, b) => b.symbol_count - a.symbol_count).map(n => {
                    const c = instabilityColor(n.instability);
                    return (
                      <div key={n.id}
                        onClick={() => handleNodeClick(n)}
                        style={{
                          padding: "7px 14px", borderBottom: "1px solid var(--border)",
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                          background: selected === n.id ? "var(--bg2)" : "transparent",
                        }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%",
                          background: c.stroke, flexShrink: 0 }} />
                        <span style={{ fontFamily: "monospace", fontSize: 11, flex: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          color: selected === n.id ? "var(--text)" : "var(--text2)" }}>
                          {n.full_name}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text3)" }}>
                          {n.symbol_count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
