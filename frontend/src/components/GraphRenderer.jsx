import { useState, useRef, useEffect, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { measureKey, measureLabel } from "../utils/measureUtils.js";
import { lerpColor, makeStepColors, makeStepWidths, makeStepArrows } from "../utils/colorUtils.js";
import { bfsFromNode, buildAdjacencyMaps, convexHull, findChainEdges, collectChainNodeIds } from "../utils/graphAlgo.js";
import { buildGraphData } from "../utils/graphData.js";

// ── Canvas helpers ──────────────────────────────────────────────────────────────

function drawPill(ctx, cx, cy, w, h) {
  const r = h / 2;
  ctx.beginPath();
  // Right cap (clockwise: top → bottom), then implicit line to left cap start,
  // then left cap (clockwise: bottom → top), then closePath draws top line back.
  ctx.arc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.arc(cx - w / 2 + r, cy, r,  Math.PI / 2, Math.PI * 1.5, false);
  ctx.closePath();
}

const MAX_LABEL = 22;

const BLOB_PALETTE = ["#58a6ff","#3fb950","#e3b341","#f85149","#a371f7","#39c5cf","#ff7b54","#56d364"];

// Draw a smooth blob (filled + stroked) around hull points
function drawBlob(ctx, hull, padding, lineWidth, color) {
  if (!hull?.length) return;
  // Expand each point outward from centroid
  const cx = hull.reduce((s,p)=>s+p[0],0) / hull.length;
  const cy = hull.reduce((s,p)=>s+p[1],0) / hull.length;
  let exp = hull.map(([x,y]) => {
    const dx=x-cx, dy=y-cy, len=Math.sqrt(dx*dx+dy*dy)||1;
    return [x+dx/len*padding, y+dy/len*padding];
  });

  // 2-point degenerate case: the two expanded points are collinear with the
  // centroid, so all bezier midpoints collapse to the same location and the
  // path has zero area (renders as a line, not a blob).
  // Fix: insert two perpendicular "wing" points to form a 4-point diamond,
  // which the bezier smoother then rounds into a proper oval.
  if (exp.length === 2) {
    const dx  = exp[1][0] - exp[0][0];
    const dy  = exp[1][1] - exp[0][1];
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const wing = padding * 0.65;         // perpendicular bulge ≈ 65% of padding
    const nx   = -dy / len * wing;       // perpendicular unit × wing
    const ny   =  dx / len * wing;

    const mx   = (exp[0][0] + exp[1][0]) / 2;
    const my   = (exp[0][1] + exp[1][1]) / 2;
    exp = [exp[0], [mx + nx, my + ny], exp[1], [mx - nx, my - ny]];
  }

  const n = exp.length;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(exp[0][0], exp[0][1], padding, 0, Math.PI*2);
  } else {
    // Smooth path: move to midpoint of each edge, quadratic through vertex
    const mid = i => [(exp[i][0]+exp[(i+1)%n][0])/2, (exp[i][1]+exp[(i+1)%n][1])/2];
    const m0 = mid(0);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid((i+1)%n);
      ctx.quadraticCurveTo(exp[(i+1)%n][0], exp[(i+1)%n][1], m[0], m[1]);
    }
  }
  ctx.closePath();
  ctx.fillStyle   = color + "1e";   // ~12% opacity fill
  ctx.fill();
  ctx.strokeStyle = color + "66";   // ~40% opacity stroke
  ctx.lineWidth   = lineWidth;
  ctx.stroke();
}

// Custom d3 force: pulls each node toward its group's centroid
export function makeGroupCentroidForce(strength) {
  let _nodes = [];
  function force(alpha) {
    const centroids = new Map();
    for (const n of _nodes) {
      if (!n.group) continue;
      if (!centroids.has(n.group)) centroids.set(n.group, {x:0, y:0, count:0});
      const c = centroids.get(n.group);
      c.x += n.x; c.y += n.y; c.count++;
    }
    for (const c of centroids.values()) { c.x /= c.count; c.y /= c.count; }
    for (const n of _nodes) {
      if (!n.group) continue;
      const c = centroids.get(n.group);
      if (!c) continue;
      n.vx += (c.x - n.x) * strength * alpha;
      n.vy += (c.y - n.y) * strength * alpha;
    }
  }
  force.initialize = nodes => { _nodes = nodes; };
  return force;
}

/**
 * Single-select physics: pull BFS-reachable nodes to concentric rings around the
 * pinned selected node (depth 1 → radius radiusPer, depth 2 → 2×radiusPer, …).
 */
