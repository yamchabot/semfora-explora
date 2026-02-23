import { useState, useRef, useEffect, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { measureKey, measureLabel } from "../utils/measureUtils.js";
import { lerpColor, makeStepColors, makeStepWidths, makeStepArrows } from "../utils/colorUtils.js";
import { bfsFromNode, buildAdjacencyMaps, convexHull, findChainEdges, collectChainNodeIds } from "../utils/graphAlgo.js";
import { buildGraphData, flattenLeafRows, getGroupKey } from "../utils/graphData.js";
import { Tooltip } from "./Tooltip.jsx";

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

// ── Blob drawing ─────────────────────────────────────────────────────────────

/**
 * Draw a smooth blob (filled + stroked) around hull points.
 * Fill and stroke are drawn with the same unclipped blob path so the shape is
 * always a complete smooth oval (no flat edge at adjacent-blob boundaries).
 */
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
    const wing = padding * 0.65;
    const nx   = -dy / len * wing;
    const ny   =  dx / len * wing;
    const mx   = (exp[0][0] + exp[1][0]) / 2;
    const my   = (exp[0][1] + exp[1][1]) / 2;
    exp = [exp[0], [mx + nx, my + ny], exp[1], [mx - nx, my - ny]];
  }

  const n = exp.length;

  // Draw the blob path once — fill and stroke use the same shape, no clipping.
  // Previously the fill was clipped to the Voronoi cell which caused a flat edge
  // on the side facing an adjacent blob. Now both are unclipped so the shape is
  // always a complete smooth oval. Adjacent fills at 12% opacity barely overlap.
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(exp[0][0], exp[0][1], padding, 0, Math.PI * 2);
  } else {
    const mid = i => [(exp[i][0] + exp[(i+1)%n][0]) / 2, (exp[i][1] + exp[(i+1)%n][1]) / 2];
    const m0 = mid(0);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid((i+1) % n);
      ctx.quadraticCurveTo(exp[(i+1)%n][0], exp[(i+1)%n][1], m[0], m[1]);
    }
  }
  ctx.closePath();
  ctx.fillStyle   = color + "1e";   // ~12% opacity fill
  ctx.fill();
  ctx.strokeStyle = color + "99";   // ~60% opacity stroke
  ctx.lineWidth   = lineWidth;
  ctx.stroke();
}

// ── Group forces ─────────────────────────────────────────────────────────────

/**
 * Group separation force for blob mode.
 *
 * Three-stage approach per tick:
 *   1. Gentle per-node centroid attraction (velocity, alpha-dependent)
 *   2. Group-level blob separation: if two groups' blobs overlap (centroid
 *      distance < sum of radii + padding), push ALL nodes in each group apart
 *      as a unit.  This is a direct position push, alpha-independent, so it
 *      works even on a fully cooled simulation and can overcome link forces.
 *   3. Individual straggler enforcement: any node that ends up on the wrong
 *      side of the Voronoi boundary gets pulled back.
 *
 * @param {number} attractStrength   – centroid attraction per tick (velocity)
 * @param {number} separationStrength – group-push magnitude per overlap unit
 * @param {number} blobPadding       – minimum gap (graph units) between blob edges
 */
/**
 * Create a blob containment force for a given nesting level.
 * Level 0 → node.group (outermost blobs).
 * Level L → getGroupKey(node, L) which includes all dim values 0..L.
 *
 * Lower attraction/separation at outer levels (they don't need tight containment;
 * inner forces handle the fine-grained clustering).
 */
export function makeNestedBlobForce(level, blobCount = 1) {
  // Inner levels need stronger containment; outer levels are gentler.
  const levelFactor = Math.max(0.4, 1 - level * 0.25);
  const padding     = Math.max(15, 60 - level * 15);
  return makeVoronoiContainmentForce(
    0.10 * levelFactor,
    0.35 * levelFactor,
    padding,
    level,
    Math.round(padding * 0.6),  // boundary margin ≈ 60% of padding (prevents flat-edge dead zone)
  );
}

