/**
 * run_scenarios.js  —  Instrumentation runner
 *
 * Runs named graph scenarios through the D3 force simulation, measures
 * each settled layout with layout_metrics.js, and writes the facts to
 * user_simulation/instrumentation/output/<scenario>.json.
 *
 * The JSON files are consumed by perceptions.py → judgement.py.
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY }
  from "d3-force-3d";
import { computeFacts } from "./layout_metrics.js";

const __dir   = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, "output");

// ── Simulation ────────────────────────────────────────────────────────────────

const L = 120;

function node(id, group = "M", val = 6) {
  return { id, group, groupPath: [group], val, x: 0, y: 0, vx: 0, vy: 0 };
}

// ── Fix 1: Degree-based node sizing ─────────────────────────────────────────
// Encodes structural importance (degree) into visual size so node_size_cv > 0.
// High-degree hubs get larger val; leaf nodes stay small. Matches the kind of
// size encoding the real app uses for enriched graphs (utility_score / degree).
function assignDegreeBasedSizes(nodes, links) {
  const deg = {};
  links.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    deg[s] = (deg[s] || 0) + 1;
    deg[t] = (deg[t] || 0) + 1;
  });
  nodes.forEach(n => {
    const d = deg[n.id] || 1;
    // Always override with degree-based size. Higher-degree nodes (hubs,
    // bridges) get significantly larger val, producing non-trivial node_size_cv.
    // val = 4 + degree * 4  →  leaf=8, degree-2=12, hub-8=36, hub-20=84
    n.val = Math.max(4, Math.round(4 + d * 4));
  });
}

// ── Fix 2: Chain elongation via topological forceX ───────────────────────────
// For single-module linear-chain topologies (max-degree ≤ 2, connected) the
// D3 charge force causes nodes to curl into a ring instead of a line.
// We detect the chain order and add a forceX that anchors each node to its
// position along the chain, producing a straight horizontal layout.
function detectLinearChain(nodes, links) {
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  links.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (adj[s]) adj[s].push(t);
    if (adj[t]) adj[t].push(s);
  });
  const endpoints = nodes.filter(n => adj[n.id].length === 1);
  if (endpoints.length !== 2) return null;   // not a simple path
  const order = [];
  const visited = new Set();
  let cur = endpoints[0].id;
  while (cur) {
    order.push(cur);
    visited.add(cur);
    cur = (adj[cur] || []).find(id => !visited.has(id)) ?? null;
  }
  return order.length === nodes.length ? order : null;
}

// ── Fix 3: Inter-blob centroid repulsion (position-based) ────────────────────
// Cross-module edges pull blobs together, causing negative minClearance.
// This force pushes module centroids apart whenever they'd overlap, using
// direct position updates (like forceCollide) so it stays effective after
// the simulation has cooled and link forces would otherwise win.
function makeBlobRepulsion(nodes, targetClearance = 80) {
  const groupMap = {};
  nodes.forEach(n => {
    if (!groupMap[n.group]) groupMap[n.group] = [];
    groupMap[n.group].push(n);
  });
  const groups = Object.keys(groupMap);

  return function blobRepulsion() {
    // Recompute centroids and radii each tick (nodes move)
    const centroids = {}, radii = {};
    groups.forEach(g => {
      const ns = groupMap[g];
      const cx = ns.reduce((s, n) => s + n.x, 0) / ns.length;
      const cy = ns.reduce((s, n) => s + n.y, 0) / ns.length;
      centroids[g] = { x: cx, y: cy };
      radii[g] = ns.reduce((mx, n) => {
        const r = Math.hypot(n.x - cx, n.y - cy) + (n.val ?? 6) + 12;
        return Math.max(mx, r);
      }, 40);
    });

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const g1 = groups[i], g2 = groups[j];
        const dx = centroids[g2].x - centroids[g1].x;
        const dy = centroids[g2].y - centroids[g1].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist = radii[g1] + radii[g2] + targetClearance;
        if (dist >= minDist) continue;

        // Position correction: split evenly, cap at 8px per tick for stability
        const correction = Math.min(8, (minDist - dist) * 0.4);
        const nx = dx / dist, ny = dy / dist;
        groupMap[g1].forEach(n => { n.x -= nx * correction; n.y -= ny * correction; });
        groupMap[g2].forEach(n => { n.x += nx * correction; n.y += ny * correction; });
      }
    }
  };
}

// ── Fix 5: Per-module chain straightening ────────────────────────────────────
// For multi-module graphs, chains within each module curl into arcs because
// the charge force spreads them radially and there's no alignment constraint.
// This force detects linear chains per module and nudges their nodes toward a
// straight horizontal line through the module centroid each tick.
function makePerModuleChainForce(nodes, links, strength = 0.30) {
  const nodeGroup = {};
  const nodeById  = {};
  nodes.forEach(n => { nodeGroup[n.id] = n.group; nodeById[n.id] = n; });

  // Build intra-module links list (string IDs)
  const intraLinks = [];
  links.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (nodeGroup[s] === nodeGroup[t]) intraLinks.push({ source: s, target: t });
  });

  // Detect chain order per module
  const groups = [...new Set(nodes.map(n => n.group))];
  const chainsByGroup = {};
  for (const g of groups) {
    const modNodes = nodes.filter(n => n.group === g);
    const modLinks = intraLinks.filter(l =>
      nodeGroup[l.source] === g && nodeGroup[l.target] === g);
    const order = detectLinearChain(modNodes, modLinks);
    if (order && order.length >= 3) chainsByGroup[g] = order;
  }
  if (Object.keys(chainsByGroup).length === 0) return null;

  return function perModuleChainAlign() {
    for (const [g, order] of Object.entries(chainsByGroup)) {
      const chainNodes = order.map(id => nodeById[id]).filter(Boolean);
      const n = chainNodes.length;
      if (n < 2) continue;

      // Dynamic centroid of this module's chain nodes
      const cx = chainNodes.reduce((s, nd) => s + nd.x, 0) / n;
      const cy = chainNodes.reduce((s, nd) => s + nd.y, 0) / n;

      // Target: spread nodes horizontally by L per step around centroid
      chainNodes.forEach((nd, i) => {
        const targetX = cx + (i / (n - 1) - 0.5) * L * (n - 1);
        const targetY = cy;
        nd.vx = (nd.vx || 0) + (targetX - nd.x) * strength;
        nd.vy = (nd.vy || 0) + (targetY - nd.y) * (strength * 0.5);
      });
    }
  };
}

// ── Fix 4: Hub centering force ────────────────────────────────────────────────
// Pulls each hub node (degree ≥ minDegree) toward the centroid of its direct
// neighbours each tick. This counteracts charge repulsion pushing the hub to the
// periphery of its own neighbourhood and keeps hub_centrality_error low.
function makeHubCenteringForce(nodes, links, minDegree = 3, strength = 0.20) {
  const nodeById = {};
  nodes.forEach(n => { nodeById[n.id] = n; });

  // Build INTRA-MODULE adjacency only — never pull hub toward cross-module neighbours.
  // Cross-module neighbours are deliberately separated by blob repulsion; pulling
  // hubs toward them would collapse that separation.
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  links.forEach(l => {
    const s  = typeof l.source === "object" ? l.source.id : l.source;
    const t  = typeof l.target === "object" ? l.target.id : l.target;
    const ns = nodeById[s], nt = nodeById[t];
    if (!ns || !nt) return;
    if (ns.group !== nt.group) return;   // skip cross-module links
    adj[s].push(t);
    adj[t].push(s);
  });

  // Only nodes with ≥ minDegree intra-module neighbours qualify as hubs
  const hubs = nodes.filter(n => (adj[n.id] || []).length >= minDegree);

  return function hubCentering() {
    for (const hub of hubs) {
      const nbIds = adj[hub.id] || [];
      if (!nbIds.length) continue;
      let cx = 0, cy = 0, cnt = 0;
      for (const id of nbIds) {
        const nb = nodeById[id];
        if (nb) { cx += nb.x; cy += nb.y; cnt++; }
      }
      if (!cnt) continue;
      cx /= cnt; cy /= cnt;
      hub.x += (cx - hub.x) * strength;
      hub.y += (cy - hub.y) * strength;
    }
  };
}

// ── Crossing-optimal circular order ──────────────────────────────────────────
// Given n module groups and their pairwise edge weights, find the circular
// ordering that minimises weighted corridor-corridor crossings.
//
// Two corridors (A,C) and (B,D) cross iff B and D are interleaved with A and C
// on the circle (i.e., going clockwise: A…B…C…D or A…D…C…B).
//
// For n ≤ 8: enumerate all (n-1)! orderings (max 5040 for n=8).
// For n > 8: 2-opt hill-climb until no swap reduces the crossing count.
function findOptimalCircularOrder(groups, pairWeights) {
  const n = groups.length;
  if (n <= 2) return groups;

  const corridors = Object.entries(pairWeights); // [[key, weight], ...]

  function weightedCrossings(order) {
    const pos = new Map(order.map((g, i) => [g, i]));
    let cost = 0;
    for (let i = 0; i < corridors.length; i++) {
      const [kA, wA] = corridors[i];
      const [a1, a2] = kA.split('|');
      const ia1 = pos.get(a1), ia2 = pos.get(a2);
      if (ia1 == null || ia2 == null) continue;
      for (let j = i + 1; j < corridors.length; j++) {
        const [kB, wB] = corridors[j];
        const [b1, b2] = kB.split('|');
        const ib1 = pos.get(b1), ib2 = pos.get(b2);
        if (ib1 == null || ib2 == null) continue;
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
        // Corridors cross if b1 and b2 interleave a1 and a2 on the circle
        const [lo, hi] = ia1 < ia2 ? [ia1, ia2] : [ia2, ia1];
        const arcLen   = hi - lo;
        const b1InArc  = ib1 > lo && ib1 < hi;
        const b2InArc  = ib2 > lo && ib2 < hi;
        if (b1InArc !== b2InArc) cost += wA + wB;
      }
    }
    return cost;
  }

  if (n <= 8) {
    // Exact: enumerate (n-1)! permutations with first element fixed
    const fixed = groups[0];
    const rest  = groups.slice(1);
    let bestOrder    = [fixed, ...rest];
    let bestCrossings = weightedCrossings(bestOrder);

    function permute(arr, cur) {
      if (arr.length === 0) {
        const order = [fixed, ...cur];
        const c = weightedCrossings(order);
        if (c < bestCrossings) { bestCrossings = c; bestOrder = order; }
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, arr[i]]);
      }
    }
    permute(rest, []);
    return bestOrder;
  }

  // Greedy 2-opt for larger n: repeatedly swap adjacent pairs
  let order   = [...groups];
  let cost    = weightedCrossings(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
      const c = weightedCrossings(order);
      if (c < cost) { cost = c; improved = true; }
      else           { [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
    }
  }
  return order;
}

// ── Meta-simulation: topology-aware initial blob positions ───────────────────
// Two-step approach:
//   1. Find the crossing-optimal circular ordering for the modules
//      (minimises the number of corridor-corridor crossing pairs).
//   2. Start the meta spring-sim from that circular order so that it refines
//      positions while mostly preserving the crossing-optimal arrangement.
//
// For ≤ 8 modules the crossing optimisation is exact (enumerate all orderings).
// For larger counts a 2-opt heuristic is used.
//
// Returns { moduleId → {x, y} } or null for single/two-module graphs.
function metaSimPositions(nodes, links) {
  const nodeGroup = {};
  nodes.forEach(n => { nodeGroup[n.id] = n.group; });
  const groups = [...new Set(nodes.map(n => n.group))];

  if (groups.length < 3) return null;

  // Count cross-module edges per group pair
  const pairWeights = {};
  links.forEach(l => {
    const s  = typeof l.source === 'object' ? l.source.id : l.source;
    const t  = typeof l.target === 'object' ? l.target.id : l.target;
    const gs = nodeGroup[s], gt = nodeGroup[t];
    if (!gs || !gt || gs === gt) return;
    const key = gs < gt ? `${gs}|${gt}` : `${gt}|${gs}`;
    pairWeights[key] = (pairWeights[key] || 0) + 1;
  });

  if (Object.keys(pairWeights).length === 0) return null;

  const maxWeight  = Math.max(...Object.values(pairWeights));
  const targetSpread = Math.max(400, L * Math.sqrt(groups.length) * 2.2);

  // Step 1: crossing-optimal circular order
  const optOrder = findOptimalCircularOrder(groups, pairWeights);

  // Step 2: place meta-nodes on the circle using the optimal order
  const metaNodes = optOrder.map((g, i) => {
    const a = (i / optOrder.length) * 2 * Math.PI;
    return {
      id: g,
      x: Math.cos(a) * targetSpread * 0.5,
      y: Math.sin(a) * targetSpread * 0.5,
      vx: 0, vy: 0,
    };
  });

  // Step 3: spring refinement — pull strongly-coupled pairs closer together
  const metaLinks = Object.entries(pairWeights).map(([key, w]) => {
    const [g1, g2] = key.split('|');
    return {
      source: g1, target: g2, weight: w,
      _distance: targetSpread * 0.7 * Math.pow(maxWeight / w, 0.35),
      _strength: Math.min(0.9, 0.15 * w),
    };
  });

  const metaSim = forceSimulation(metaNodes)
    .numDimensions(2)
    .force("link", forceLink(metaLinks).id(n => n.id)
      .distance(l => l._distance)
      .strength(l => l._strength))
    .force("charge",  forceManyBody().strength(-1200))
    .force("center",  forceCenter(0, 0))
    .stop();

  for (let i = 0; i < 300; i++) metaSim.tick();

  const positions = {};
  metaNodes.forEach(mn => { positions[mn.id] = { x: mn.x, y: mn.y }; });
  return positions;
}

function settle(nodes, links, ticks = 800) {
  const groups = [...new Set(nodes.map(n => n.group))];

  // ── Fix 1: Degree-based sizes (before collision radii are computed) ─────────
  assignDegreeBasedSizes(nodes, links);

  // ── Initial positions: topology-aware blob placement via meta-simulation ────
  // For 3+ modules, run a lightweight blob-level spring layout first so that
  // strongly-coupled module pairs start adjacent (fewer routing violations).
  // For 1–2 modules, fall back to the simple circle placement.
  const spread  = Math.max(400, L * Math.sqrt(groups.length) * 2.2);
  const metaPos = metaSimPositions(nodes, links);

  // Scale meta-positions so the furthest blob centroid sits at `spread`
  let metaScale = 1;
  if (metaPos) {
    const maxDist = Math.max(1, ...Object.values(metaPos).map(p => Math.hypot(p.x, p.y)));
    metaScale = spread / maxDist;
  }

  groups.forEach((g, gi) => {
    let cx, cy;
    if (metaPos && metaPos[g]) {
      cx = metaPos[g].x * metaScale;
      cy = metaPos[g].y * metaScale;
    } else if (groups.length > 1) {
      const a = (gi / groups.length) * 2 * Math.PI;
      cx = Math.cos(a) * spread;
      cy = Math.sin(a) * spread;
    } else {
      cx = 0; cy = 0;
    }
    const mem = nodes.filter(n => n.group === g);
    const mr  = Math.max(80, L * Math.sqrt(mem.length) * 0.5);
    mem.forEach((n, i) => {
      const ma = (i / mem.length) * 2 * Math.PI;
      n.x = cx + Math.cos(ma) * mr;
      n.y = cy + Math.sin(ma) * mr;
    });
  });

  // ── Fix 2: Detect chain topology for elongation force ──────────────────────
  const chainOrder = groups.length === 1 ? detectLinearChain(nodes, links) : null;
  const chainPositions = chainOrder
    ? (() => {
        const w = L * (chainOrder.length - 1);
        const pos = {};
        chainOrder.forEach((id, i) => {
          pos[id] = (i / Math.max(1, chainOrder.length - 1) - 0.5) * w;
        });
        // Pre-position so the simulation starts near-converged
        nodes.forEach(n => {
          if (pos[n.id] != null) { n.x = pos[n.id]; n.y = (Math.random() - 0.5) * 30; }
        });
        return pos;
      })()
    : null;

  // ── Cross-module link map (for weakened strength / topology-aware distance) ──
  const nodeGroup = {};
  nodes.forEach(n => { nodeGroup[n.id] = n.group; });
  function isCross(l) {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return nodeGroup[s] !== nodeGroup[t];
  }

  // Count cross-module edges per module pair so we can scale link distances.
  // More edges between a pair → shorter target distance → they sit adjacent.
  // This is the force that makes the meta-sim topology-aware arrangement *stick*
  // through the full simulation instead of being scrambled by charge repulsion.
  const pairWeights = {};
  links.forEach(l => {
    const s  = typeof l.source === "object" ? l.source.id : l.source;
    const t  = typeof l.target === "object" ? l.target.id : l.target;
    const gs = nodeGroup[s], gt = nodeGroup[t];
    if (!gs || !gt || gs === gt) return;
    const key = gs < gt ? `${gs}|${gt}` : `${gt}|${gs}`;
    pairWeights[key] = (pairWeights[key] || 0) + 1;
  });
  const maxPairWeight = Math.max(1, ...Object.values(pairWeights), 0);

  function crossLinkDist(l) {
    const s  = typeof l.source === "object" ? l.source.id : l.source;
    const t  = typeof l.target === "object" ? l.target.id : l.target;
    const gs = nodeGroup[s], gt = nodeGroup[t];
    const key = gs < gt ? `${gs}|${gt}` : `${gt}|${gs}`;
    const w   = pairWeights[key] || 1;
    // Only adjust distance when there is actual variation in edge counts.
    // If all pairs have the same weight, keep the original L*2.5 (no regression).
    // When there IS variation: max-weight pair → L*1.5, min-weight → L*2.5.
    if (maxPairWeight <= 1) return L * 2.5;
    const t_norm = (w - 1) / (maxPairWeight - 1); // 0 at weakest, 1 at strongest
    return L * (2.5 - 1.0 * t_norm);              // L*2.5 → L*1.5
  }

  // ── Build simulation ────────────────────────────────────────────────────────
  const sim = forceSimulation(nodes)
    .numDimensions(2)
    .force("link", forceLink(links).id(n => n.id)
      // Cross-module links: much weaker + topology-scaled target distance.
      // Strong-coupling pairs get distance ≈ L*1.5; weak pairs ≈ L*3.0.
      .distance(l => isCross(l) ? crossLinkDist(l) : L)
      .strength(l => isCross(l) ? 0.02  : 0.4))
    .force("charge",  forceManyBody().strength(-120))
    .force("center",  forceCenter(0, 0))
    .force("collide", forceCollide(n => (n.val ?? 6) + 15).strength(0.85))
    .stop();

  // Fix 2: chain elongation
  if (chainPositions) {
    sim.force("chainX", forceX(n => chainPositions[n.id] ?? 0).strength(0.45));
    sim.force("chainY", forceY(0).strength(0.25));
  }

  // Fix 3: blob repulsion (only for multi-module graphs)
  if (groups.length >= 2) {
    sim.force("blobRepulsion", makeBlobRepulsion(nodes, 80));
  }

  // Fix 4: hub centering — pull hubs to centroid of their neighbourhood
  sim.force("hubCenter", makeHubCenteringForce(nodes, links, 3, 0.25));

  // Fix 5: per-module chain pre-positioning only (no ongoing force — avoids crossing regressions)

  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

/** Linear chain of n nodes in group g. */
function mkChain(prefix, g, n) {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  return {
    nodes: ids.map(id => node(id, g)),
    links: ids.slice(1).map((id, i) => ({ source: ids[i], target: id })),
  };
}

