/**
 * Simulation runner — shared utility for tests.
 *
 * Runs a D3 force simulation to convergence and returns settled node positions.
 * Config mirrors production GraphRenderer.jsx settings so test results
 * are comparable to what a user actually sees.
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force-3d";

/**
 * Default simulation config matching production GraphRenderer.jsx.
 * Override any of these in the config argument.
 */
export const PRODUCTION_CONFIG = {
  linkDistance: 120,
  linkStrengthSameGroup: 0.4,
  linkStrengthCrossGroup: 0.02,
  charge: -100,                   // stronger than blob-mode -30; blob forces are absent in tests
  collisionRadius: (n) => (n.val ?? 6) + 15,
  collisionStrength: 0.85,
  ticks: 500,                     // more ticks for convergence
  prePositionGroups: true,        // spread groups into a circle before sim starts
};

/**
 * Run simulation.
 *
 * @param {Array}  nodes   — [{ id, group?, val?, x?, y? }] (mutated in-place by D3)
 * @param {Array}  links   — [{ source, target }]
 * @param {object} config  — overrides for PRODUCTION_CONFIG
 * @returns {Array} settled nodes with x, y set
 */
export function runSimulation(nodes, links, config = {}) {
  const cfg = { ...PRODUCTION_CONFIG, ...config };

  // Clone so callers can pass the same array multiple times
  const ns = nodes.map((n) => ({ ...n }));
  const ls = links.map((l) => ({ ...l }));

  // Always pre-position nodes deterministically — D3's random starts cause flaky tests.
  // Multi-group: spread groups around a large circle, members clustered near group center.
  // Single-group: spread all nodes around a circle (sim rearranges into natural shape).
  {
    const groups = [...new Set(ns.map((n) => n.group ?? "__default__"))];
    const groupSpread = Math.max(300, cfg.linkDistance * Math.sqrt(groups.length) * 1.8);

    groups.forEach((g, gi) => {
      const groupAngle = (gi / groups.length) * 2 * Math.PI;
      const cx = groups.length > 1 ? Math.cos(groupAngle) * groupSpread : 0;
      const cy = groups.length > 1 ? Math.sin(groupAngle) * groupSpread : 0;
      const members = ns.filter((n) => (n.group ?? "__default__") === g);
      const memberSpread = Math.max(80, cfg.linkDistance * Math.sqrt(members.length) * 0.5);
      members.forEach((n, ni) => {
        const angle = (ni / members.length) * 2 * Math.PI;
        n.x = cx + Math.cos(angle) * memberSpread;
        n.y = cy + Math.sin(angle) * memberSpread;
      });
    });
  }

  const sim = forceSimulation(ns)
    .numDimensions(2)             // ← 2D only, matching production react-force-graph-2d
    .force(
      "link",
      forceLink(ls)
        .id((n) => n.id)
        .distance(cfg.linkDistance)
        .strength((l) => {
          const sid = typeof l.source === "object" ? l.source.id : l.source;
          const tid = typeof l.target === "object" ? l.target.id : l.target;
          const s = ns.find((n) => n.id === sid);
          const t = ns.find((n) => n.id === tid);
          if (!s || !t) return cfg.linkStrengthSameGroup;
          return (s.group ?? "__default__") === (t.group ?? "__default__")
            ? cfg.linkStrengthSameGroup
            : cfg.linkStrengthCrossGroup;
        })
    )
    .force("charge", forceManyBody().strength(cfg.charge))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(cfg.collisionRadius).strength(cfg.collisionStrength))
    .stop();

  // Main settling phase
  for (let i = 0; i < cfg.ticks; i++) sim.tick();

  // For multi-group scenarios: apply a direct group-separation push after settling.
  // This mirrors GraphRenderer's Stage 3 group centroid separation force.
  {
    const groups = [...new Set(ns.map((n) => n.group ?? "__default__"))];
    if (groups.length > 1) {
      _applyGroupSeparation(ns, groups, cfg.linkDistance);
      // Re-settle after push
      for (let i = 0; i < Math.floor(cfg.ticks * 0.3); i++) sim.tick();
    }
  }

  return ns;
}

/**
 * Direct position-based group separation (alpha-independent, mirrors GraphRenderer Stage 3).
 * For each pair of groups whose centroids are too close, push all members apart.
 */
function _applyGroupSeparation(ns, groups, linkDistance) {
  const minDist = linkDistance * 2.5;

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const gA = ns.filter((n) => (n.group ?? "__default__") === groups[i]);
      const gB = ns.filter((n) => (n.group ?? "__default__") === groups[j]);

      const cA = { x: gA.reduce((s, n) => s + n.x, 0) / gA.length, y: gA.reduce((s, n) => s + n.y, 0) / gA.length };
      const cB = { x: gB.reduce((s, n) => s + n.x, 0) / gB.length, y: gB.reduce((s, n) => s + n.y, 0) / gB.length };

      const dx = cB.x - cA.x, dy = cB.y - cA.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d < minDist) {
        const push = (minDist - d) / 2;
        const ux = dx / d, uy = dy / d;
        gA.forEach((n) => { n.x -= ux * push; n.y -= uy * push; });
        gB.forEach((n) => { n.x += ux * push; n.y += uy * push; });
      }
    }
  }
}