export function makeSelectionRadialForce(selectedId, bfsDists, radiusPer) {
  let simNodes = [];
  function force(alpha) {
    const sel = simNodes.find(n => n.id === selectedId);
    if (!sel || sel.x == null) return;
    for (const n of simNodes) {
      if (n.id === selectedId || n.x == null) continue;
      const depth = bfsDists.get(n.id);
      if (depth == null) continue;
      const dx = n.x - sel.x, dy = n.y - sel.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const target = depth * radiusPer;
      const k = alpha * 0.14;
      n.vx += (dx / dist) * (target - dist) * k;
      n.vy += (dy / dist) * (target - dist) * k;
    }
  }
  force.initialize = ns => { simNodes = ns; };
  return force;
}

/**
 * Multi-select physics: pull chain nodes toward the centroid of all selected nodes,
 * with strength proportional to alpha.
 */
export function makeChainCentroidForce(selectedIds, chainIds) {
  let simNodes = [];
  function force(alpha) {
    const sels = simNodes.filter(n => selectedIds.has(n.id) && n.x != null);
    if (!sels.length) return;
    const cx = sels.reduce((s, n) => s + n.x, 0) / sels.length;
    const cy = sels.reduce((s, n) => s + n.y, 0) / sels.length;
    for (const n of simNodes) {
      if (selectedIds.has(n.id) || !chainIds.has(n.id) || n.x == null) continue;
      n.vx += (cx - n.x) * alpha * 0.06;
      n.vy += (cy - n.y) * alpha * 0.06;
    }
  }
  force.initialize = ns => { simNodes = ns; };
  return force;
}

// ── GraphRenderer ──────────────────────────────────────────────────────────────