/** Hub-and-spoke: one central hub + nSpokes leaves in group g. */
function mkHub(prefix, g, nSpokes, hubVal = 12) {
  const hub    = node(`${prefix}hub`, g, hubVal);
  const spokes = Array.from({ length: nSpokes }, (_, i) => node(`${prefix}s${i}`, g));
  return {
    nodes: [hub, ...spokes],
    links: spokes.map(s => ({ source: hub.id, target: s.id })),
  };
}

/** Merge multiple module descriptors + explicit cross-edges into one graph. */
function combine(modules, crossEdges = []) {
  return {
    nodes: modules.flatMap(m => m.nodes),
    links: [
      ...modules.flatMap(m => m.links),
      ...crossEdges.map(([s, t]) => ({ source: s, target: t })),
    ],
  };
}

/** A chain where every node has a "side leaf" attached (bushy chain). */
function mkBushyChain(prefix, g, n) {
  const ids   = Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const leafs = ids.map((id, i) => node(`${prefix}l${i}`, g));
  return {
    nodes: [...ids.map(id => node(id, g)), ...leafs],
    links: [
      ...ids.slice(1).map((id, i) => ({ source: ids[i], target: id })),
      ...ids.map((id, i) => ({ source: id, target: leafs[i].id })),
    ],
  };
}

