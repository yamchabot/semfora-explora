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
  charge: -30,                    // blob mode default
  chargeNonBlob: -120,            // non-blob default (forceSpread slider midpoint)
  collisionRadius: (n) => (n.val ?? 6) + 15,
  collisionStrength: 0.85,
  ticks: 300,                     // enough to converge
  blobMode: true,                 // most interesting tests are blob mode
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

  const sim = forceSimulation(ns)
    .force(
      "link",
      forceLink(ls)
        .id((n) => n.id)
        .distance(cfg.linkDistance)
        .strength((l) => {
          const s = ns.find((n) => n.id === (typeof l.source === "object" ? l.source.id : l.source));
          const t = ns.find((n) => n.id === (typeof l.target === "object" ? l.target.id : l.target));
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

  for (let i = 0; i < cfg.ticks; i++) sim.tick();

  return ns;
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
