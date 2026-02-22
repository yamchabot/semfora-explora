import { useContext, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RepoContext } from "../App";
import { api } from "../api";

export const LAYER_COLORS = [
  { bg: "#2d1f4e", border: "#a371f7", text: "#a371f7", label: "Foundation" },
  { bg: "#1f3a5f", border: "#58a6ff", text: "#58a6ff", label: "Platform" },
  { bg: "#1a3628", border: "#3fb950", text: "#3fb950", label: "Services" },
  { bg: "#3d2c1e", border: "#e3b341", text: "#e3b341", label: "Features" },
  { bg: "#21262d", border: "#484f58", text: "#8b949e", label: "Leaves" },
];

const CANVAS_W = 900;
const LAYER_H  = 110;   // height of each floor
const GAP      = 16;    // gap between floors
const PADDING  = 60;
const NODE_MIN_W = 36;
const NODE_MAX_W = 150;
const NODE_H   = 34;

// Column geometry constants
const SHAFT_W  = 22;
const CAP_W    = SHAFT_W + 18;  // flange extends 9px each side
const CAP_H    = 13;
const BASE_H   = 9;
const COL_PAD  = 5;             // top/bottom padding inside the layer band

function layerTopY(l) {
  return PADDING + (4 - l) * (LAYER_H + GAP);
}

