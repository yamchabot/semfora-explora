import { useEffect, useRef, useState, useCallback } from "react";

const W = 860, H = 560;
const NODE_R = 10;

const STATUS_COLOR = {
  added:   { fill: "#1a3628", stroke: "#3fb950", text: "#3fb950", label: "Added" },
  removed: { fill: "#3d1f1f", stroke: "#f85149", text: "#f85149", label: "Removed" },
  context: { fill: "#161b22", stroke: "#484f58", text: "#8b949e", label: "Context" },
};
const EDGE_COLOR = {
  added:     "#3fb950",
  removed:   "#f85149",
  unchanged: "#2d333b",
};

// ── Force layout (runs in a RAF loop) ────────────────────────────────────────
function initPositions(nodes) {
  const pos = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = Math.min(200, 40 + nodes.length * 4);
    pos[n.id] = {
      x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
      vx: 0, vy: 0,
    };
  });
  return pos;
}

function runTick(pos, nodeIds, edges, alpha) {
  const forces = {};
  nodeIds.forEach(id => { forces[id] = { fx: 0, fy: 0 }; });

  // Repulsion — all pairs
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const a = pos[nodeIds[i]], b = pos[nodeIds[j]];
      if (!a || !b) continue;
      const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
      const dist2 = dx * dx + dy * dy;
      const dist = Math.sqrt(dist2) || 0.01;
      const f = Math.min(6000 / dist2, 120);
      forces[nodeIds[i]].fx -= (dx / dist) * f;
      forces[nodeIds[i]].fy -= (dy / dist) * f;
      forces[nodeIds[j]].fx += (dx / dist) * f;
      forces[nodeIds[j]].fy += (dy / dist) * f;
    }
  }

  // Springs along edges
  edges.forEach(e => {
    const a = pos[e.source], b = pos[e.target];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const restLen = e.status === "unchanged" ? 110 : 90;
    const f = (dist - restLen) * 0.07;
    forces[e.source].fx += (dx / dist) * f;
    forces[e.source].fy += (dy / dist) * f;
    forces[e.target].fx -= (dx / dist) * f;
    forces[e.target].fy -= (dy / dist) * f;
  });

  // Center gravity
  nodeIds.forEach(id => {
    if (!pos[id]) return;
    forces[id].fx += (W / 2 - pos[id].x) * 0.012;
    forces[id].fy += (H / 2 - pos[id].y) * 0.012;
  });

  // Integrate
  nodeIds.forEach(id => {
    if (!pos[id]) return;
    const p = pos[id], f = forces[id];
    p.vx = (p.vx + f.fx * alpha) * 0.72;
    p.vy = (p.vy + f.fy * alpha) * 0.72;
    p.x = Math.max(NODE_R + 2, Math.min(W - NODE_R - 2, p.x + p.vx));
    p.y = Math.max(NODE_R + 2, Math.min(H - NODE_R - 2, p.y + p.vy));
  });
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DiffGraph({ nodes, edges, mode = "neighborhood" }) {
  const [positions, setPositions] = useState({});
  const [hovered, setHovered] = useState(null);
  const [dragging, setDragging] = useState(null); // id of dragged node
  const posRef = useRef({});
  const rafRef = useRef();
  const iterRef = useRef(0);
  const draggingRef = useRef(null);

  // Filter edges by mode
  const visibleEdges = mode === "changed-only"
    ? edges.filter(e => e.status !== "unchanged")
    : edges;

  const nodeIds = nodes.map(n => n.id);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = initPositions(nodes);
    iterRef.current = 0;

    function tick() {
      if (draggingRef.current) {
        // skip physics for dragged node's velocity
        iterRef.current++;
        const alpha = Math.max(0.005, 0.8 * Math.exp(-iterRef.current / 120));
        runTick(posRef.current, nodeIds, visibleEdges, alpha);
        if (draggingRef.current && posRef.current[draggingRef.current]) {
          // keep dragged node where the mouse placed it (done via mousemove)
        }
      } else {
        iterRef.current++;
        const alpha = Math.max(0.005, 0.8 * Math.exp(-iterRef.current / 120));
        runTick(posRef.current, nodeIds, visibleEdges, alpha);
      }
      setPositions({ ...posRef.current });
      if (iterRef.current < 400) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodes.map(n => n.id).join(","), visibleEdges.length, mode]);

  const svgRef = useRef();

  const handleMouseMove = useCallback((e) => {
    if (!draggingRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    if (posRef.current[draggingRef.current]) {
      posRef.current[draggingRef.current].x = x;
      posRef.current[draggingRef.current].y = y;
      posRef.current[draggingRef.current].vx = 0;
      posRef.current[draggingRef.current].vy = 0;
      // Restart sim if stopped
      if (iterRef.current >= 400) {
        iterRef.current = 350;
        cancelAnimationFrame(rafRef.current);
        function tick2() {
          iterRef.current++;
          const alpha = 0.1;
          runTick(posRef.current, nodeIds, visibleEdges, alpha);
          setPositions({ ...posRef.current });
          if (iterRef.current < 420) rafRef.current = requestAnimationFrame(tick2);
        }
        rafRef.current = requestAnimationFrame(tick2);
      }
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
  }, []);

  if (!nodes.length) return null;

  const addedCount = nodes.filter(n => n.status === "added").length;
  const removedCount = nodes.filter(n => n.status === "removed").length;
  const contextCount = nodes.filter(n => n.status === "context").length;

  return (
    <div>
      {/* Mini stats bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 12, alignItems: "center" }}>
        {[
          { label: "added", color: "#3fb950", count: addedCount },
          { label: "removed", color: "#f85149", count: removedCount },
          { label: "context", color: "#484f58", count: contextCount },
        ].map(({ label, color, count }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
            <span style={{ color }}>{count} {label}</span>
          </span>
        ))}
        <span style={{ color: "var(--text3)", marginLeft: "auto" }}>
          {visibleEdges.filter(e => e.status === "added").length} new edges ·{" "}
          {visibleEdges.filter(e => e.status === "removed").length} removed edges
        </span>
        <span style={{ color: "var(--text3)", fontSize: 11 }}>drag nodes to reposition</span>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", background: "#0d1117", borderRadius: 8, cursor: dragging ? "grabbing" : "default" }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Arrowhead markers */}
        <defs>
          {["added", "removed", "unchanged"].map(s => (
            <marker key={s} id={`arrow-${s}`} markerWidth="8" markerHeight="8"
              refX="18" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLOR[s]} fillOpacity={s === "unchanged" ? 0.4 : 0.8} />
            </marker>
          ))}
        </defs>

        {/* Edges */}
        {visibleEdges.map((e, i) => {
          const a = positions[e.source], b = positions[e.target];
          if (!a || !b) return null;
          const isUnchanged = e.status === "unchanged";
          return (
            <line key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={EDGE_COLOR[e.status]}
              strokeWidth={isUnchanged ? 1 : 1.8}
              strokeOpacity={isUnchanged ? 0.25 : 0.85}
              strokeDasharray={e.status === "removed" ? "5 3" : undefined}
              markerEnd={`url(#arrow-${e.status})`}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map(n => {
          const pos = positions[n.id];
          if (!pos) return null;
          const c = STATUS_COLOR[n.status] || STATUS_COLOR.context;
          const isHovered = hovered === n.id;
          const shortName = n.name.length > 22 ? n.name.slice(0, 20) + "…" : n.name;

          return (
            <g key={n.id}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={() => { draggingRef.current = n.id; setDragging(n.id); }}
              style={{ cursor: "grab" }}
            >
              {/* Glow for changed nodes */}
              {n.status !== "context" && (
                <circle cx={pos.x} cy={pos.y} r={NODE_R + 6}
                  fill={c.stroke} fillOpacity={0.12} />
              )}
              <circle cx={pos.x} cy={pos.y} r={NODE_R}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={isHovered ? 2.5 : (n.status !== "context" ? 2 : 1)}
              />
              {/* Dot in center for changed nodes */}
              {n.status !== "context" && (
                <circle cx={pos.x} cy={pos.y} r={3} fill={c.stroke} />
              )}
              {/* Label */}
              <text x={pos.x} y={pos.y + NODE_R + 11}
                fill={c.text}
                fontSize={isHovered ? 10 : 9}
                fontFamily="monospace"
                textAnchor="middle"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {shortName}
              </text>
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hovered && positions[hovered] && (() => {
          const n = nodes.find(x => x.id === hovered);
          const p = positions[hovered];
          if (!n) return null;
          const c = STATUS_COLOR[n.status] || STATUS_COLOR.context;
          const lines = [n.name, n.module, `${n.caller_count} callers · ${n.kind}`];
          const boxW = Math.max(...lines.map(l => l.length)) * 6.5 + 16;
          const boxH = lines.length * 16 + 12;
          const bx = Math.min(p.x + 14, W - boxW - 4);
          const by = Math.min(p.y - 10, H - boxH - 4);
          return (
            <g style={{ pointerEvents: "none" }}>
              <rect x={bx} y={by} width={boxW} height={boxH}
                fill="#161b22" stroke={c.stroke} strokeWidth={1} rx={4} fillOpacity={0.97} />
              {lines.map((line, i) => (
                <text key={i} x={bx + 8} y={by + 16 + i * 16}
                  fill={i === 0 ? c.text : "#8b949e"}
                  fontSize={i === 0 ? 11 : 10}
                  fontFamily="monospace"
                  fontWeight={i === 0 ? 600 : 400}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
