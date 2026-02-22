import { useContext, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

const LAYER_COLORS = [
  { bg: "#2d1f4e", border: "#a371f7", text: "#a371f7", label: "Foundation" },
  { bg: "#1f3a5f", border: "#58a6ff", text: "#58a6ff", label: "Platform" },
  { bg: "#1a3628", border: "#3fb950", text: "#3fb950", label: "Services" },
  { bg: "#3d2c1e", border: "#e3b341", text: "#e3b341", label: "Features" },
  { bg: "#21262d", border: "#484f58", text: "#8b949e", label: "Leaves" },
];

const CANVAS_W = 900;
const LAYER_H = 100;
const PADDING = 60;
const NODE_MIN_W = 40;
const NODE_MAX_W = 160;
const NODE_H = 36;
const COLUMN_W = 18;  // width of a load-bearing pillar

function Building({ nodes, edges, layerLabels, onNodeClick, selected }) {
  const layers = [0, 1, 2, 3, 4];
  // Group nodes by layer
  const byLayer = {};
  for (const n of nodes) {
    const l = n.layer ?? 4;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(n);
  }

  // Sort each layer: load-bearing first, then by caller_count desc
  for (const l of layers) {
    if (byLayer[l]) {
      byLayer[l].sort((a, b) => {
        if (a.is_load_bearing !== b.is_load_bearing) return b.is_load_bearing ? 1 : -1;
        return b.caller_count - a.caller_count;
      });
    }
  }

  // Assign x positions within each layer
  const nodePos = {};
  for (const l of layers) {
    const lnodes = byLayer[l] || [];
    const totalW = CANVAS_W - PADDING * 2;
    const spacing = lnodes.length > 0 ? totalW / lnodes.length : totalW;
    const nodeW = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, spacing - 6));
    lnodes.forEach((n, i) => {
      const x = PADDING + i * spacing + spacing / 2 - nodeW / 2;
      const y = PADDING + (4 - l) * (LAYER_H + 20) + (LAYER_H - NODE_H) / 2;
      nodePos[n.hash] = { x, y, w: nodeW, h: NODE_H, cx: x + nodeW / 2, cy: y + NODE_H / 2 };
    });
  }

  // Build edge index for quick lookup
  const edgeSet = new Set(edges.map(e => `${e.from}:${e.to}`));

  const totalH = PADDING * 2 + 5 * (LAYER_H + 20);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CANVAS_W} ${totalH}`}
      style={{ fontFamily: "-apple-system, sans-serif", display: "block" }}
    >
      {/* Background */}
      <rect width={CANVAS_W} height={totalH} fill="#0d1117" />

      {/* Floor lines */}
      {layers.map((l) => {
        const y = PADDING + (4 - l) * (LAYER_H + 20);
        const color = LAYER_COLORS[l];
        return (
          <g key={l}>
            {/* Floor slab */}
            <rect
              x={PADDING - 10} y={y - 2}
              width={CANVAS_W - PADDING * 2 + 20} height={LAYER_H + 4}
              rx={4} fill={color.bg} fillOpacity={0.25}
              stroke={color.border} strokeWidth={1} strokeOpacity={0.3}
            />
            {/* Layer label on left */}
            <text
              x={PADDING - 14} y={y + LAYER_H / 2 + 5}
              fill={color.text} fontSize={11} fontWeight={600}
              textAnchor="end" opacity={0.8}
            >
              {LAYER_COLORS[l].label}
            </text>
            {/* Floor number */}
            <text
              x={CANVAS_W - PADDING + 14} y={y + LAYER_H / 2 + 5}
              fill={color.text} fontSize={11}
              textAnchor="start" opacity={0.6}
            >
              L{l}
            </text>
          </g>
        );
      })}

      {/* Edges — drawn under nodes */}
      {edges.slice(0, 300).map((e, i) => {
        const a = nodePos[e.from];
        const b = nodePos[e.to];
        if (!a || !b) return null;
        // Only draw cross-layer edges for clarity
        const aLayer = nodes.find(n => n.hash === e.from)?.layer ?? 0;
        const bLayer = nodes.find(n => n.hash === e.to)?.layer ?? 0;
        if (Math.abs(aLayer - bLayer) === 0) return null;
        return (
          <line
            key={i}
            x1={a.cx} y1={a.y + a.h}
            x2={b.cx} y2={b.y}
            stroke="#30363d" strokeWidth={1} opacity={0.4}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const pos = nodePos[n.hash];
        if (!pos) return null;
        const isLB = n.is_load_bearing;
        const isUnexpected = !isLB && n.calling_module_count >= 3;
        const isSelected = selected === n.hash;
        const l = n.layer ?? 4;
        const color = LAYER_COLORS[l];

        if (isLB) {
          // Draw as architectural column/pillar
          const cx = pos.cx;
          const y = pos.y;
          const colH = LAYER_H - 4;
          return (
            <g key={n.hash} onClick={() => onNodeClick(n)} style={{ cursor: "pointer" }}>
              {/* Column shaft */}
              <rect
                x={cx - COLUMN_W / 2} y={y}
                width={COLUMN_W} height={colH - 10}
                fill={n.declaration === "explicit" ? "#2d1f4e" : "#1c1c2e"}
                stroke={isSelected ? "#fff" : "#a371f7"}
                strokeWidth={isSelected ? 2.5 : 1.5}
                rx={2}
              />
              {/* Column cap (capital) */}
              <rect
                x={cx - COLUMN_W / 2 - 6} y={y - 8}
                width={COLUMN_W + 12} height={8}
                fill="#a371f7" fillOpacity={0.8} rx={1}
              />
              {/* Column base */}
              <rect
                x={cx - COLUMN_W / 2 - 4} y={y + colH - 10}
                width={COLUMN_W + 8} height={6}
                fill="#a371f7" fillOpacity={0.5} rx={1}
              />
              {/* Name — rotated */}
              <text
                x={cx} y={y + (colH - 10) / 2}
                fill="#a371f7" fontSize={9} fontWeight={600}
                textAnchor="middle" dominantBaseline="middle"
                transform={`rotate(-90, ${cx}, ${y + (colH - 10) / 2})`}
                style={{ pointerEvents: "none" }}
              >
                {n.name.length > 18 ? n.name.slice(0, 16) + "…" : n.name}
              </text>
            </g>
          );
        }

        // Regular node — draw as floor block
        const bgColor = isUnexpected ? "#3d1f1f" : color.bg;
        const strokeColor = isUnexpected ? "#f85149" : (isSelected ? "#fff" : color.border);
        const textColor = isUnexpected ? "#f85149" : color.text;

        return (
          <g key={n.hash} onClick={() => onNodeClick(n)} style={{ cursor: "pointer" }}>
            <rect
              x={pos.x} y={pos.y}
              width={pos.w} height={pos.h}
              rx={4}
              fill={bgColor} fillOpacity={0.9}
              stroke={strokeColor}
              strokeWidth={isSelected ? 2 : 1}
            />
            {/* Caller-count indicator bar at bottom of block */}
            {n.caller_count > 0 && (
              <rect
                x={pos.x + 2} y={pos.y + pos.h - 4}
                width={Math.min(pos.w - 4, (n.caller_count / 20) * (pos.w - 4))}
                height={3} rx={1}
                fill={textColor} fillOpacity={0.6}
              />
            )}
            <text
              x={pos.cx} y={pos.cy}
              fill={textColor} fontSize={9} fontWeight={500}
              textAnchor="middle" dominantBaseline="middle"
              style={{ pointerEvents: "none" }}
            >
              {n.name.length > Math.floor(pos.w / 6) ? n.name.slice(0, Math.floor(pos.w / 6)) + "…" : n.name}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${PADDING}, ${totalH - 28})`}>
        <rect x={0} y={0} width={14} height={14} rx={2}
          fill="#2d1f4e" stroke="#a371f7" strokeWidth={1.5} />
        <text x={18} y={11} fill="#a371f7" fontSize={10}>Load-bearing (declared)</text>
        <rect x={140} y={0} width={14} height={14} rx={2}
          fill="#1c1c2e" stroke="#a371f777" strokeWidth={1.5} />
        <text x={158} y={11} fill="#8b949e" fontSize={10}>Load-bearing (auto)</text>
        <rect x={290} y={0} width={14} height={14} rx={2}
          fill="#3d1f1f" stroke="#f85149" strokeWidth={1} />
        <text x={308} y={11} fill="#f85149" fontSize={10}>Unexpected coupling</text>
      </g>
    </svg>
  );
}