// ── Column (load-bearing node) ───────────────────────────────────────────────
function Column({ cx, layerY, node, isSelected, onClick, diffStatus }) {
  const shaftH = LAYER_H - CAP_H - BASE_H - COL_PAD * 2;
  const capY   = layerY + COL_PAD;
  const shaftY = capY + CAP_H;
  const baseY  = shaftY + shaftH;
  const midY   = shaftY + shaftH / 2;

  const isExplicit = node.declaration === "explicit";

  // Color overrides for diff mode
  let capColor   = "#a371f7";
  let shaftFill  = isExplicit ? "#2d1f4e" : "#1c1c2e";
  let shaftStroke = isSelected ? "#fff" : "#a371f7";
  let baseColor  = "#a371f7";
  let opacity    = 1;
  if (diffStatus === "added")   { capColor = "#3fb950"; shaftFill = "#1a3628"; shaftStroke = "#3fb950"; baseColor = "#3fb950"; }
  if (diffStatus === "removed") { capColor = "#f85149"; shaftFill = "#3d1f1f"; shaftStroke = "#f85149"; baseColor = "#f85149"; opacity = 0.7; }
  if (diffStatus === "common")  { opacity = 0.55; }

  const maxChars = Math.floor(shaftH / 7);
  const label = node.name.length > maxChars ? node.name.slice(0, maxChars - 1) + "…" : node.name;

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }} opacity={opacity}>
      {/* Glow for selected */}
      {isSelected && (
        <rect x={cx - CAP_W / 2 - 3} y={capY - 2}
          width={CAP_W + 6} height={LAYER_H - COL_PAD * 2 + 4}
          fill="none" stroke="white" strokeWidth={1.5} rx={3} strokeDasharray="3 2" />
      )}
      {/* Capital (top flange) — the wide part that "supports" the floor above */}
      <rect x={cx - CAP_W / 2} y={capY}
        width={CAP_W} height={CAP_H}
        fill={capColor} fillOpacity={isExplicit ? 0.9 : 0.65} rx={2} />
      {/* Shaft */}
      <rect x={cx - SHAFT_W / 2} y={shaftY}
        width={SHAFT_W} height={shaftH}
        fill={shaftFill} stroke={shaftStroke} strokeWidth={isSelected ? 2.5 : 1.5} />
      {/* Base (bottom flange) */}
      <rect x={cx - CAP_W / 2 + 4} y={baseY}
        width={CAP_W - 8} height={BASE_H}
        fill={baseColor} fillOpacity={0.5} rx={1} />
      {/* Name — rotated inside shaft */}
      <text x={cx} y={midY}
        fill={capColor} fillOpacity={Math.min(1, opacity + 0.2)}
        fontSize={8} fontWeight={600}
        textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(-90,${cx},${midY})`}
        style={{ pointerEvents: "none", userSelect: "none" }}>
        {label}
      </text>
    </g>
  );
}

// ── Block (regular node) ─────────────────────────────────────────────────────
function Block({ pos, node, isSelected, onClick, diffStatus }) {
  const isUnexpected = !node.is_load_bearing && (node.calling_module_count || 0) >= 3;
  const l = node.layer ?? 4;
  const color = LAYER_COLORS[l];

  let bgColor     = isUnexpected ? "#3d1f1f" : color.bg;
  let strokeColor = isUnexpected ? "#f85149" : (isSelected ? "#fff" : color.border);
  let textColor   = isUnexpected ? "#f85149" : color.text;
  let opacity     = 1;

  if (diffStatus === "added")   { bgColor = "#1a3628"; strokeColor = "#3fb950"; textColor = "#3fb950"; }
  if (diffStatus === "removed") { bgColor = "#3d1f1f"; strokeColor = "#f85149"; textColor = "#f85149"; opacity = 0.65; }
  if (diffStatus === "common")  { opacity = 0.5; }

  const callerBar = node.caller_count > 0
    ? Math.min(pos.w - 6, (node.caller_count / 20) * (pos.w - 6))
    : 0;

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }} opacity={opacity}>
      <rect x={pos.x} y={pos.y} width={pos.w} height={pos.h}
        rx={3} fill={bgColor} fillOpacity={0.92}
        stroke={strokeColor} strokeWidth={isSelected ? 2 : 1} />
      {callerBar > 0 && (
        <rect x={pos.x + 3} y={pos.y + pos.h - 4}
          width={callerBar} height={3} rx={1}
          fill={textColor} fillOpacity={0.5} />
      )}
      {diffStatus === "removed" && (
        <line x1={pos.x + 4} y1={pos.y + pos.h / 2}
          x2={pos.x + pos.w - 4} y2={pos.y + pos.h / 2}
          stroke={strokeColor} strokeWidth={1.5} strokeOpacity={0.7} />
      )}
      <text x={pos.x + pos.w / 2} y={pos.y + pos.h / 2}
        fill={textColor} fontSize={9} fontWeight={500}
        textAnchor="middle" dominantBaseline="middle"
        style={{ pointerEvents: "none", userSelect: "none" }}>
        {node.name.length > Math.floor(pos.w / 6)
          ? node.name.slice(0, Math.floor(pos.w / 6)) + "…"
          : node.name}
      </text>
    </g>
  );
}

// ── BuildingCanvas — shared by both BuildingPage and DiffBuildingView ────────
export function BuildingCanvas({ nodes, edges, onNodeClick, selected, getDiffStatus }) {
  const layers = [0, 1, 2, 3, 4];
  const byLayer = {};
  for (const n of nodes) {
    const l = n.layer ?? 4;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(n);
  }
  for (const l of layers) {
    if (byLayer[l]) {
      byLayer[l].sort((a, b) => {
        if (a.is_load_bearing !== b.is_load_bearing) return b.is_load_bearing ? 1 : -1;
        return b.caller_count - a.caller_count;
      });
    }
  }

  // Assign x positions
  const nodePos = {};  // hash -> {x, y, w, h, cx, cy, layerTopY}
  for (const l of layers) {
    const lnodes = byLayer[l] || [];
    const totalW = CANVAS_W - PADDING * 2;
    const spacing = lnodes.length > 0 ? totalW / lnodes.length : totalW;
    const nodeW = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, spacing - 6));
    const ltY = layerTopY(l);
    lnodes.forEach((n, i) => {
      const cx = PADDING + i * spacing + spacing / 2;
      const blockY = ltY + (LAYER_H - NODE_H) / 2;
      nodePos[n.hash] = {
        x: cx - nodeW / 2,
        y: blockY,
        w: nodeW,
        h: NODE_H,
        cx,
        cy: blockY + NODE_H / 2,
        ltY,
      };
    });
  }

  const totalH = PADDING * 2 + 5 * (LAYER_H + GAP);

  return (
    <svg width="100%" viewBox={`0 0 ${CANVAS_W} ${totalH}`}
      style={{ display: "block", fontFamily: "-apple-system, sans-serif" }}>
      <rect width={CANVAS_W} height={totalH} fill="#0d1117" />

      {/* Floor slabs */}
      {layers.map((l) => {
        const y = layerTopY(l);
        const c = LAYER_COLORS[l];
        return (
          <g key={l}>
            <rect x={PADDING - 10} y={y} width={CANVAS_W - PADDING * 2 + 20} height={LAYER_H}
              rx={4} fill={c.bg} fillOpacity={0.2}
              stroke={c.border} strokeWidth={1} strokeOpacity={0.25} />
            <text x={PADDING - 14} y={y + LAYER_H / 2 + 4}
              fill={c.text} fontSize={11} fontWeight={600} textAnchor="end" opacity={0.75}>
              {c.label}
            </text>
            <text x={CANVAS_W - PADDING + 12} y={y + LAYER_H / 2 + 4}
              fill={c.text} fontSize={10} textAnchor="start" opacity={0.5}>
              L{l}
            </text>
          </g>
        );
      })}

      {/* Cross-layer edges */}
      {edges.slice(0, 300).map((e, i) => {
        const a = nodePos[e.from];
        const b = nodePos[e.to];
        if (!a || !b) return null;
        const na = nodes.find(n => n.hash === e.from);
        const nb = nodes.find(n => n.hash === e.to);
        if ((na?.layer ?? 0) === (nb?.layer ?? 0)) return null;
        const edgeColor = e.diff_status === "added"   ? "#3fb950"
                        : e.diff_status === "removed" ? "#f85149"
                        : "#30363d";
        const edgeOpacity = e.diff_status ? 0.55 : 0.35;
        return (
          <line key={i} x1={a.cx} y1={a.ltY + LAYER_H} x2={b.cx} y2={b.ltY}
            stroke={edgeColor} strokeWidth={1} opacity={edgeOpacity} />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const pos = nodePos[n.hash];
        if (!pos) return null;
        const diffStatus = getDiffStatus ? getDiffStatus(n) : null;
        const isSelected = selected === n.hash;

        if (n.is_load_bearing) {
          return (
            <Column key={n.hash}
              cx={pos.cx} layerY={pos.ltY}
              node={n} isSelected={isSelected}
              onClick={() => onNodeClick(n)}
              diffStatus={diffStatus} />
          );
        }
        return (
          <Block key={n.hash}
            pos={pos} node={n} isSelected={isSelected}
            onClick={() => onNodeClick(n)}
            diffStatus={diffStatus} />
        );
      })}

      {/* Legend */}
      <g transform={`translate(${PADDING},${totalH - 26})`}>
        {[
          { x: 0,   fill: "#2d1f4e", stroke: "#a371f7", label: "Load-bearing (declared)" },
          { x: 155, fill: "#1c1c2e", stroke: "#a371f777", label: "Load-bearing (auto)" },
          { x: 290, fill: "#3d1f1f", stroke: "#f85149", label: "Unexpected coupling" },
        ].map(({ x, fill, stroke, label }) => (
          <g key={label} transform={`translate(${x},0)`}>
            <rect width={13} height={13} rx={2} fill={fill} stroke={stroke} strokeWidth={1.5} />
            <text x={17} y={10} fill="#8b949e" fontSize={10}>{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// ── Load-bearing node row (shared with bottom lists) ─────────────────────────
function LBNodeRow({ node, onDeclare, onUndeclare }) {
  const isExplicit = node.declaration === "explicit";
  const isUnexpected = !node.is_load_bearing;
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{node.name}</span>
          {isExplicit && (
            <span style={{ background: "var(--purple-bg)", color: "var(--purple)",
              fontSize: 10, padding: "1px 7px", borderRadius: 12, fontWeight: 600 }}>
              🏛 declared
            </span>
          )}
          {!isExplicit && node.is_load_bearing && (
            <span style={{ background: "var(--bg3)", color: "var(--text2)",
              fontSize: 10, padding: "1px 7px", borderRadius: 12 }}>
              auto-detected
            </span>
          )}
          {isUnexpected && (
            <span style={{ background: "var(--red-bg)", color: "var(--red)",
              fontSize: 10, padding: "1px 7px", borderRadius: 12, fontWeight: 600 }}>
              ⚠ unexpected
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)" }}>
          {node.module}
          <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
          <span style={{ color: node.calling_module_count >= 5 ? "var(--red)" : "var(--yellow)" }}>
            {node.calling_module_count} modules
          </span>
          <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
          {node.caller_count} callers
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {isExplicit ? (
          <button className="btn btn-sm btn-ghost"
            style={{ borderColor: "var(--red)", color: "var(--red)", fontSize: 11 }}
            onClick={() => onUndeclare(node.hash)}>
            undeclare
          </button>
        ) : (
          <button className="btn btn-sm"
            style={{ background: "var(--purple-bg)", color: "var(--purple)",
              border: "1px solid var(--purple)", fontSize: 11 }}
            onClick={() => onDeclare(node.hash)}>
            🏛 declare
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main BuildingPage ────────────────────────────────────────────────────────
export default function BuildingPage() {
  const { repoId } = useContext(RepoContext);
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [lbThreshold, setLbThreshold] = useState(3);
  const [moduleInput, setModuleInput] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["building", repoId],
    queryFn: () => api.building(repoId),
  });

  const { data: lbData } = useQuery({
    queryKey: ["load-bearing", repoId, lbThreshold],
    queryFn: () => api.loadBearing(repoId, lbThreshold),
  });

  const { data: nodeDetail } = useQuery({
    queryKey: ["node", repoId, selected],
    queryFn: () => api.node(repoId, selected),
    enabled: !!selected,
  });

  const declare = useMutation({
    mutationFn: ({ hash, module, remove }) => api.lbDeclare(repoId, hash, module, remove),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["load-bearing", repoId] });
      qc.invalidateQueries({ queryKey: ["building", repoId] });
    },
  });

  function handleNodeClick(node) {
    setSelected(node.hash);
    setSelectedNode(node);
  }

  function declareModule() {
    const m = moduleInput.trim();
    if (m) { declare.mutate({ module: m, remove: false }); setModuleInput(""); }
  }

  if (isLoading) return <div className="loading">Computing structural layout…</div>;
  if (error) return <div className="error">{error.message}</div>;

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const lbCount = nodes.filter(n => n.is_load_bearing).length;
  const unexpectedCount = nodes.filter(n => !n.is_load_bearing && n.calling_module_count >= 3).length;
  const layerCounts = [0, 1, 2, 3, 4].map(l => nodes.filter(n => n.layer === l).length);

  const declaredNodes  = lbData?.declared_load_bearing || [];
  const unexpectedNodes = lbData?.unexpected_load_bearing || [];
  const declaredModules = lbData?.config?.declared_modules || [];

  // Live declaration status for selected node (from lbData, more up-to-date than building snapshot)
  const selectedLbInfo = selectedNode
    ? [...declaredNodes, ...unexpectedNodes].find(n => n.hash === selectedNode.hash)
    : null;
  const isExplicitlyDeclared = selectedLbInfo?.declaration === "explicit"
    || selectedNode?.declaration === "explicit";

  return (
    <div>
      <div className="page-header">
        <h1>🏗️ Building View</h1>
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

      {/* ── Main canvas + sidebar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16 }}>
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          <BuildingCanvas
            nodes={nodes} edges={edges}
            onNodeClick={handleNodeClick}
            selected={selected}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* ── Node detail + declare button ── */}
          {selectedNode ? (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11,
                  color: selectedNode.is_load_bearing ? "var(--purple)" : "var(--text2)",
                  fontWeight: 600 }}>
                  {selectedNode.is_load_bearing ? "🏛 LOAD-BEARING" : "📦 NODE"}
                </span>
                {selectedNode.declaration === "explicit" && (
                  <span style={{ fontSize: 10, background: "var(--purple-bg)", color: "var(--purple)",
                    padding: "1px 7px", borderRadius: 12, fontWeight: 600 }}>
                    declared
                  </span>
                )}
                {selectedNode.declaration === "auto" && (
                  <span style={{ fontSize: 10, background: "var(--bg3)", color: "var(--text3)",
                    padding: "1px 7px", borderRadius: 12 }}>
                    auto
                  </span>
                )}
              </div>

              <div style={{ fontFamily: "monospace", fontWeight: 700, marginBottom: 8,
                wordBreak: "break-all", fontSize: 13 }}>
                {selectedNode.name}
              </div>

              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.9, marginBottom: 12 }}>
                <div><strong>Module:</strong> {selectedNode.module}</div>
                <div><strong>Layer:</strong> {LAYER_COLORS[selectedNode.layer ?? 4]?.label}</div>
                <div><strong>Callers:</strong> {selectedNode.caller_count}</div>
                <div><strong>Called by modules:</strong>{" "}
                  <span style={{ color: selectedNode.calling_module_count >= 5 ? "var(--red)" : "var(--text)" }}>
                    {selectedNode.calling_module_count}
                  </span>
                </div>
              </div>

              {/* ── Declare / Undeclare button ── */}
              {isExplicitlyDeclared ? (
                <button className="btn btn-sm btn-ghost" style={{ width: "100%",
                  borderColor: "var(--red)", color: "var(--red)", fontSize: 12 }}
                  onClick={() => declare.mutate({ hash: selectedNode.hash, remove: true })}>
                  Undeclare load-bearing
                </button>
              ) : (
                <button className="btn btn-sm" style={{ width: "100%",
                  background: "var(--purple-bg)", color: "var(--purple)",
                  border: "1px solid var(--purple)", fontSize: 12 }}
                  onClick={() => declare.mutate({ hash: selectedNode.hash, remove: false })}>
                  🏛 Declare load-bearing
                </button>
              )}

              {nodeDetail?.callers?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 4 }}>
                    Callers
                  </div>
                  <div style={{ maxHeight: 110, overflowY: "auto" }}>
                    {nodeDetail.callers.slice(0, 8).map(c => (
                      <div key={c.hash} style={{ fontSize: 11, padding: "3px 0",
                        borderBottom: "1px solid var(--border)", fontFamily: "monospace",
                        color: "var(--text2)" }}>
                        {c.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: 20, textAlign: "center",
              color: "var(--text3)", fontSize: 12 }}>
              Click any node to inspect
            </div>
          )}

          {/* ── Layer Guide ── */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Layer Guide</div>
            {LAYER_COLORS.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
                marginBottom: 6, fontSize: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2,
                  background: c.bg, border: `1px solid ${c.border}`, flexShrink: 0 }} />
                <div style={{ color: c.text, fontWeight: 600, width: 76 }}>{c.label}</div>
                <div style={{ color: "var(--text3)", fontSize: 11 }}>
                  {["Most depended-upon", "Shared platform", "Domain services", "Feature code", "Leaf / entry"][i]}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 14, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Reading this view</div>
            <div><span style={{ color: "var(--purple)" }}>Columns</span> = load-bearing — cap rests on the floor above.</div>
            <div style={{ marginTop: 4 }}><span style={{ color: "var(--red)" }}>Red blocks</span> = unexpected coupling.</div>
            <div style={{ marginTop: 4 }}>Bottom bar on blocks = relative caller count.</div>
          </div>
        </div>
      </div>

      {/* ── Load-bearing lists ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>

        {/* Concept row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
          <div style={{ background: "var(--purple-bg)", border: "1px solid var(--purple)44",
            borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontWeight: 600, color: "var(--purple)", marginBottom: 6 }}>
              🏛 Load-Bearing (Expected)
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Infrastructure intentionally shared across the codebase — gateways, DB clients, core utils.
              High centrality here is <em>by design</em>.
            </div>
          </div>
          <div style={{ background: "var(--red-bg)", border: "1px solid var(--red)44",
            borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontWeight: 600, color: "var(--red)", marginBottom: 6 }}>
              ⚠ Unexpected Coupling
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Business logic or feature code quietly becoming a dependency of everything else.
              Wasn't designed to bear weight — will resist refactoring.
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>Min modules calling:</span>
            <select value={lbThreshold} onChange={e => setLbThreshold(+e.target.value)}
              style={{ width: 60, fontSize: 12 }}>
              {[2, 3, 4, 5, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, maxWidth: 440 }}>
            <input
              style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
              placeholder="Declare entire module, e.g. src.core"
              value={moduleInput}
              onChange={e => setModuleInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && declareModule()}
            />
            <button className="btn btn-sm"
              style={{ background: "var(--purple-bg)", color: "var(--purple)",
                border: "1px solid var(--purple)", fontSize: 11, flexShrink: 0 }}
              onClick={declareModule}>
              🏛 Declare module
            </button>
          </div>
          {declaredModules.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {declaredModules.map(m => (
                <span key={m} style={{ display: "flex", alignItems: "center", gap: 4,
                  background: "var(--purple-bg)", border: "1px solid var(--purple)44",
                  borderRadius: 12, padding: "2px 10px", fontSize: 11 }}>
                  <span style={{ fontFamily: "monospace", color: "var(--purple)" }}>{m}</span>
                  <button style={{ background: "none", border: "none", color: "var(--red)",
                    cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1 }}
                    onClick={() => declare.mutate({ module: m, remove: true })}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Unexpected */}
        {unexpectedNodes.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--red)", margin: 0 }}>
                ⚠ Unexpected Load-Bearing
              </h2>
              <span style={{ fontSize: 12, color: "var(--text2)" }}>
                ({unexpectedNodes.length}) — click 🏛 Declare if intentional
              </span>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {unexpectedNodes.map(n => (
                <LBNodeRow key={n.hash} node={n}
                  onDeclare={hash => declare.mutate({ hash, remove: false })}
                  onUndeclare={hash => declare.mutate({ hash, remove: true })} />
              ))}
            </div>
          </div>
        )}

        {/* Declared load-bearing */}
        {declaredNodes.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--purple)", marginBottom: 10 }}>
              🏛 Load-Bearing Nodes ({declaredNodes.length})
            </h2>
            <div className="card" style={{ overflow: "hidden" }}>
              {declaredNodes.map(n => (
                <LBNodeRow key={n.hash} node={n}
                  onDeclare={hash => declare.mutate({ hash, remove: false })}
                  onUndeclare={hash => declare.mutate({ hash, remove: true })} />
              ))}
            </div>
          </div>
        )}

        {declaredNodes.length === 0 && unexpectedNodes.length === 0 && lbData && (
          <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--text2)" }}>
            No nodes found called from {lbThreshold}+ distinct modules. Try lowering the threshold.
          </div>
        )}
      </div>
    </div>
  );
}