/** Star: all nodes point to a single sink. */
function mkStar(prefix, g, n) {
  const sink    = node(`${prefix}sink`, g, 14);
  const sources = Array.from({ length: n }, (_, i) => node(`${prefix}src${i}`, g));
  return {
    nodes: [sink, ...sources],
    links: sources.map(s => ({ source: s.id, target: sink.id })),
  };
}

/**
 * Complete graph (K_n): every node connected to every other.
 * All intra-module pairs have d=1 (ideal=120px) but D3 physically spreads
 * them far apart — the circular arrangement required forces many pairs to
 * actual distances of 200-400px vs the 120px ideal, giving high layout_stress.
 * Models: tightly-coupled utility class, circular-dependency cluster.
 */
function mkClique(prefix, g, n) {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const links = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      links.push({ source: ids[i], target: ids[j] });
  return { nodes: ids.map(id => node(id, g)), links };
}

/**
 * Hub + orphaned dead-code nodes (degree=0).
 * The isolated nodes drag the mean degree down, making the hub's high
 * degree extremely anomalous → degree_gini > 0.5.
 * Models: active subsystem surrounded by unreachable / dead-code functions.
 */
function mkDeadCodeHub(prefix, g, nSpokes, nDead) {
  const hub    = node(`${prefix}hub`, g, 12);
  const spokes = Array.from({ length: nSpokes }, (_, i) => node(`${prefix}s${i}`, g));
  const dead   = Array.from({ length: nDead },   (_, i) => node(`${prefix}d${i}`, g));
  return {
    nodes: [hub, ...spokes, ...dead],
    links: spokes.map(s => ({ source: hub.id, target: s.id })),
    // dead nodes have no edges → degree=0
  };
}

