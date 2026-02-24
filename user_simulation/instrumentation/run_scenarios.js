/**
 * run_scenarios.js  —  Instrumentation runner
 *
 * Runs named graph scenarios through the D3 force simulation, measures
 * each settled layout with layout_metrics.js, and writes the facts to
 * user_simulation/instrumentation/output/<scenario>.json.
 *
 * The JSON files are consumed by perceptions.py → judgement.py.
 *
 * Usage (from repo root):
 *   node --experimental-vm-modules user_simulation/instrumentation/run_scenarios.js
 *
 * Or via the vitest runner (picks up the simulation environment):
 *   cd frontend && npx vitest run ../../user_simulation/instrumentation/run_scenarios.js
 *
 * To run against a different codebase: write your own runner that produces
 * the same JSON schema and drop it alongside this file.
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide }
  from "d3-force-3d";
import { computeFacts } from "./layout_metrics.js";

const __dir    = dirname(fileURLToPath(import.meta.url));
const OUT_DIR  = resolve(__dir, "output");

// ── Simulation helper ─────────────────────────────────────────────────────────

const L = 120;

function node(id, group = "M", val = 6) {
  return { id, group, groupPath: [group], val, x: 0, y: 0, vx: 0, vy: 0 };
}

function settle(nodes, links, ticks = 600) {
  // Spread groups in a circle before simulation (mirrors GraphRenderer.jsx)
  const groups  = [...new Set(nodes.map(n => n.group))];
  const spread  = Math.max(300, L * Math.sqrt(groups.length) * 1.8);
  groups.forEach((g, gi) => {
    const a   = (gi / groups.length) * 2 * Math.PI;
    const cx  = groups.length > 1 ? Math.cos(a) * spread : 0;
    const cy  = groups.length > 1 ? Math.sin(a) * spread : 0;
    const mem = nodes.filter(n => n.group === g);
    const mr  = Math.max(80, L * Math.sqrt(mem.length) * 0.5);
    mem.forEach((n, i) => {
      const ma = (i / mem.length) * 2 * Math.PI;
      n.x = cx + Math.cos(ma) * mr;
      n.y = cy + Math.sin(ma) * mr;
    });
  });

  const sim = forceSimulation(nodes)
    .numDimensions(2)
    .force("link",    forceLink(links).id(n => n.id).distance(L).strength(0.5))
    .force("charge",  forceManyBody().strength(-120))
    .force("center",  forceCenter(0, 0))
    .force("collide", forceCollide(n => (n.val ?? 6) + 15).strength(0.85))
    .stop();

  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = {

  pipeline: () => {
    const ids   = ["parse", "validate", "transform", "enrich", "save", "respond"];
    const nodes = ids.map(id => node(id));
    const links = ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
    return { nodes, links };
  },

  hub_and_spoke: () => {
    const nodes = [node("router", "M", 14),
      ...["handlerA","handlerB","handlerC","handlerD","handlerE"].map(id => node(id))];
    const links = nodes.slice(1).map(n => ({ source: "router", target: n.id }));
    return { nodes, links };
  },

  three_modules: () => {
    const mk = (prefix, g, n) =>
      Array.from({ length: n }, (_, i) => node(`${prefix}${i}`, g));
    const nodesA = mk("a", "A", 5);
    const nodesB = mk("b", "B", 5);
    const nodesC = mk("c", "C", 5);
    const nodes  = [...nodesA, ...nodesB, ...nodesC];
    const links  = [
      ...nodesA.slice(1).map((n, i) => ({ source: nodesA[i].id, target: n.id })),
      ...nodesB.slice(1).map((n, i) => ({ source: nodesB[i].id, target: n.id })),
      ...nodesC.slice(1).map((n, i) => ({ source: nodesC[i].id, target: n.id })),
      { source: "a4", target: "b0" },
      { source: "b4", target: "c0" },
    ];
    return { nodes, links };
  },

};

// ── Run and write ─────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, factory] of Object.entries(SCENARIOS)) {
  const { nodes, links } = factory();
  settle(nodes, links);
  const facts = computeFacts(nodes, links);
  const path  = resolve(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(facts, null, 2));
  console.log(`wrote ${path}`);
}