export default function BuildingPage() {
  const { repoId } = useContext(RepoContext);
  const [selected, setSelected] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["building", repoId],
    queryFn: () => api.building(repoId),
  });

  const { data: nodeDetail } = useQuery({
    queryKey: ["node", repoId, selected],
    queryFn: () => api.node(repoId, selected),
    enabled: !!selected,
  });

  function handleNodeClick(node) {
    setSelected(node.hash);
    setSelectedNode(node);
  }

  if (isLoading) return <div className="loading">Computing structural layout…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const lbCount = nodes.filter(n => n.is_load_bearing).length;
  const unexpectedCount = nodes.filter(n => !n.is_load_bearing && n.calling_module_count >= 3).length;

  // Layer counts
  const layerCounts = [0,1,2,3,4].map(l => nodes.filter(n => n.layer === l).length);

  return (
    <div>
      <div className="page-header">
        <h1>🏗️ Structural Building View</h1>
        <p>
          The codebase as a building cross-section. Foundation at the bottom (most depended-upon),
          leaves at the top. Load-bearing nodes shown as architectural columns.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--blue)" }}>{nodes.length}</div>
          <div className="stat-label">Nodes shown</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--purple)" }}>{lbCount}</div>
          <div className="stat-label">Load-bearing columns</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{unexpectedCount}</div>
          <div className="stat-label">Unexpected coupling</div>
        </div>
        {layerCounts.map((count, l) => (
          <div key={l} className="stat-card">
            <div className="stat-value" style={{ color: LAYER_COLORS[l].text, fontSize: 22 }}>{count}</div>
            <div className="stat-label">{LAYER_COLORS[l].label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16 }}>
        {/* Building canvas */}
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          <Building
            nodes={nodes}
            edges={edges}
            layerLabels={data?.layer_labels || []}
            onNodeClick={handleNodeClick}
            selected={selected}
          />
        </div>

        {/* Detail panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {selectedNode ? (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: selectedNode.is_load_bearing ? "var(--purple)" : "var(--text2)", fontWeight: 600, marginBottom: 6 }}>
                {selectedNode.is_load_bearing ? "🏛 LOAD-BEARING" : "📦 NODE"}
              </div>
              <div style={{ fontFamily: "monospace", fontWeight: 700, marginBottom: 8, wordBreak: "break-all" }}>
                {selectedNode.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.8 }}>
                <div><strong>Module:</strong> {selectedNode.module}</div>
                <div><strong>Layer:</strong> {LAYER_COLORS[selectedNode.layer ?? 4]?.label}</div>
                <div><strong>Callers:</strong> {selectedNode.caller_count}</div>
                <div><strong>Called by modules:</strong> <span style={{ color: selectedNode.calling_module_count >= 5 ? "var(--red)" : "var(--text)" }}>{selectedNode.calling_module_count}</span></div>
                <div><strong>Declaration:</strong> {selectedNode.declaration}</div>
              </div>
              {nodeDetail && (
                <>
                  {nodeDetail.callers.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 4 }}>Callers</div>
                      <div style={{ maxHeight: 120, overflowY: "auto" }}>
                        {nodeDetail.callers.slice(0, 8).map(c => (
                          <div key={c.hash} style={{ fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--border)", fontFamily: "monospace", color: "var(--text2)" }}>
                            {c.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
              Click any node to inspect
            </div>
          )}

          {/* Layer guide */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Layer Guide</div>
            {LAYER_COLORS.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: c.bg, border: `1px solid ${c.border}`, flexShrink: 0 }} />
                <div style={{ color: c.text, fontWeight: 600, width: 80 }}>{c.label}</div>
                <div style={{ color: "var(--text3)", fontSize: 11 }}>
                  {["Most depended-upon", "Shared platform", "Domain services", "Feature code", "Leaf / entry"][i]}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 14, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Reading this view</div>
            <div><span style={{ color: "var(--purple)" }}>Columns</span> = load-bearing nodes. The wider the capital, the more they're called.</div>
            <div style={{ marginTop: 4 }}><span style={{ color: "var(--red)" }}>Red blocks</span> = unexpected coupling — code that isn't infrastructure but is being treated like it.</div>
            <div style={{ marginTop: 4 }}>Bar at bottom of each block = relative caller count.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