/**
 * Run two simulations with different configs and return both results.
 * Useful for renderer comparison harness.
 */
export function compareConfigs(nodes, links, configA, configB) {
  return {
    a: runSimulation(nodes, links, configA),
    b: runSimulation(nodes, links, configB),
  };
}

// ---------------------------------------------------------------------------
// Test graph factories
// ---------------------------------------------------------------------------

/** Linear pipeline: n nodes connected in a chain. */
export function makePipeline(n = 6, group = "module_a") {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, group }));
  const links = Array.from({ length: n - 1 }, (_, i) => ({ source: `p${i}`, target: `p${i + 1}` }));
  return { nodes, links };
}

/** Hub-and-spoke: 1 hub + n spokes, all in same group. */
export function makeHub(spokes = 8, group = "module_a") {
  const nodes = [
    { id: "hub", group, val: 12 },
    ...Array.from({ length: spokes }, (_, i) => ({ id: `spoke${i}`, group })),
  ];
  const links = Array.from({ length: spokes }, (_, i) => ({
    source: "hub",
    target: `spoke${i}`,
  }));
  return { nodes, links, hubId: "hub" };
}

/** Two separate modules with a handful of cross-module edges. */
export function makeTwoModules(nodesPerModule = 6, crossEdges = 2) {
  const modA = Array.from({ length: nodesPerModule }, (_, i) => ({ id: `a${i}`, group: "module_a" }));
  const modB = Array.from({ length: nodesPerModule }, (_, i) => ({ id: `b${i}`, group: "module_b" }));
  const nodes = [...modA, ...modB];

  // Within-module chains
  const linksA = Array.from({ length: nodesPerModule - 1 }, (_, i) => ({ source: `a${i}`, target: `a${i + 1}` }));
  const linksB = Array.from({ length: nodesPerModule - 1 }, (_, i) => ({ source: `b${i}`, target: `b${i + 1}` }));
  // Cross-module edges
  const crossLinks = Array.from({ length: crossEdges }, (_, i) => ({
    source: `a${i}`,
    target: `b${i}`,
  }));

  return { nodes, links: [...linksA, ...linksB, ...crossLinks] };
}

/** Funnel: multiple sources → one sink. */
export function makeFunnel(sources = 6, group = "module_a") {
  const nodes = [
    { id: "sink", group, val: 10 },
    ...Array.from({ length: sources }, (_, i) => ({ id: `src${i}`, group })),
  ];
  const links = Array.from({ length: sources }, (_, i) => ({
    source: `src${i}`,
    target: "sink",
  }));
  return { nodes, links, funnelSinkId: "sink" };
}

/** Three-module layered architecture: api → service → data. */
export function makeLayered(nodesPerLayer = 4) {
  const layers = ["api", "service", "data"];
  const nodes = layers.flatMap((layer, li) =>
    Array.from({ length: nodesPerLayer }, (_, i) => ({ id: `${layer}${i}`, group: layer }))
  );
  const links = [];
  for (let li = 0; li < layers.length - 1; li++) {
    for (let i = 0; i < nodesPerLayer; i++) {
      links.push({ source: `${layers[li]}${i}`, target: `${layers[li + 1]}${i}` });
    }
  }
  const layerAssignments = Object.fromEntries(
    nodes.map((n) => [n.id, layers.indexOf(n.group)])
  );
  return { nodes, links, layerAssignments };
}

/** Dense graph: many nodes, many edges (stress test). */
export function makeDense(n = 30, edgesPerNode = 3, numGroups = 3) {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    group: `g${i % numGroups}`,
  }));
  const links = [];
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= edgesPerNode; j++) {
      links.push({ source: `n${i}`, target: `n${(i + j) % n}` });
    }
  }
  return { nodes, links };
}

/** Two chains in the same group (tests whether separate chains stay separate). */
export function makeTwoChains(chainLength = 4, group = "module_a") {
  const chainA = Array.from({ length: chainLength }, (_, i) => ({ id: `ca${i}`, group }));
  const chainB = Array.from({ length: chainLength }, (_, i) => ({ id: `cb${i}`, group }));
  const links = [
    ...Array.from({ length: chainLength - 1 }, (_, i) => ({ source: `ca${i}`, target: `ca${i + 1}` })),
    ...Array.from({ length: chainLength - 1 }, (_, i) => ({ source: `cb${i}`, target: `cb${i + 1}` })),
  ];
  return { nodes: [...chainA, ...chainB], links };
}