/** Tree: binary tree of depth d. */
function mkTree(prefix, g, depth) {
  const nodes = [], links = [];
  function build(id, d) {
    nodes.push(node(id, g, d === depth ? 6 : 10));
    if (d < depth) {
      const l = `${id}L`, r = `${id}R`;
      links.push({ source: id, target: l }, { source: id, target: r });
      build(l, d + 1); build(r, d + 1);
    }
  }
  build(`${prefix}root`, 0);
  return { nodes, links };
}

/** Diamond: two middle-layer nodes both depend on a root and both feed a sink. */
function mkDiamond(prefix, g) {
  const root = node(`${prefix}root`, g, 10);
  const mid1 = node(`${prefix}mid1`, g);
  const mid2 = node(`${prefix}mid2`, g);
  const sink = node(`${prefix}sink`, g, 10);
  return {
    nodes: [root, mid1, mid2, sink],
    links: [
      { source: root.id, target: mid1.id },
      { source: root.id, target: mid2.id },
      { source: mid1.id, target: sink.id },
      { source: mid2.id, target: sink.id },
    ],
  };
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = {

  // ── Single-module: chains ──────────────────────────────────────────────────

  chain_3:  () => mkChain("n", "M", 3),
  chain_4:  () => mkChain("n", "M", 4),
  chain_5:  () => mkChain("n", "M", 5),
  pipeline: () => mkChain("n", "M", 6),   // original
  chain_7:  () => mkChain("n", "M", 7),
  chain_8:  () => mkChain("n", "M", 8),
  chain_10: () => mkChain("n", "M", 10),
  chain_12: () => mkChain("n", "M", 12),
  chain_15: () => mkChain("n", "M", 15),

  // ── Single-module: hubs ───────────────────────────────────────────────────

  hub_3:        () => mkHub("h", "M", 3),
  hub_4:        () => mkHub("h", "M", 4),
  hub_and_spoke: () => mkHub("h", "M", 5),  // original
  hub_6:        () => mkHub("h", "M", 6),
  hub_7:        () => mkHub("h", "M", 7),
  hub_8:        () => mkHub("h", "M", 8),
  hub_10:       () => mkHub("h", "M", 10),
  hub_15:       () => mkHub("h", "M", 15),

  // ── Single-module: other topologies ──────────────────────────────────────

  star_5:       () => mkStar("n", "M", 5),
  star_8:       () => mkStar("n", "M", 8),
  star_12:      () => mkStar("n", "M", 12),
  tree_2:       () => mkTree("t", "M", 2),   // depth-2 binary tree: 7 nodes
  tree_3:       () => mkTree("t", "M", 3),   // depth-3 binary tree: 15 nodes
  bushy_chain_4: () => mkBushyChain("n", "M", 4),
  bushy_chain_6: () => mkBushyChain("n", "M", 6),
  diamond:      () => mkDiamond("d", "M"),

  // ── Two modules ───────────────────────────────────────────────────────────

  two_modules_small: () => combine(
    [mkChain("a", "A", 3), mkChain("b", "B", 3)],
    [["a2", "b0"]]
  ),
  two_modules_medium: () => combine(
    [mkChain("a", "A", 5), mkChain("b", "B", 5)],
    [["a4", "b0"], ["a2", "b2"]]
  ),
  two_modules_large: () => combine(
    [mkChain("a", "A", 8), mkChain("b", "B", 8)],
    [["a7", "b0"], ["a3", "b3"], ["a5", "b5"]]
  ),
  two_modules_asymmetric: () => combine(
    [mkChain("a", "A", 3), mkChain("b", "B", 8)],
    [["a2", "b0"]]
  ),
  two_modules_coupled: () => combine(
    [mkChain("a", "A", 5), mkChain("b", "B", 5)],
    [["a0","b0"], ["a1","b1"], ["a2","b2"], ["a3","b3"], ["a4","b4"]]
  ),
  two_modules_hub_chain: () => combine(
    [mkHub("a", "A", 4), mkChain("b", "B", 5)],
    [["ahub", "b0"]]
  ),
  two_modules_hub_hub: () => combine(
    [mkHub("a", "A", 4), mkHub("b", "B", 4)],
    [["ahub", "bhub"]]
  ),
  two_modules_star_chain: () => combine(
    [mkStar("a", "A", 5), mkChain("b", "B", 4)],
    [["asink", "b0"]]
  ),
  two_modules_deep: () => combine(
    [mkChain("a", "A", 10), mkChain("b", "B", 10)],
    [["a9", "b0"], ["a4", "b4"]]
  ),
  two_modules_trees: () => combine(
    [mkTree("a", "A", 2), mkTree("b", "B", 2)],
    [["aroot", "broot"]]
  ),

  // ── Three modules ─────────────────────────────────────────────────────────

  three_modules: () => combine(            // original
    [mkChain("a", "A", 5), mkChain("b", "B", 5), mkChain("c", "C", 5)],
    [["a4", "b0"], ["b4", "c0"]]
  ),
  three_modules_small: () => combine(
    [mkChain("a", "A", 3), mkChain("b", "B", 3), mkChain("c", "C", 3)],
    [["a2", "b0"], ["b2", "c0"]]
  ),
  three_modules_large: () => combine(
    [mkChain("a", "A", 8), mkChain("b", "B", 8), mkChain("c", "C", 8)],
    [["a7", "b0"], ["b7", "c0"], ["a3", "c3"]]
  ),
  three_modules_hubs: () => combine(
    [mkHub("a", "A", 4), mkHub("b", "B", 4), mkHub("c", "C", 4)],
    [["ahub", "bhub"], ["bhub", "chub"]]
  ),
  three_modules_mixed: () => combine(
    [mkChain("a", "A", 5), mkHub("b", "B", 4), mkChain("c", "C", 5)],
    [["a4", "bhub"], ["bhub", "c0"]]
  ),
  three_modules_coupled: () => combine(
    [mkChain("a", "A", 4), mkChain("b", "B", 4), mkChain("c", "C", 4)],
    [["a0","b0"], ["a1","b1"], ["a2","c0"], ["a3","c1"], ["b2","c2"], ["b3","c3"]]
  ),
  three_modules_star: () => combine(
    [mkChain("a", "A", 4), mkHub("b", "B", 5), mkChain("c", "C", 4)],
    [["a0", "bs0"], ["c0", "bs1"]]
  ),
  three_modules_asymmetric: () => combine(
    [mkChain("a", "A", 2), mkChain("b", "B", 5), mkChain("c", "C", 8)],
    [["a1", "b0"], ["b4", "c0"]]
  ),

  // ── Four modules ──────────────────────────────────────────────────────────

  four_modules_small: () => combine(
    [mkChain("a","A",3), mkChain("b","B",3), mkChain("c","C",3), mkChain("d","D",3)],
    [["a2","b0"], ["b2","c0"], ["c2","d0"]]
  ),
  four_modules_medium: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4), mkChain("c","C",4), mkChain("d","D",4)],
    [["a3","b0"], ["b3","c0"], ["c3","d0"]]
  ),
  four_modules_large: () => combine(
    [mkChain("a","A",5), mkChain("b","B",5), mkChain("c","C",5), mkChain("d","D",5)],
    [["a4","b0"], ["b4","c0"], ["c4","d0"], ["a2","c2"]]
  ),
  four_modules_pipeline: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4), mkChain("c","C",4), mkChain("d","D",4)],
    [["a3","b0"], ["b3","c0"], ["c3","d0"]]
  ),
  four_modules_star: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4), mkChain("c","C",4), mkHub("d","D",3)],
    [["a3","dhub"], ["b3","dhub"], ["c3","dhub"]]
  ),
  four_modules_coupled: () => combine(
    [mkChain("a","A",3), mkChain("b","B",3), mkChain("c","C",3), mkChain("d","D",3)],
    [["a0","b0"],["a1","c0"],["a2","d0"],["b1","c1"],["b2","d1"],["c2","d2"]]
  ),
  four_modules_hubs: () => combine(
    [mkHub("a","A",3), mkHub("b","B",3), mkHub("c","C",3), mkHub("d","D",3)],
    [["ahub","bhub"], ["bhub","chub"], ["chub","dhub"]]
  ),
  four_modules_mixed: () => combine(
    [mkChain("a","A",5), mkHub("b","B",4), mkChain("c","C",3), mkStar("d","D",4)],
    [["a4","bhub"], ["bhub","c0"], ["c2","dsink"]]
  ),

  // ── Five modules ──────────────────────────────────────────────────────────

  five_modules_small: () => combine(
    [mkChain("a","A",3), mkChain("b","B",3), mkChain("c","C",3),
     mkChain("d","D",3), mkChain("e","E",3)],
    [["a2","b0"], ["b2","c0"], ["c2","d0"], ["d2","e0"]]
  ),
  five_modules_medium: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4), mkChain("c","C",4),
     mkChain("d","D",4), mkChain("e","E",4)],
    [["a3","b0"], ["b3","c0"], ["c3","d0"], ["d3","e0"]]
  ),
  five_modules_star: () => combine(
    [mkHub("a","A",4), mkChain("b","B",3), mkChain("c","C",3),
     mkChain("d","D",3), mkChain("e","E",3)],
    [["ahub","b0"], ["ahub","c0"], ["ahub","d0"], ["ahub","e0"]]
  ),
  five_modules_ring: () => combine(
    [mkChain("a","A",3), mkChain("b","B",3), mkChain("c","C",3),
     mkChain("d","D",3), mkChain("e","E",3)],
    [["a2","b0"], ["b2","c0"], ["c2","d0"], ["d2","e0"], ["e2","a0"]]
  ),
  five_modules_hub: () => combine(
    [mkHub("a","A",3), mkHub("b","B",3), mkHub("c","C",3),
     mkHub("d","D",3), mkHub("e","E",3)],
    [["ahub","bhub"], ["ahub","chub"], ["ahub","dhub"], ["ahub","ehub"]]
  ),

  // ── Special topologies ────────────────────────────────────────────────────

  // Two modules with a shared high-degree bridge node
  bridge: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4)],
    [["a1","b0"], ["a2","b1"], ["a3","b2"], ["a0","b3"]]
  ),

  // Layered architecture: presentation → business → data
  layered_arch: () => combine(
    [mkChain("ui","UI",4), mkChain("svc","SVC",5), mkChain("db","DB",3)],
    [["ui3","svc0"], ["ui2","svc1"], ["svc4","db0"], ["svc3","db1"]]
  ),

  // Microservices: 6 tiny modules, very sparse coupling
  microservices: () => combine(
    [mkChain("a","Auth",2), mkChain("u","User",2), mkChain("p","Payment",2),
     mkChain("o","Order",2), mkChain("n","Notify",2), mkChain("g","Gateway",2)],
    [["g1","a0"], ["g1","u0"], ["o1","p0"], ["o1","n0"]]
  ),

  // Wide flat hub — stress-tests hub centrality
  hub_20: () => mkHub("h", "M", 20),

  // Very deep pipeline — stress-tests chain elongation
  pipeline_20: () => mkChain("n", "M", 20),

  // Binary tree (full, depth 3) with a sibling module
  tree_with_module: () => combine(
    [mkTree("t","Tree",3), mkChain("c","Chain",4)],
    [["troot", "c0"]]
  ),

  // Two modules where one is a dense star feeding into the other
  funnel: () => combine(
    [mkStar("a","A",8), mkChain("b","B",5)],
    [["asink","b0"], ["asink","b2"]]
  ),

  // Hourglass: star → hub → star
  hourglass: () => {
    const top  = mkStar("t","M",4);
    const bot  = mkStar("b","M",4);
    const mid  = node("mid","M",12);
    return {
      nodes: [...top.nodes, mid, ...bot.nodes],
      links: [
        ...top.links,
        { source: "tsink", target: "mid" },
        { source: "mid",   target: "bsink" },
        ...bot.links,
      ],
    };
  },

  // Six-module enterprise: 6 teams, intentionally sparse
  enterprise_6: () => combine(
    [mkChain("a","Auth",3),    mkChain("b","Billing",3),
     mkChain("c","Catalog",3), mkChain("d","Delivery",3),
     mkChain("e","Email",3),   mkChain("f","Frontend",3)],
    [["f2","a0"], ["f2","c0"], ["d2","b0"], ["d2","e0"], ["c2","d0"]]
  ),

  // Corridor-cross test: two pairs of strongly-coupled modules that end up on
  // opposite sides of the naive circle, so their corridors cross at the centre.
  // Groups created in order A, B, C, D → naive circle: A(0°) B(90°) C(180°) D(270°).
  // A-C (4 edges) get placed diagonally opposite, B-D (4 edges) also opposite.
  // The A-C corridor (horizontal) crosses the B-D corridor (vertical) at (0,0).
  // Expected: interModuleCrossings.ratio > 0 before meta-sim fix.
  four_modules_cross: () => combine(
    [mkHub("a","A",4), mkHub("b","B",4), mkHub("c","C",4), mkHub("d","D",4)],
    [
      // A ↔ C: strongly coupled (4 edges)
      ["ahub","chub"], ["as0","cs0"], ["as1","cs1"], ["as2","cs2"],
      // B ↔ D: strongly coupled (4 edges)
      ["bhub","dhub"], ["bs0","ds0"], ["bs1","ds1"], ["bs2","ds2"],
    ]
  ),

  // Gateway bypass: Frontend and Backend have strong direct coupling (4 edges),
  // but Gateway is also connected to both (2 edges each) and to Auth/DB.
  // With the naive circle layout, Gateway gets pulled between Frontend and
  // Backend, so the 4 FE→BE edges visually cross through the Gateway blob.
  // Expected: blob_edge_routing < 1.0 before meta-sim fix.
  five_modules_gateway: () => combine(
    [
      mkChain("fe",  "Frontend",  4),
      mkHub("gw",    "Gateway",   3),   // gwhub, gws0, gws1, gws2
      mkChain("be",  "Backend",   4),
      mkChain("au",  "Auth",      3),
      mkChain("db",  "DB",        3),
    ],
    [
      // Gateway ↔ Frontend (2 edges)
      ["fe3", "gwhub"], ["fe2", "gwhub"],
      // Gateway ↔ Backend (2 edges)
      ["gwhub", "be0"], ["gwhub", "be1"],
      // Frontend ↔ Backend — direct, STRONGER than via Gateway (4 edges)
      ["fe3", "be0"], ["fe2", "be1"], ["fe1", "be2"], ["fe0", "be3"],
      // Gateway ↔ Auth, Gateway ↔ DB (auxiliary connections)
      ["gwhub", "au0"], ["gwhub", "db0"],
    ]
  ),

  // Spaghetti: many cross-module edges — tests Fatima's Implies tolerance
  spaghetti: () => combine(
    [mkChain("a","A",4), mkChain("b","B",4), mkChain("c","C",4)],
    [
      ["a0","b0"],["a0","c0"],["a1","b1"],["a1","c1"],
      ["a2","b2"],["a2","c2"],["a3","b3"],["a3","c3"],
      ["b0","c0"],["b1","c1"],["b2","c2"],
    ]
  ),

  // ── Constraint-coverage scenarios ────────────────────────────────────────
  //
  // These exist specifically to fire antecedents that are never triggered by
  // normal topology scenarios, ensuring the Implies bodies get tested:
  //
  //   Kenji/Fatima: Implies(degree_gini > 0.5, hub_centrality_error <= 0.25)
  //     → needs degree_gini > 0.5
  //     → IMPOSSIBLE for any pure connected graph (pure star → gini → 0.5⁻)
  //     → requires degree-0 (orphaned) nodes to cross the threshold
  //
  //   Fatima: Implies(layout_stress > 1.2, cross_edge_visibility >= 0.9)
  //     → needs layout_stress > 1.2
  //     → complete graph K_n: all pairs d=1 (ideal=120px) but layout forces
  //       them into a large ring → many pairs at 2–4× ideal distance

  // Dead code hub: active hub + 8 orphaned dead-code nodes.
  // Computed gini = 0.658 (hub_10 + 8 isolates):
  //   n=19, degrees=[10, 1×10, 0×8] → gini = 250/380 ≈ 0.66 > 0.5  ✓
  dead_code_hub: () => mkDeadCodeHub("dc", "M", 10, 8),

  // Larger dead-code variant for extra margin.
  dead_code_hub_large: () => mkDeadCodeHub("dc", "M", 15, 10),

  // Complete graph K_10: layout_stress via circular arrangement.
  // All 45 pairs have d=1 (ideal=120px); D3 spreads into ring of r≈190px,
  // giving 3-apart pairs at ~310px and opposite pairs at ~390px vs 120 ideal.
  // Estimated perEdge ≈ 2.3 >> 1.2  ✓
  clique_10: () => mkClique("k", "M", 10),

  // Smaller clique for comparison (borderline stress).
  clique_8:  () => mkClique("k", "M", 8),

  // Dense clique with stress AND cross-module context: clique in one module,
  // chain in another.  Tests Fatima's layout_stress Implies with multi-module.
  clique_with_chain: () => combine(
    [mkClique("k","Clique",8), mkChain("c","Chain",4)],
    [["k0","c0"], ["k1","c0"]]
  ),
};

// ── Run and write ─────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
for (const [name, factory] of Object.entries(SCENARIOS)) {
  const { nodes, links } = factory();
  settle(nodes, links);
  const facts = computeFacts(nodes, links);
  const path  = resolve(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(facts, null, 2));
  count++;
}
console.log(`wrote ${count} scenarios to ${OUT_DIR}`);