export function makeVoronoiContainmentForce(
  attractStrength    = 0.10,
  separationStrength = 0.35,
  blobPadding        = 60,
  blobLevel          = 0,    // which groupPath level to use for grouping
  boundaryMargin     = 0,    // pre-emptive push zone (graph units) before the Voronoi edge
) {
  let _nodes = [];

  function force(alpha) {
    // ── 1. Compute per-group centroid + max-radius ──────────────────────────
    const groups = new Map(); // groupKey → { x, y, count, r }
    for (const n of _nodes) {
      const gk = getGroupKey(n, blobLevel);
      if (!gk || n.x == null) continue;
      if (!groups.has(gk)) groups.set(gk, { x: 0, y: 0, count: 0, r: 0 });
      const g = groups.get(gk);
      g.x += n.x; g.y += n.y; g.count++;
    }
    for (const g of groups.values()) { g.x /= g.count; g.y /= g.count; }
    // max distance from centroid → rough blob radius
    for (const n of _nodes) {
      const gk = getGroupKey(n, blobLevel);
      if (!gk || n.x == null) continue;
      const g = groups.get(gk);
      const d = Math.sqrt((n.x - g.x) ** 2 + (n.y - g.y) ** 2);
      if (d > g.r) g.r = d;
    }

    const groupList = [...groups.entries()];

    // ── 2. Per-node centroid attraction ─────────────────────────────────────
    // effAlpha is floored at 0.05 so the centripetal pull never fully dies.
    // Without this, Stage 2 → 0 as the simulation cools, leaving the charge
    // force unchallenged — nodes drift to the blob boundary and park there
    // permanently (the "flat-edge" / "ring" accumulation bug).
    const effAlpha = Math.max(alpha, 0.05);
    for (const n of _nodes) {
      const gk = getGroupKey(n, blobLevel);
      if (!gk || n.x == null) continue;
      const own = groups.get(gk);
      if (!own) continue;
      n.vx += (own.x - n.x) * attractStrength * effAlpha;
      n.vy += (own.y - n.y) * attractStrength * effAlpha;
    }

    // ── 3. Group-level separation (alpha-independent position push) ─────────
    for (let i = 0; i < groupList.length; i++) {
      const [gA, cA] = groupList[i];
      for (let j = i + 1; j < groupList.length; j++) {
        const [gB, cB] = groupList[j];
        const dx = cA.x - cB.x, dy = cA.y - cB.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 0.001;

        const rA          = Math.max(cA.r, 40);
        const rB          = Math.max(cB.r, 40);
        const desiredDist = rA + rB + blobPadding;

        if (d < desiredDist) {
          const nx = dx / d, ny = dy / d;
          const overlap  = (desiredDist - d) / desiredDist;
          const pushMag  = overlap * separationStrength;

          for (const n of _nodes) {
            if (n.x == null) continue;
            const nk = getGroupKey(n, blobLevel);
            if (nk === gA) { n.x += nx * pushMag; n.y += ny * pushMag; }
            if (nk === gB) { n.x -= nx * pushMag; n.y -= ny * pushMag; }
          }
        }
      }
    }

    // ── 4. Per-node straggler enforcement + boundary margin zone ────────────
    //
    // Signed boundary distance (sbd): distance of a node from the Voronoi
    // midpoint between its own centroid and a neighbour centroid.
    //   sbd > 0  →  node has crossed into the other group's territory
    //   sbd = 0  →  exactly at the Voronoi midpoint
    //   sbd < 0  →  safely inside own territory (distance = |sbd|)
    //
    // Without `boundaryMargin`, Stage 4 only fires when sbd > 0 (already
    // crossed) — creating a dead zone just inside the boundary where nodes
    // accumulate and form a flat edge.
    //
    // With `boundaryMargin > 0`, correction starts at sbd = -boundaryMargin
    // and ramps linearly from 0 (outer edge) to a max push at the boundary.
    // This pre-empts pile-up before it can form.
    for (const n of _nodes) {
      const gk = getGroupKey(n, blobLevel);
      if (!gk || n.x == null) continue;
      const own = groups.get(gk);
      if (!own) continue;
      const ownDist = Math.sqrt((n.x - own.x) ** 2 + (n.y - own.y) ** 2) || 0.001;
      for (const [g, c] of groupList) {
        if (g === gk) continue;
        const otherDist = Math.sqrt((n.x - c.x) ** 2 + (n.y - c.y) ** 2) || 0.001;

        // sbd > 0 → crossed; sbd < 0 → inside (magnitude = gap to boundary)
        const sbd = (ownDist - otherDist) / 2;
        if (sbd <= -boundaryMargin) continue;   // well inside blob — nothing to do

        const dx = own.x - n.x, dy = own.y - n.y;
        const dl = Math.sqrt(dx * dx + dy * dy) || 1;

        if (boundaryMargin > 0) {
          // Margin-zone fix: linear ramp from 0 (at outer edge) to max (at/past boundary).
          // Uses a fixed-pixel push (direction: toward own centroid) so the force is
          // alpha-independent and can't be overwhelmed by a dead simulation.
          const depth  = (sbd + boundaryMargin) / boundaryMargin; // 0 → 1+ as node approaches/crosses
          const pushPx = Math.min(depth * boundaryMargin * 0.08, 6);
          n.x += (dx / dl) * pushPx;
          n.y += (dy / dl) * pushPx;
        } else {
          // Original behaviour (boundaryMargin = 0): fractional pull toward centroid,
          // proportional to how far past the boundary the node has drifted.
          const frac = Math.min((sbd / ownDist) * 0.5, 0.3);
          n.x += dx * frac;
          n.y += dy * frac;
        }

        // Velocity damping: cancel any velocity component pointing toward the other centroid.
        const cx = c.x - n.x, cy = c.y - n.y;
        const cl = Math.sqrt(cx * cx + cy * cy) || 1;
        const proj = n.vx * (cx / cl) + n.vy * (cy / cl);
        if (proj > 0) { n.vx -= (cx / cl) * proj; n.vy -= (cy / cl) * proj; }
      }
    }
  }

  force.initialize = nodes => { _nodes = nodes; };
  return force;
}