export default function GraphRenderer({ data, measures, onNodeClick,
  minWeight, setMinWeight, topK, setTopK,
  colorKeyOverride, setColorKeyOverride, fanOutDepth, setFanOutDepth,
  selectedNodeIds, setSelectedNodeIds, hideIsolated, setHideIsolated,
  controlsH = 0, fillViewport = false,
  nodeColorOverrides = null,   // Map<nodeId, cssColor> — bypasses metric gradient
  edgeColorOverrides = null,   // Map<"src|tgt", cssColor> — bypasses step/chain colors
}) {
  const containerRef  = useRef(null);
  const fgRef         = useRef(null);
  const [size, setSize] = useState({
    w: 800,
    h: fillViewport ? (window.innerHeight || 800) : 640,
  });
  const [showSearch, setShowSearch]   = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Coupling mode: set of node ids that have ≥1 cross-boundary outgoing edge.
  // Active only in blob mode. Independent of selectedNodeIds.
  const [couplingIds, setCouplingIds] = useState(new Set());
  // Spread: scales charge repulsion and link distance together.
  // 350 = default; higher = more spread; lower = tighter.
  const SPREAD_DEFAULT = 350;
  const [forceSpread, setForceSpread] = useState(SPREAD_DEFAULT);
  const zoomTransformRef  = useRef({ k: 1, x: 0, y: 0 });
  const didOffsetRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const h = e.contentRect.height > 100 ? e.contentRect.height
        : fillViewport ? (window.innerHeight || 800)
        : Math.max(600, Math.round(w * 0.68));
      setSize({ w, h });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillViewport]);

  const types     = data?.measure_types || {};
  const isBlobMode = (data?.dimensions?.length ?? 0) >= 2;
  const dim0      = data?.dimensions?.[0];   // outer dim (blob groups in blob mode, node dim in 1d)
  const dim1      = data?.dimensions?.[1];   // inner dim (nodes in blob mode)

  // Resolve color key: override if valid, else first measure
  const allMKeys = measures.map(measureKey);
  const colorKey = (colorKeyOverride && allMKeys.includes(colorKeyOverride))
    ? colorKeyOverride
    : (allMKeys[0] ?? null);

  const sizeKey = (() => {
    const m = measures.find(m => m.special === "symbol_count") || measures[0];
    return m ? measureKey(m) : null;
  })();

  // Min/max across all value rows (leaf rows in blob mode, top-level otherwise)
  const colorStats = useMemo(() => {
    if (!colorKey || !data?.rows) return { min: 0, max: 1 };
    const rows = isBlobMode ? data.rows.flatMap(r => r.children || []) : data.rows;
    const vals = rows.map(r => r.values[colorKey]).filter(v => v != null && isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    const mn = Math.min(...vals), mx = Math.max(...vals);
    return { min: mn, max: mx === mn ? mn + 1 : mx };
  }, [colorKey, data, isBlobMode]);

  // Map outer-dim value → blob color
  const groupColorMap = useMemo(() => {
    if (!isBlobMode || !data?.rows) return new Map();
    return new Map(data.rows.map((r, i) => [r.key[dim0], BLOB_PALETTE[i % BLOB_PALETTE.length]]));
  }, [isBlobMode, data, dim0]);

  const graphData = useMemo(
    () => buildGraphData(data, { minWeight, topK, colorKey, colorStats, sizeKey, hideIsolated }),
    [data, minWeight, topK, colorKey, colorStats, sizeKey, hideIsolated],
  );

  // Reset coupling view when the underlying API data changes (new repo, dims, etc.).
  // Depends on `data` (the prop) rather than `graphData` (derived useMemo) so that
  // Vite's optimiser cannot hoist this effect above the graphData declaration and
  // trigger a TDZ on the minified variable name in production builds.
  useEffect(() => { setCouplingIds(new Set()); }, [data]);

  // Build forward + reverse adjacency maps from current graph links
  const { fwdAdj, bwdAdj } = useMemo(
    () => buildAdjacencyMaps(graphData.links),
    [graphData.links]
  );

  // Single-select: BFS in both directions so we see callers AND callees.
  // fwdDistances  — nodes the selected node reaches (calls)
  // bwdDistances  — nodes that reach the selected node (callers)
  // allDistances  — merged (min depth), used for dimming + radial-ring physics
  const fwdDistances = useMemo(() => {
    if (selectedNodeIds.size !== 1) return new Map();
    return bfsFromNode([...selectedNodeIds][0], fwdAdj, fanOutDepth);
  }, [selectedNodeIds, fwdAdj, fanOutDepth]);

  const bwdDistances = useMemo(() => {
    if (selectedNodeIds.size !== 1) return new Map();
    return bfsFromNode([...selectedNodeIds][0], bwdAdj, fanOutDepth);
  }, [selectedNodeIds, bwdAdj, fanOutDepth]);

  // Merged map: a node is "reachable" if it appears in either direction.
  // Depth = min(fwd, bwd) so the radial force places nodes on the nearest ring.
  const allDistances = useMemo(() => {
    if (selectedNodeIds.size !== 1) return new Map();
    const merged = new Map(fwdDistances);
    for (const [id, d] of bwdDistances) {
      const existing = merged.get(id);
      if (existing == null || d < existing) merged.set(id, d);
    }
    return merged;
  }, [fwdDistances, bwdDistances, selectedNodeIds]);

  // Keep the old name as an alias so the rest of the file (chain mode etc.)
  // that still references bfsDistances compiles without a rename sweep.
  const bfsDistances = allDistances;

    // Multi-select chain mode — delegates to findChainEdges in graphAlgo.js
  // (see that module for full algorithm documentation)
  const chainEdgeMap = useMemo(
    () => findChainEdges([...selectedNodeIds], fwdAdj, bwdAdj, graphData.links, fanOutDepth),
    [selectedNodeIds, fwdAdj, bwdAdj, graphData.links, fanOutDepth]
  );

  // Nodes on at least one connecting chain (+ selected endpoints)
  const chainNodeIds = useMemo(
    () => collectChainNodeIds(chainEdgeMap, [...selectedNodeIds]),
    [chainEdgeMap, selectedNodeIds]
  );

  // Base link distance — scales with forceSpread so selection physics stays consistent
  const linkDistBase = Math.round(120 * (forceSpread / SPREAD_DEFAULT));

  // Dynamic step arrays — recomputed when fanOutDepth changes
  const stepColors = useMemo(() => makeStepColors(fanOutDepth), [fanOutDepth]);
  const stepWidths = useMemo(() => makeStepWidths(fanOutDepth), [fanOutDepth]);
  const stepArrows = useMemo(() => makeStepArrows(fanOutDepth), [fanOutDepth]);

  // ── Coupling mode ─────────────────────────────────────────────────────────
  // The set of edges that cross blob-group boundaries (src.group ≠ tgt.group).
  // Only meaningful in blob mode; empty set otherwise.
  const crossEdgeSet = useMemo(() => {
    if (!graphData.isBlobMode) return new Set();
    const nodeGroup = new Map(graphData.nodes.map(n => [n.id, n.group]));
    const set = new Set();
    for (const link of graphData.links) {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      const sg = nodeGroup.get(src), tg = nodeGroup.get(tgt);
      if (sg != null && tg != null && sg !== tg) set.add(`${src}|${tgt}`);
    }
    return set;
  }, [graphData]);

  function handleCouplingToggle() {
    if (couplingIds.size > 0) { setCouplingIds(new Set()); return; }
    // Compute nodes that are the source of ≥1 cross-boundary edge
    const sources = new Set();
    for (const key of crossEdgeSet) sources.add(key.split("|")[0]);
    setCouplingIds(sources);
  }

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-forceSpread).distanceMax(Math.round(400 * forceSpread / SPREAD_DEFAULT));
    const link = fg.d3Force("link");
    if (link) link.distance(linkDistBase);
    fg.d3Force("groupCentroid", graphData.isBlobMode ? makeGroupCentroidForce(0.1) : null);
    fg.d3ReheatSimulation?.();
  }, [graphData, forceSpread]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection-driven physics ────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Unpin every node first
    for (const n of graphData.nodes) { delete n.fx; delete n.fy; }

    const linkForce = fg.d3Force("link");

    if (selectedNodeIds.size === 1) {
      const selId = [...selectedNodeIds][0];
      const selNode = graphData.nodes.find(n => n.id === selId);
      // Pin the selected node so reachable nodes fan out around it
      if (selNode?.x != null) { selNode.fx = selNode.x; selNode.fy = selNode.y; }

      fg.d3Force("selRadial",    makeSelectionRadialForce(selId, bfsDistances, linkDistBase));
      fg.d3Force("chainCentroid", null);
      // Restore uniform link distances (chain mode may have changed them)
      if (linkForce) linkForce.distance(linkDistBase).strength(0.5);

    } else if (selectedNodeIds.size >= 2) {
      // Pin each selected node so they act as stable poles
      for (const selId of selectedNodeIds) {
        const sn = graphData.nodes.find(n => n.id === selId);
        if (sn?.x != null) { sn.fx = sn.x; sn.fy = sn.y; }
      }
      fg.d3Force("chainCentroid", makeChainCentroidForce(selectedNodeIds, chainNodeIds));
      fg.d3Force("selRadial", null);
      // Chain edges stay at a readable distance; non-chain edges get long slack
      // so unrelated nodes drift to the periphery without crowding the path.
      if (linkForce) {
        linkForce.distance(link => {
          const u = link.source?.id ?? link.source;
          const v = link.target?.id ?? link.target;
          return chainEdgeMap.has(`${u}|${v}`) ? linkDistBase : linkDistBase * 2;
        }).strength(link => {
          const u = link.source?.id ?? link.source;
          const v = link.target?.id ?? link.target;
          return chainEdgeMap.has(`${u}|${v}`) ? 0.45 : 0.04;
        });
      }

    } else {
      // No selection — restore defaults
      fg.d3Force("selRadial",    null);
      fg.d3Force("chainCentroid", null);
      if (linkForce) linkForce.distance(linkDistBase).strength(0.5);
    }

    fg.d3ReheatSimulation?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeIds, bfsDistances, chainNodeIds, chainEdgeMap, linkDistBase]);

  // ── Scroll pan / pinch zoom ──────────────────────────────────────────────────
  // onZoom reports {k, x, y} where x/y are graph-space center (NOT d3 translation).
  // Pan formula: new_center = old_center + delta_screen / k
  // ctrlKey = macOS pinch-to-zoom → pass through to d3.
  // All other wheel events → translate the camera.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-to-zoom — let d3 handle
      e.preventDefault();
      e.stopPropagation();
      const fg = fgRef.current;
      if (!fg) return;
      const { k, x, y } = zoomTransformRef.current;
      if (!k) return;
      // Cap per-event delta to prevent momentum-scroll explosions
      const MAX_DELTA = 80;
      const dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaX));
      const dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaY));
      // x/y are graph-space center — move by (delta / k) to stay proportional to zoom
      const newX = x + dx / k;
      const newY = y + dy / k;
      zoomTransformRef.current = { k, x: newX, y: newY };
      fg.centerAt(newX, newY, 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Node search modal (/  or  Cmd+K / Ctrl+K) ───────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Ignore keystrokes when focus is inside an input/textarea/select
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/" ) { e.preventDefault(); setShowSearch(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searchTerms = searchQuery.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const searchMatches = useMemo(() => {
    if (!searchTerms.length) return [];
    return graphData.nodes.filter(n =>
      searchTerms.some(t => n.id.toLowerCase().includes(t))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, graphData.nodes]);

  function applySearch() {
    if (searchMatches.length > 0)
      setSelectedNodeIds(new Set(searchMatches.map(n => n.id)));
  }

  const totalEdges   = data?.graph_edges?.length || 0;
  const visibleEdges = graphData.links.length;

  // Format a color-measure value for the legend
  const colorMeasure = measures.find(m => measureKey(m) === colorKey);
  function fmtLegend(v) {
    if (v == null) return "—";
    const t = colorMeasure ? types[measureKey(colorMeasure)] : null;
    if (t === "ratio") return `${(v*100).toFixed(1)}%`;
    if (t === "float") return v !== 0 && v < 0.01 ? v.toExponential(2) : v.toFixed(3);
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  }

  return (
    <div ref={containerRef} style={{ position:"relative", borderRadius:8, overflow:"hidden", background:"var(--bg2)", border:"1px solid var(--border)" }}>
      {/* Controls row — overlaid at top of canvas with gradient background */}
      <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:5,
        padding:"10px 14px 20px", pointerEvents:"none",
        background:"linear-gradient(to bottom, rgba(13,17,23,0.92) 0%, rgba(13,17,23,0.0) 100%)" }}>
      <div style={{ display:"flex", gap:14, alignItems:"center", flexWrap:"wrap", pointerEvents:"auto" }}>
        {/* Color by */}
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Color by:</span>
          <select
            value={colorKey || ""}
            onChange={e => setColorKeyOverride(e.target.value || null)}
            style={{ padding:"3px 8px", fontSize:12, background:"var(--bg3)",
              border:"1px solid var(--border2)", borderRadius:4, color:"var(--text)" }}
          >
            {measures.map(m => (
              <option key={measureKey(m)} value={measureKey(m)}>
                {measureLabel(m)}{!m.special ? ` (${m.agg})` : ""}
              </option>
            ))}
          </select>
        </div>
        {/* Edge weight */}
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Min edge weight:</span>
          <input type="number" min={1} value={minWeight}
            onChange={e => setMinWeight(Math.max(1,+e.target.value))}
            style={{ width:70, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }}>Top edges per node:</span>
          <input type="number" min={0} placeholder="all" value={topK||""}
            onChange={e => setTopK(Math.max(0,+e.target.value||0))}
            style={{ width:70, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }} title="Max hops in both directions (1 node selected) or chain search (2+ nodes, Shift+click)">Max hops:</span>
          <input type="number" min={1} max={10} value={fanOutDepth}
            onChange={e => setFanOutDepth(Math.max(1, Math.min(10, +e.target.value || 1)))}
            style={{ width:55, padding:"3px 8px", fontSize:12 }}
          />
        </div>
        {/* Spread slider — scales charge repulsion and link distance */}
        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
          <span style={{ color:"var(--text2)" }} title="Scale the repulsion force and link distance together">Spread:</span>
          <input
            type="range" min={50} max={1500} step={25}
            value={forceSpread}
            onChange={e => setForceSpread(+e.target.value)}
            style={{ width:80, cursor:"pointer", accentColor:"var(--blue)" }}
          />
          {forceSpread !== SPREAD_DEFAULT && (
            <button
              onClick={() => setForceSpread(SPREAD_DEFAULT)}
              title="Reset spread to default"
              style={{ fontSize:10, padding:"1px 6px", background:"var(--bg3)",
                border:"1px solid var(--border2)", borderRadius:3,
                color:"var(--text3)", cursor:"pointer", lineHeight:"16px" }}
            >↺</button>
          )}
        </div>
        {selectedNodeIds.size >= 2 && (
          <span style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:11, color:"var(--blue)", fontWeight:600 }}>
              🔗 {selectedNodeIds.size} nodes — showing connecting chains
            </span>
            <button
              onClick={() => setSelectedNodeIds(new Set())}
              style={{ fontSize:11, padding:"2px 7px", background:"var(--bg3)",
                border:"1px solid var(--border2)", borderRadius:4,
                color:"var(--text2)", cursor:"pointer" }}
            >clear</button>
          </span>
        )}
        {/* Hide isolated toggle */}
        <button
          onClick={() => setHideIsolated(v => !v)}
          title="Toggle visibility of nodes with no edges"
          style={{ fontSize:11, padding:"3px 9px", cursor:"pointer", borderRadius:4,
            border:"1px solid var(--border2)",
            background: hideIsolated ? "var(--blue)" : "var(--bg3)",
            color:       hideIsolated ? "#fff"       : "var(--text2)" }}
        >{hideIsolated ? "✕ isolated hidden" : "show isolated"}</button>
        {/* Coupling mode — blob mode only */}
        {graphData.isBlobMode && (
          <button
            onClick={handleCouplingToggle}
            title={couplingIds.size > 0
              ? "Clear coupling highlight"
              : `Highlight nodes that call across group boundaries (${crossEdgeSet.size} cross-boundary edges)`}
            style={{ fontSize:11, padding:"3px 9px", cursor:"pointer", borderRadius:4,
              border:"1px solid var(--border2)",
              background: couplingIds.size > 0 ? "#ff9f1c" : "var(--bg3)",
              color:       couplingIds.size > 0 ? "#0d1117"  : "var(--text2)" }}
          >
            {couplingIds.size > 0
              ? `✕ coupling (${couplingIds.size} nodes)`
              : `🔀 coupling`}
          </button>
        )}
        {/* Search shortcut hint */}
        <button
          onClick={() => setShowSearch(true)}
          title="Search and select nodes by name (/ or ⌘K)"
          style={{ fontSize:11, padding:"3px 9px", cursor:"pointer", borderRadius:4,
            border:"1px solid var(--border2)", background:"var(--bg3)", color:"var(--text2)" }}
        >🔍 search <kbd style={{ opacity:0.6, fontSize:10 }}>/</kbd></button>
        <span style={{ fontSize:11, color:"var(--text3)" }}>{visibleEdges} / {totalEdges} edges shown</span>
      </div>{/* end inner controls flex */}
      </div>{/* end gradient overlay */}

      {/* ForceGraph canvas fills the container */}
      <div style={{ position:"relative" }}>
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={fgRef}
              // key forces full d3 remount when node set changes.
              // Without this, d3's cached node references go stale after filters
              // change the node list, producing "node not found" or "Cannot set
              // property vx on string" crashes.
              key={graphData.nodes.map(n => n.id).sort().join("|")}
              width={size.w} height={size.h}
              graphData={graphData}
              nodeLabel=""
              nodeVal={n => n.val}
              nodeColor={n => n.color}
              onRenderFramePre={graphData.isBlobMode ? (ctx, gs) => {
                // Draw amorphous blobs behind nodes — one per outer-dim group
                const groupPos = new Map();
                for (const node of graphData.nodes) {
                  if (node.x == null) continue;
                  if (!groupPos.has(node.group)) groupPos.set(node.group, []);
                  groupPos.get(node.group).push([node.x, node.y]);
                }
                for (const [group, pts] of groupPos) {
                  const color = groupColorMap.get(group) || "#888888";
                  const hull  = pts.length >= 3 ? convexHull(pts) : pts.map(p => [...p]);
                  drawBlob(ctx, hull, 32/gs, 1.5/gs, color);
                  // Group label at centroid
                  const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
                  const cy = pts.reduce((s,p)=>s+p[1],0)/pts.length;
                  ctx.font         = `bold ${15/gs}px sans-serif`;
                  ctx.fillStyle    = (groupColorMap.get(group)||"#888888") + "99";
                  ctx.textAlign    = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText(String(group), cx, cy);
                }
              } : undefined}
              nodeCanvasObjectMode={() => "replace"}
              nodeCanvasObject={(node, ctx) => {
                const isSelected  = selectedNodeIds.has(node.id);
                const anySelected = selectedNodeIds.size > 0;
                const isReachable = !anySelected ? true
                  : selectedNodeIds.size === 1 ? bfsDistances.has(node.id)
                  : chainNodeIds.has(node.id);
                const isCoupling  = couplingIds.has(node.id);
                const hasCoupling = couplingIds.size > 0;

                // For symbol mode the id is "module::name" — show only the name part
                const full  = node.name || "";
                const short = full.includes("::") ? full.split("::").slice(1).join("::") : full;
                const label = short.length > MAX_LABEL ? short.slice(0, MAX_LABEL - 1) + "…" : short;
                const fs    = 11;
                ctx.font    = `600 ${fs}px monospace`;
                const tw    = ctx.measureText(label).width;
                const padX  = 8, padY = 5;
                const w     = Math.max(tw + padX * 2, 30);
                const h     = fs + padY * 2;

                // Dimming priority:
                //  coupling mode  → coupling nodes full, others 18% (selection can rescue)
                //  selection mode → reachable nodes full, others 18%
                //  neither        → all full
                const isVisible = hasCoupling
                  ? (isCoupling || (anySelected && isReachable))
                  : anySelected ? isReachable : true;
                ctx.globalAlpha = isVisible ? 1.0 : 0.18;

                // Coupling halo — outermost, orange, drawn before selection ring
                if (isCoupling) {
                  drawPill(ctx, node.x, node.y, w + 12, h + 12);
                  ctx.strokeStyle = "rgba(255,159,28,0.85)";
                  ctx.lineWidth   = 2.5;
                  ctx.stroke();
                }

                // Selection halo — drawn slightly larger, behind the pill
                if (isSelected) {
                  drawPill(ctx, node.x, node.y, w + 7, h + 7);
                  ctx.strokeStyle = "rgba(255,255,255,0.85)";
                  ctx.lineWidth   = 2.5;
                  ctx.stroke();
                }

                // Pill background
                const baseColor = nodeColorOverrides?.get(node.id) ?? node.color;
                drawPill(ctx, node.x, node.y, w, h);
                ctx.fillStyle   = isSelected ? lerpColor(baseColor, "#ffffff", 0.25) : baseColor;
                ctx.fill();
                ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.12)";
                ctx.lineWidth   = isSelected ? 1.5 : 0.8;
                ctx.stroke();

                // Label
                ctx.fillStyle    = "#0d1117";
                ctx.textAlign    = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, node.x, node.y);

                ctx.globalAlpha = 1.0;
                // Cache dims for pointer detection
                node.__bckgDimensions = [w, h];
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                const [w = 40, h = 20] = node.__bckgDimensions || [];
                drawPill(ctx, node.x, node.y, w, h);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkWidth={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 0) {
                  if (couplingIds.size > 0) {
                    // Cross-boundary edges slightly thicker so they stand out
                    return crossEdgeSet.has(`${src}|${tgt}`) ? 2.0 : 0.4;
                  }
                  return Math.log(1 + (link.value||1)) * 0.8 + 0.3;
                }
                if (selectedNodeIds.size === 1) {
                  // Bidirectional: forward edge from src, OR backward edge into tgt
                  const fD = fwdDistances.get(src);
                  const bD = bwdDistances.get(tgt);
                  const d  = fD != null && bD != null ? Math.min(fD, bD) : (fD ?? bD);
                  return d != null && d < stepWidths.length ? stepWidths[d] : 0.3;
                }
                // Chain mode: width by min chain length (1-indexed step)
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return 0.3;
                return stepWidths[Math.min(cl - 1, stepWidths.length - 1)];
              }}
              linkColor={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                // Diff overlay: always use diff edge color when provided
                const edgeOverride = edgeColorOverrides?.get(`${src}|${tgt}`);
                if (edgeOverride) return edgeOverride;
                if (selectedNodeIds.size === 0) {
                  if (couplingIds.size > 0) {
                    // Cyan for cross-boundary; nearly invisible for within-group
                    return crossEdgeSet.has(`${src}|${tgt}`) ? "#39c5cf" : "rgba(48,54,61,0.08)";
                  }
                  return "#30363d";
                }
                if (selectedNodeIds.size === 1) {
                  const fD = fwdDistances.get(src);
                  const bD = bwdDistances.get(tgt);
                  const d  = fD != null && bD != null ? Math.min(fD, bD) : (fD ?? bD);
                  return d != null && d < stepColors.length ? stepColors[d] : "rgba(48,54,61,0.15)";
                }
                // Chain mode: color by min chain length covering this edge
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return "rgba(48,54,61,0.12)";
                return stepColors[Math.min(cl - 1, stepColors.length - 1)];
              }}
              linkDirectionalArrowLength={link => {
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 0) {
                  if (couplingIds.size > 0) {
                    return crossEdgeSet.has(`${src}|${tgt}`) ? 7 : 2;
                  }
                  return 5;
                }
                if (selectedNodeIds.size === 1) {
                  const fD = fwdDistances.get(src);
                  const bD = bwdDistances.get(tgt);
                  const d  = fD != null && bD != null ? Math.min(fD, bD) : (fD ?? bD);
                  return d != null && d < stepArrows.length ? stepArrows[d] : 2;
                }
                const cl = chainEdgeMap.get(`${src}|${tgt}`);
                if (cl == null) return 2;
                return stepArrows[Math.min(cl - 1, stepArrows.length - 1)];
              }}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={link => {
                // Control particle count per-link so the library doesn't freeze
                // them when selection state changes. 0 = no particles at all.
                const u = typeof link.source === "object" ? link.source.id : link.source;
                const v = typeof link.target === "object" ? link.target.id : link.target;
                // Diff overlay: show particles on added/removed edges (not unchanged/context)
                if (edgeColorOverrides?.size > 0) {
                  const ec = edgeColorOverrides.get(`${u}|${v}`);
                  if (ec && ec !== "#30363d" && ec !== "#484f58") return 2;
                  return 0;
                }
                if (selectedNodeIds.size === 0) {
                  if (couplingIds.size > 0) return crossEdgeSet.has(`${u}|${v}`) ? 3 : 0;
                  return 2;
                }
                // Bidirectional: lit if edge goes forward from u, or backward into v
                if (selectedNodeIds.size === 1) return (fwdDistances.has(u) || bwdDistances.has(v)) ? 2 : 0;
                return chainEdgeMap.has(`${u}|${v}`) ? 2 : 0;
              }}
              linkDirectionalParticleSpeed={0.004}
              linkDirectionalParticleWidth={link => {
                if (selectedNodeIds.size === 0) {
                  if (couplingIds.size > 0) {
                    const u = typeof link.source === "object" ? link.source.id : link.source;
                    const v = typeof link.target === "object" ? link.target.id : link.target;
                    return crossEdgeSet.has(`${u}|${v}`) ? 4 : 0;
                  }
                  return 3;
                }
                const u = typeof link.source === "object" ? link.source.id : link.source;
                const v = typeof link.target === "object" ? link.target.id : link.target;
                if (selectedNodeIds.size === 1) return (fwdDistances.has(u) || bwdDistances.has(v)) ? 5 : 0;
                return chainEdgeMap.has(`${u}|${v}`) ? 5 : 0;
              }}
              linkDirectionalParticleColor={link => {
                const u = typeof link.source === "object" ? link.source.id : link.source;
                const v = typeof link.target === "object" ? link.target.id : link.target;
                const edgeOverride = edgeColorOverrides?.get(`${u}|${v}`);
                if (edgeOverride) return edgeOverride;
                if (selectedNodeIds.size === 0 && couplingIds.size > 0) {
                  return crossEdgeSet.has(`${u}|${v}`) ? "#39c5cf" : "#ffffff";
                }
                return "#ffffff";
              }}
              onZoom={t => { zoomTransformRef.current = t; }}
              onEngineStop={() => {
                // Once per mount: nudge the camera so the node cloud is centred
                // in the visible area below the floating config card.
                if (didOffsetRef.current || !fgRef.current || controlsH <= 20) return;
                didOffsetRef.current = true;
                const fg = fgRef.current;
                const k  = fg.zoom() || 1;
                const c  = fg.centerAt() || { x: 0, y: 0 };
                fg.centerAt(c.x, c.y + controlsH / (2 * k), 400);
              }}
              onNodeClick={(node, event) => {
                const id = node?.id ?? null;
                if (!id) return;
                setSelectedNodeIds(prev => {
                  if (event?.shiftKey) {
                    // Shift+click: toggle node in multi-select set
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  }
                  // Plain click: single-select (or deselect if already sole selection)
                  return prev.size === 1 && prev.has(id) ? new Set() : new Set([id]);
                });
                onNodeClick?.(node);
              }}
              backgroundColor="#0d1117"
            />
          ) : (
            <div style={{ height:520, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text3)" }}>
              No nodes to display.
            </div>
          )}

        {/* ── Node search modal ───────────────────────────────────────── */}
        {showSearch && (
          <div
            style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)",
              display:"flex", alignItems:"flex-start", justifyContent:"center",
              paddingTop:60, zIndex:50 }}
            onClick={e => { if (e.target === e.currentTarget) { setShowSearch(false); setSearchQuery(""); } }}
          >
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)",
              borderRadius:8, padding:16, width:440, maxWidth:"90%",
              boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ marginBottom:8, fontSize:11, color:"var(--text3)" }}>
                Partial name match · separate multiple with <strong style={{ color:"var(--text2)" }}>,</strong> · <kbd style={{ opacity:0.7 }}>Enter</kbd> selects · <kbd style={{ opacity:0.7 }}>Esc</kbd> closes
              </div>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); }
                  if (e.key === "Enter")  { applySearch(); setShowSearch(false); setSearchQuery(""); }
                }}
                placeholder="e.g. parser, resolve_type"
                style={{ width:"100%", padding:"8px 12px", fontSize:13,
                  boxSizing:"border-box", background:"var(--bg3)",
                  border:"1px solid var(--border2)", borderRadius:4,
                  color:"var(--text)", outline:"none" }}
              />
              <div style={{ marginTop:8, fontSize:11, color: searchMatches.length > 0 ? "var(--text2)" : "var(--text3)", minHeight:16 }}>
                {searchTerms.length === 0 ? `${graphData.nodes.length} nodes total`
                  : searchMatches.length === 0 ? "No matches"
                  : <>
                      <span style={{ color:"var(--blue)", fontWeight:600 }}>{searchMatches.length}</span>
                      {" match"}{searchMatches.length !== 1 ? "es" : ""}: {" "}
                      {searchMatches.slice(0,6).map(n => <code key={n.id} style={{ marginRight:4, opacity:0.8 }}>{n.id}</code>)}
                      {searchMatches.length > 6 && <span style={{ opacity:0.5 }}>+{searchMatches.length - 6} more</span>}
                    </>
                }
              </div>
            </div>
          </div>
        )}
      </div>{/* end canvas wrapper */}

      {/* Legend — overlaid at bottom of canvas */}
      {colorMeasure && (
        <div style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:5, pointerEvents:"none",
          padding:"20px 16px 10px",
          background:"linear-gradient(to top, rgba(13,17,23,0.85) 0%, rgba(13,17,23,0.0) 100%)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:11, color:"var(--text3)" }}>
            <span>Color = {measureLabel(colorMeasure)}{!colorMeasure.special && ` (${colorMeasure.agg})`}</span>
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <span>{fmtLegend(colorStats.min)}</span>
              <div style={{ width:80, height:6, borderRadius:3, background:"linear-gradient(to right,#3fb950,#f85149)" }} />
              <span>{fmtLegend(colorStats.max)}</span>
            </div>
            {sizeKey && sizeKey !== colorKey && <span>· Size ∝ {measureLabel(measures.find(m=>measureKey(m)===sizeKey))}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