// Keep old name as alias so any external references still compile.
export const makeGroupCentroidForce = (strength) =>
  makeVoronoiContainmentForce(strength, strength * 3);

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
  nodeDot = false, setNodeDot,
  invertFlow = false, setInvertFlow,
  controlsH = 0, fillViewport = false,
  nodeColorOverrides = null,   // Map<nodeId, cssColor> — bypasses metric gradient (Diff page)
  edgeColorOverrides = null,   // Map<"src|tgt", cssColor> — bypasses step/chain colors
  highlightSet = null,         // Set<nodeId> — draws glow ring; color = node's own gradient color
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
  // When true, the graph only shows cross-boundary nodes + edges (no non-coupling nodes).
  const [couplingOnly, setCouplingOnly] = useState(false);
  // nodeDot and setNodeDot come in as props (URL-persisted in Explore.jsx)
  // Spread: scales charge repulsion and link distance together.
  // 350 = default; higher = more spread; lower = tighter.
  const SPREAD_DEFAULT = 350;
  const [forceSpread, setForceSpread] = useState(SPREAD_DEFAULT);
  // Dot-mode hover tooltip — fully imperative so hover never triggers a React
  // re-render (which would reset particle animation timing in ForceGraph2D).
  const tooltipRef = useRef(null);
  // Hide tooltip when dot mode is turned off
  useEffect(() => {
    if (!nodeDot && tooltipRef.current) tooltipRef.current.style.display = "none";
  }, [nodeDot]);
  const zoomTransformRef  = useRef({ k: 1, x: 0, y: 0 });
  const didOffsetRef      = useRef(false);
  // Persist node positions across graphData rebuilds (measure changes keep layout stable).
  // Maps nodeId → {x, y}; saved periodically in onRenderFramePre.
  const nodePositionsRef  = useRef(new Map());
  const posFrameCountRef  = useRef(0);

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
  const dim0      = data?.dimensions?.[0];   // outermost dim (blob groups in blob mode, node dim in 1d)

  // Resolve color key: override if valid (in user measures OR in measure_types), else first measure
  const allMKeys = measures.map(measureKey);
  const colorKey = (colorKeyOverride && (allMKeys.includes(colorKeyOverride) || types[colorKeyOverride] !== undefined))
    ? colorKeyOverride
    : (allMKeys[0] ?? null);

  const sizeKey = (() => {
    const m = measures.find(m => m.special === "symbol_count") || measures[0];
    return m ? measureKey(m) : null;
  })();

  // Min/max across all value rows (leaf rows in blob mode, top-level otherwise)
  const colorStats = useMemo(() => {
    if (!colorKey || !data?.rows) return { min: 0, max: 1 };
    const numDims = data?.dimensions?.length ?? 1;
    const rows = isBlobMode ? flattenLeafRows(data.rows, numDims) : data.rows;
    const vals = rows.map(r => r.values?.[colorKey]).filter(v => v != null && isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    const mn = Math.min(...vals), mx = Math.max(...vals);
    return { min: mn, max: mx === mn ? mn + 1 : mx };
  }, [colorKey, data, isBlobMode]);

  // Map outer-dim value → blob color
  // Level-0 (outer) group → palette colour
  const groupColorMap = useMemo(() => {
    if (!isBlobMode || !data?.rows) return new Map();
    return new Map(data.rows.map((r, i) => [r.key[dim0], BLOB_PALETTE[i % BLOB_PALETTE.length]]));
  }, [isBlobMode, data, dim0]);

  // Number of blob nesting levels = dims.length - 1  (0 for 1-dim, 1 for 2-dim, 2 for 3-dim…)
  const blobLevelCount = isBlobMode ? (data?.dimensions?.length ?? 1) - 1 : 0;

  // When coloring by diff_status_value, use an explicit 4-stop mapping instead
  // of the green→red gradient (whose midpoint is an ugly olive, and whose
  // min===max guard would otherwise produce NaN when all nodes are unchanged).
  const diffColorFn = useMemo(() => {
    if (colorKey !== "diff_status_value") return null;
    return (vals) => {
      const v = vals["diff_status_value"];
      if (!isFinite(v)) return "#484f58"; // no data → gray fallback
      if (v < 0.1)  return "#3fb950";     // added    → green
      if (v < 0.4)  return "#e3b341";     // modified → amber
      if (v > 0.9)  return "#f85149";     // removed  → red
      return "#484f58";                   // unchanged → gray
    };
  }, [colorKey]);

  const graphData = useMemo(() => {
    const gd = buildGraphData(data, { minWeight, topK, colorKey, colorStats, sizeKey, hideIsolated, colorFn: diffColorFn });

    // ── Position seeding ─────────────────────────────────────────────────────
    // D3 only randomises a node's position when isNaN(node.x), so anything we
    // set here will be respected by the simulation.  We do two things:
    //
    //   1. Restore previously saved positions (nodePositionsRef) so that layout
    //      survives measure-only changes (same nodes, new colours/sizes).
    //
    //   2. For nodes that have no saved position (first load, new nodes),
    //      pre-position them in a group-circle layout so the simulation starts
    //      near the desired separated state rather than fully random.

    // 1. Restore saved positions
    const savedPos = nodePositionsRef.current;
    for (const node of gd.nodes) {
      const p = savedPos.get(node.id);
      if (p) { node.x = p.x; node.y = p.y; node.vx = 0; node.vy = 0; }
    }

    // 2. Pre-position un-placed nodes in blob mode
    if (gd.isBlobMode) {
      const groupsList = [...new Set(gd.nodes.map(n => n.group).filter(Boolean))];
      const numGroups  = groupsList.length;
      if (numGroups > 1) {
        // Space groups in a circle with radius proportional to group count.
        const spread = Math.max(300, 120 * Math.sqrt(numGroups));
        const groupPos = new Map(groupsList.map((g, i) => {
          const angle = (2 * Math.PI * i) / numGroups;
          return [g, { x: Math.cos(angle) * spread, y: Math.sin(angle) * spread }];
        }));
        for (const node of gd.nodes) {
          if (node.x == null || isNaN(node.x)) {
            const gp = groupPos.get(node.group);
            if (gp) {
              // Deterministic jitter based on node index (avoids useMemo non-purity)
              const idx = gd.nodes.indexOf(node);
              const jitter = 80;
              node.x = gp.x + Math.cos(idx * 2.399) * jitter * (0.5 + Math.abs(Math.sin(idx)));
              node.y = gp.y + Math.sin(idx * 2.399) * jitter * (0.5 + Math.abs(Math.cos(idx)));
            }
          }
        }
      }
    }

    return gd;
  }, [data, minWeight, topK, colorKey, colorStats, sizeKey, hideIsolated, diffColorFn]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // All nodes that are an endpoint (source OR target) of any cross-boundary edge
  const couplingEndpoints = useMemo(() => {
    const s = new Set();
    for (const key of crossEdgeSet) {
      const [src, tgt] = key.split("|");
      s.add(src); s.add(tgt);
    }
    return s;
  }, [crossEdgeSet]);

  // Filtered graphData for coupling-only mode: only cross-boundary nodes + edges.
  // Passed to ForceGraph2D in place of the full graphData when couplingOnly is on.
  const couplingOnlyData = useMemo(() => {
    if (!couplingOnly || couplingEndpoints.size === 0) return null;
    const nodes = graphData.nodes.filter(n => couplingEndpoints.has(n.id));
    const links = graphData.links.filter(l => {
      const src = typeof l.source === "object" ? l.source.id : l.source;
      const tgt = typeof l.target === "object" ? l.target.id : l.target;
      return crossEdgeSet.has(`${src}|${tgt}`);
    });
    return { ...graphData, nodes, links };
  }, [couplingOnly, couplingEndpoints, graphData, crossEdgeSet]);

  function handleCouplingToggle() {
    if (couplingIds.size > 0) {
      setCouplingIds(new Set());
      setCouplingOnly(false);
      return;
    }
    // Highlight nodes that are sources of ≥1 cross-boundary edge
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
    if (link) {
      link.distance(linkDistBase);
      if (graphData.isBlobMode) {
        // Cross-group links are drawn but their physics pull is heavily damped.
        // Default link strength is 0.5; cross-group links at 0.02 are 25× weaker,
        // so they cannot overcome the group-separation force that keeps blobs apart.
        const nodeGroupMap = new Map(graphData.nodes.map(n => [n.id, n.group]));
        link.strength(l => {
          const src = typeof l.source === "object" ? l.source.id : l.source;
          const tgt = typeof l.target === "object" ? l.target.id : l.target;
          return nodeGroupMap.get(src) !== nodeGroupMap.get(tgt) ? 0.02 : 0.4;
        });
      } else {
        link.strength(0.5);
      }
    }

    if (graphData.isBlobMode) {
      // Pre-position nodes hierarchically: outer groups first, inner groups
      // within each outer region, so the simulation starts near-separated.
      const blobLevels = (data?.dimensions?.length ?? 2) - 1; // number of blob rings
      const outerGroups = [...new Set(graphData.nodes.map(n => n.group).filter(Boolean))];
      const numOuter   = outerGroups.length;
      if (numOuter > 1) {
        const outerSpread = Math.max(250, 100 * Math.sqrt(numOuter));
        const outerPos    = new Map(outerGroups.map((g, i) => {
          const angle = (2 * Math.PI * i) / numOuter;
          return [g, { x: Math.cos(angle) * outerSpread, y: Math.sin(angle) * outerSpread }];
        }));

        // For inner levels, cluster within the outer group's region
        if (blobLevels >= 2) {
          // Group nodes by their innermost group key (level blobLevels-1)
          const innerGroups = new Map(); // innerKey → [nodes]
          for (const node of graphData.nodes) {
            const innerKey = getGroupKey(node, blobLevels - 1);
            if (!innerGroups.has(innerKey)) innerGroups.set(innerKey, []);
            innerGroups.get(innerKey).push(node);
          }
          // Assign sub-region positions within each outer blob
          const outerSubCount = new Map(); // outerKey → count of inner groups
          for (const node of graphData.nodes) {
            const ok = node.group;
            if (!outerSubCount.has(ok)) outerSubCount.set(ok, new Set());
            outerSubCount.get(ok).add(getGroupKey(node, 1));
          }
          const outerSubIdx = new Map(); // outerKey → { innerKey → idx }
          for (const [ok, innerSet] of outerSubCount) {
            const idxMap = {};
            [...innerSet].forEach((ik, i) => { idxMap[ik] = i; });
            outerSubIdx.set(ok, { idxMap, total: innerSet.size });
          }
          for (const node of graphData.nodes) {
            if (node.x != null) continue;
            const outerCenter = outerPos.get(node.group);
            if (!outerCenter) continue;
            const info = outerSubIdx.get(node.group);
            if (info && info.total > 1) {
              const ik    = getGroupKey(node, 1);
              const idx   = info.idxMap[ik] ?? 0;
              const angle = (2 * Math.PI * idx) / info.total;
              const r     = Math.max(80, outerSpread * 0.35);
              node.x = outerCenter.x + Math.cos(angle) * r + (Math.random() - 0.5) * 40;
              node.y = outerCenter.y + Math.sin(angle) * r + (Math.random() - 0.5) * 40;
            } else {
              node.x = outerCenter.x + (Math.random() - 0.5) * 100;
              node.y = outerCenter.y + (Math.random() - 0.5) * 100;
            }
          }
        } else {
          // Standard 2-dim: position within outer group circle
          for (const node of graphData.nodes) {
            if (node.x == null && node.group != null) {
              const gp = outerPos.get(node.group);
              if (gp) {
                node.x = gp.x + (Math.random() - 0.5) * 100;
                node.y = gp.y + (Math.random() - 0.5) * 100;
              }
            }
          }
        }
      }

      // Add one containment force per blob level (outermost first).
      // Inner levels use tighter padding and slightly stronger containment.
      // Existing "groupCentroid" key handles level 0; inner levels get
      // "groupCentroid_L" keys so they can be removed independently.
      for (let L = 0; L < blobLevels; L++) {
        const forceKey = L === 0 ? "groupCentroid" : `groupCentroid_${L}`;
        fg.d3Force(forceKey, makeNestedBlobForce(L, numOuter));
      }
      // Remove any stale inner forces from a previous (fewer-dim) render
      for (let L = blobLevels; L < 6; L++) {
        fg.d3Force(`groupCentroid_${L}`, null);
      }
    } else {
      fg.d3Force("groupCentroid", null);
      for (let L = 1; L < 6; L++) fg.d3Force(`groupCentroid_${L}`, null);
    }

    fg.d3ReheatSimulation?.();
  }, [graphData, forceSpread]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection-driven physics ────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Unpin every node first
    for (const n of graphData.nodes) { delete n.fx; delete n.fy; }

    // In blob mode the group-centroid force already keeps nodes inside their blobs.
    // Adding radial/chain forces would fight that force and push nodes out of bounds.
    // Skip the extra physics — visual highlighting/dimming still works fine.
    if (graphData.isBlobMode) {
      fg.d3Force("selRadial",     null);
      fg.d3Force("chainCentroid", null);
      return;
    }

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
            {types.diff_status_value !== undefined && (
              <option value="diff_status_value">diff status</option>
            )}
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
            <Tooltip tip="Reset spread to default">
              <button
                onClick={() => setForceSpread(SPREAD_DEFAULT)}
                title="Reset spread to default"
                style={{ fontSize:10, padding:"1px 6px", background:"var(--bg3)",
                  border:"1px solid var(--border2)", borderRadius:3,
                  color:"var(--text3)", cursor:"pointer", lineHeight:"16px" }}
              >↺</button>
            </Tooltip>
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
        {/* ── Icon-only quick toggles ─────────────────────────────────────── */}
        {/* Each button is a single icon; full description lives in the tooltip. */}
        <Tooltip tip={hideIsolated ? "Show all nodes (isolated nodes hidden)" : "Hide isolated nodes — no edges in or out"}>
          <button
            onClick={() => setHideIsolated(v => !v)}
            title={hideIsolated ? "Show isolated nodes (currently hidden)" : "Hide isolated nodes (no edges)"}
            style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
              border:"1px solid var(--border2)",
              background: hideIsolated ? "var(--blue)" : "var(--bg3)",
              color:       hideIsolated ? "#fff"       : "var(--text2)" }}
          >⊘</button>
        </Tooltip>
        {/* Coupling + show-only — blob mode only */}
        {graphData.isBlobMode && (<>
          <Tooltip tip={couplingIds.size > 0
            ? `Clear coupling  (${crossEdgeSet.size} cross-boundary edges, ${couplingEndpoints.size} endpoints)`
            : `Coupling: highlight calls that cross group boundaries`}>
            <button
              onClick={handleCouplingToggle}
              title={couplingIds.size > 0
                ? `Clear coupling (${couplingIds.size} source nodes, ${couplingEndpoints.size} total endpoints, ${crossEdgeSet.size} cross-boundary edges)`
                : `Highlight cross-boundary callers (${crossEdgeSet.size} edges, ${couplingEndpoints.size} endpoints)`}
              style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
                border:"1px solid var(--border2)",
                background: couplingIds.size > 0 ? "#ff9f1c" : "var(--bg3)",
                color:       couplingIds.size > 0 ? "#0d1117"  : "var(--text2)" }}
            >🔀</button>
          </Tooltip>
          {couplingIds.size > 0 && (
            <Tooltip tip={couplingOnly
              ? `Show full graph  (currently filtered to ${couplingEndpoints.size} nodes)`
              : `Filter to ${couplingEndpoints.size} coupled nodes only`}>
              <button
                onClick={() => setCouplingOnly(o => !o)}
                title={couplingOnly
                  ? `Show full graph (filtering to ${couplingEndpoints.size} cross-boundary nodes)`
                  : `Filter to ${couplingEndpoints.size} cross-boundary nodes only`}
                style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
                  border:"1px solid var(--border2)",
                  background: couplingOnly ? "#ff9f1c" : "var(--bg3)",
                  color:       couplingOnly ? "#0d1117"  : "var(--text2)" }}
              >⊂</button>
            </Tooltip>
          )}
        </>)}
        <Tooltip tip="Search and select nodes by name  ( / or ⌘K )">
          <button
            onClick={() => setShowSearch(true)}
            title="Search and select nodes by name (/ or ⌘K)"
            style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
              border:"1px solid var(--border2)", background:"var(--bg3)", color:"var(--text2)" }}
          >🔍</button>
        </Tooltip>
        <Tooltip tip={nodeDot ? "Switch to labelled pill nodes" : "Dot mode — compact circles, no labels"}>
          <button
            onClick={() => setNodeDot(d => !d)}
            title={nodeDot ? "Switch back to labelled pill nodes" : "Switch to dot nodes (less visual noise for dense graphs)"}
            style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
              border:"1px solid var(--border2)",
              background: nodeDot ? "var(--blue)" : "var(--bg3)",
              color:       nodeDot ? "#fff"       : "var(--text2)" }}
          >⬤</button>
        </Tooltip>
        <Tooltip tip={invertFlow
          ? "Particles flowing ← incoming calls (click to restore outgoing)"
          : "Particles flowing → outgoing calls (click to reverse — show incoming)"}>
          <button
            onClick={() => setInvertFlow(v => !v)}
            title={invertFlow ? "Reverse particle flow: showing incoming calls" : "Reverse particle flow: showing outgoing calls"}
            style={{ fontSize:13, padding:"3px 7px", cursor:"pointer", borderRadius:4,
              border:"1px solid var(--border2)",
              background: invertFlow ? "var(--blue)" : "var(--bg3)",
              color:       invertFlow ? "#fff"       : "var(--text2)" }}
          >↩</button>
        </Tooltip>
        <span style={{ fontSize:11, color:"var(--text3)", whiteSpace:"nowrap" }} title="Visible edges / total edges">{visibleEdges}/{totalEdges} edges</span>
      </div>{/* end inner controls flex */}
      </div>{/* end gradient overlay */}

      {/* ForceGraph canvas fills the container */}
      <div
        style={{ position:"relative" }}
        onMouseMove={nodeDot ? (e) => {
          if (!tooltipRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          // Offset tooltip 14px right and 10px above the cursor
          tooltipRef.current.style.left = `${e.clientX - rect.left + 14}px`;
          tooltipRef.current.style.top  = `${e.clientY - rect.top  - 10}px`;
        } : undefined}
      >
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={fgRef}
              // key forces full d3 remount when node set changes.
              // Without this, d3's cached node references go stale after filters
              // change the node list, producing "node not found" or "Cannot set
              // property vx on string" crashes.
              // In coupling-only mode the node set changes, so include that in the key.
              key={(couplingOnlyData ?? graphData).nodes.map(n => n.id).sort().join("|")}
              width={size.w} height={size.h}
              graphData={couplingOnlyData ?? graphData}
              nodeLabel=""
              nodeVal={n => n.val}
              nodeColor={n => n.color}
              onRenderFramePre={graphData.isBlobMode ? (ctx, gs) => {
                // Use the active dataset (filtered in coupling-only mode, full otherwise)
                const activeNodes = (couplingOnlyData ?? graphData).nodes;

                // Periodically persist node positions so they survive
                // measure-only changes (same nodes, new colors/sizes).
                posFrameCountRef.current++;
                if (posFrameCountRef.current % 45 === 0) {
                  for (const node of activeNodes) {
                    if (node.x != null && !isNaN(node.x))
                      nodePositionsRef.current.set(node.id, { x: node.x, y: node.y });
                  }
                }

                // Draw nested amorphous blobs behind nodes — one ring per
                // blob level (outermost first so inner blobs paint over them).
                // Blobs are separated by physics forces, not canvas clipping.
                //
                // Visual hierarchy per level:
                //   Level 0 (outer): large padding, low opacity  → territory markers
                //   Level 1+        : smaller padding, more opaque → clear sub-groups
                //
                // Inner-level blobs inherit their outer group's palette colour
                // so the colour relationship is visually obvious.

                const numLevels = blobLevelCount;  // e.g. 1 for 2-dim, 2 for 3-dim

                // Collect positions keyed by group key at each level
                // levelGroupPos[L] = Map<groupKey → [[x,y], ...]>
                const levelGroupPos = Array.from({ length: numLevels }, () => new Map());
                for (const node of activeNodes) {
                  if (node.x == null) continue;
                  for (let L = 0; L < numLevels; L++) {
                    const gk = getGroupKey(node, L);
                    if (!gk) continue;
                    if (!levelGroupPos[L].has(gk)) levelGroupPos[L].set(gk, []);
                    levelGroupPos[L].get(gk).push([node.x, node.y]);
                  }
                }

                // Draw outermost level first → innermost last (higher z-order)
                for (let L = 0; L < numLevels; L++) {
                  // Styling: outer = large/faint, inner = tight/brighter
                  const isOuter   = L === 0;
                  const padding   = Math.max(12, (32 - L * 10)) / gs;
                  const lineWidth = (isOuter ? 1.5 : 1.0) / gs;
                  const labelSize = Math.max(9, 15 - L * 3) / gs;

                  for (const [gk, pts] of levelGroupPos[L]) {
                    // Outer group key is always gk's first segment (before '::')
                    const outerKey = gk.split("::")[0];
                    const base     = groupColorMap.get(outerKey) || "#888888";

                    const hull     = pts.length >= 3 ? convexHull(pts) : pts.map(p => [...p]);
                    drawBlob(ctx, hull, padding, lineWidth, base);

                    // Label: only at outermost level, or all levels when N > 2
                    if (isOuter || numLevels >= 2) {
                      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
                      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
                      // Show the last segment of the key (most specific label)
                      const label = gk.split("::").at(-1);
                      ctx.font         = `${isOuter ? "bold " : ""}${labelSize}px sans-serif`;
                      ctx.fillStyle    = base + (isOuter ? "99" : "cc");
                      ctx.textAlign    = "center";
                      ctx.textBaseline = "middle";
                      ctx.fillText(String(label), cx, cy - padding * 0.6);
                    }
                  }
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

                // Dimming priority:
                //  coupling-only  → all nodes full (non-coupling were already removed)
                //  coupling mode  → coupling nodes full, others 18% (selection can rescue)
                //  selection mode → reachable nodes full, others 18%
                //  neither        → all full
                const isVisible = (hasCoupling && !couplingOnly)
                  ? (isCoupling || (anySelected && isReachable))
                  : anySelected ? isReachable : true;
                ctx.globalAlpha = isVisible ? 1.0 : 0.18;

                const baseColor = nodeColorOverrides?.get(node.id) ?? node.color;
                const isDiffHighlight = nodeColorOverrides?.has(node.id) || highlightSet?.has(node.id);

                // ── Dot mode ─────────────────────────────────────────────────
                if (nodeDot) {
                  const r = node.val ?? 6;

                  // Diff glow
                  if (isDiffHighlight) {
                    ctx.beginPath(); ctx.arc(node.x, node.y, r + 9, 0, Math.PI * 2);
                    ctx.fillStyle = baseColor + "1a"; ctx.fill();
                    ctx.beginPath(); ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = baseColor; ctx.lineWidth = 1.8; ctx.stroke();
                  }
                  // Coupling halo
                  if (isCoupling) {
                    ctx.beginPath(); ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,159,28,0.85)"; ctx.lineWidth = 2.5; ctx.stroke();
                  }
                  // Selection halo
                  if (isSelected) {
                    ctx.beginPath(); ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2.5; ctx.stroke();
                  }
                  // Filled circle
                  ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
                  ctx.fillStyle   = isSelected ? lerpColor(baseColor, "#ffffff", 0.25) : baseColor;
                  ctx.fill();
                  ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.12)";
                  ctx.lineWidth   = isSelected ? 1.5 : 0.8;
                  ctx.stroke();

                  ctx.globalAlpha = 1.0;
                  node.__bckgDimensions = [r * 2, r * 2]; // for pointer area
                  return;
                }

                // ── Pill mode (default) ───────────────────────────────────────
                const full  = node.name || "";
                const short = full.includes("::") ? full.split("::").slice(1).join("::") : full;
                const label = short.length > MAX_LABEL ? short.slice(0, MAX_LABEL - 1) + "…" : short;
                const fs    = 11;
                ctx.font    = `600 ${fs}px monospace`;
                const tw    = ctx.measureText(label).width;
                const padX  = 8, padY = 5;
                const w     = Math.max(tw + padX * 2, 30);
                const h     = fs + padY * 2;

                // Diff glow ring
                if (isDiffHighlight) {
                  drawPill(ctx, node.x, node.y, w + 18, h + 18);
                  ctx.fillStyle = baseColor + "1a"; ctx.fill();
                  drawPill(ctx, node.x, node.y, w + 10, h + 10);
                  ctx.strokeStyle = baseColor; ctx.lineWidth = 1.8; ctx.stroke();
                }
                // Coupling halo
                if (isCoupling) {
                  drawPill(ctx, node.x, node.y, w + 12, h + 12);
                  ctx.strokeStyle = "rgba(255,159,28,0.85)"; ctx.lineWidth = 2.5; ctx.stroke();
                }
                // Selection halo
                if (isSelected) {
                  drawPill(ctx, node.x, node.y, w + 7, h + 7);
                  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2.5; ctx.stroke();
                }
                // Pill background + label
                drawPill(ctx, node.x, node.y, w, h);
                ctx.fillStyle   = isSelected ? lerpColor(baseColor, "#ffffff", 0.25) : baseColor;
                ctx.fill();
                ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.12)";
                ctx.lineWidth   = isSelected ? 1.5 : 0.8;
                ctx.stroke();
                ctx.fillStyle    = "#0d1117";
                ctx.textAlign    = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, node.x, node.y);

                ctx.globalAlpha = 1.0;
                node.__bckgDimensions = [w, h];
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                const [w = 40, h = 20] = node.__bckgDimensions || [];
                if (nodeDot) {
                  const r = (w / 2) || 6;
                  ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
                  ctx.fillStyle = color; ctx.fill();
                } else {
                  drawPill(ctx, node.x, node.y, w, h);
                  ctx.fillStyle = color; ctx.fill();
                }
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
              linkDirectionalParticleSpeed={invertFlow ? -0.004 : 0.004}
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
              onNodeHover={(node) => {
                const el = tooltipRef.current;
                if (!el) return;
                if (node && nodeDot) {
                  el.textContent = node.id;
                  el.style.display = "block";
                } else {
                  el.style.display = "none";
                }
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
            <div style={{ height:size.h, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text3)" }}>
              No nodes to display.
            </div>
          )}

        {/* ── Dot-mode node hover tooltip ─────────────────────────────── */}
        {/* Always in the DOM; shown/hidden and positioned imperatively so   */}
        {/* hover events never trigger a React re-render (which would reset  */}
        {/* ForceGraph2D's particle animation timing).                        */}
        <div
          ref={tooltipRef}
          style={{
            display:       "none",     // shown imperatively via onNodeHover
            position:      "absolute",
            pointerEvents: "none",
            zIndex:        60,
            background:    "var(--bg0, #0d1117)",
            border:        "1px solid var(--border2, #30363d)",
            borderRadius:  5,
            padding:       "4px 10px",
            fontSize:      12,
            fontFamily:    "monospace",
            color:         "var(--text, #e6edf3)",
            whiteSpace:    "nowrap",
            boxShadow:     "0 3px 10px rgba(0,0,0,0.55)",
            left:          0,
            top:           0,
          }}
        />

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
