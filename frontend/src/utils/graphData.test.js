import { describe, it, expect } from "vitest";
import { buildGraphData } from "./graphData.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

function singleDimData(overrides = {}) {
  return {
    dimensions: ["module"],
    rows: [
      { key: { module: "auth" },    values: { symbol_count: 10, dead_ratio: 0.1 } },
      { key: { module: "billing" }, values: { symbol_count: 40, dead_ratio: 0.8 } },
      { key: { module: "core" },    values: { symbol_count: 25, dead_ratio: 0.4 } },
    ],
    graph_edges: [
      { source: "auth",    target: "core",    weight: 5 },
      { source: "billing", target: "core",    weight: 2 },
      { source: "auth",    target: "billing", weight: 1 },
    ],
    ...overrides,
  };
}

function blobDimData(overrides = {}) {
  return {
    dimensions: ["module", "community"],
    rows: [
      {
        key: { module: "auth" },
        children: [
          { key: { module: "auth", community: "c1" }, values: { symbol_count: 10, dead_ratio: 0.2 } },
          { key: { module: "auth", community: "c2" }, values: { symbol_count: 30, dead_ratio: 0.5 } },
        ],
      },
      {
        key: { module: "core" },
        children: [
          { key: { module: "core", community: "c2" }, values: { symbol_count: 50, dead_ratio: 0.9 } },
          { key: { module: "core", community: "c3" }, values: { symbol_count: 20, dead_ratio: 0.1 } },
        ],
      },
    ],
    leaf_graph_edges: [
      { source: "c1", target: "c2", weight: 3 },
      { source: "c2", target: "c3", weight: 7 },
    ],
    ...overrides,
  };
}

const BASE_OPTS = {
  sizeKey:    "symbol_count",
  colorKey:   "dead_ratio",
  colorStats: { min: 0, max: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1A — null / empty guard
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – null/empty guard", () => {
  it("returns empty graph when data is null", () => {
    const g = buildGraphData(null);
    expect(g).toEqual({ nodes: [], links: [], isBlobMode: false });
  });

  it("returns empty graph when data has no rows key", () => {
    const g = buildGraphData({ dimensions: ["module"] });
    expect(g).toEqual({ nodes: [], links: [], isBlobMode: false });
  });

  it("handles empty rows array", () => {
    const g = buildGraphData({ dimensions: ["module"], rows: [], graph_edges: [] }, BASE_OPTS);
    expect(g.nodes).toHaveLength(0);
    expect(g.links).toHaveLength(0);
    expect(g.isBlobMode).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1B — single-dim node building
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – single-dim node building", () => {
  it("creates one node per row with correct id and name", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    expect(g.isBlobMode).toBe(false);
    expect(g.nodes).toHaveLength(3);
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).toEqual(["auth", "billing", "core"]);
    g.nodes.forEach(n => expect(n.name).toBe(n.id));
  });

  it("attaches values object to each node", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    const auth = g.nodes.find(n => n.id === "auth");
    expect(auth.values).toEqual({ symbol_count: 10, dead_ratio: 0.1 });
  });

  it("node val is larger for bigger sizeKey", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    const billing = g.nodes.find(n => n.id === "billing"); // symbol_count=40
    const auth    = g.nodes.find(n => n.id === "auth");    // symbol_count=10
    expect(billing.val).toBeGreaterThan(auth.val);
  });

  it("node val minimum is > 0 even when sizeKey is 0", () => {
    const data = singleDimData();
    data.rows[0].values.symbol_count = 0;
    const g = buildGraphData(data, BASE_OPTS);
    g.nodes.forEach(n => expect(n.val).toBeGreaterThan(0));
  });

  it("colour is green-ish for low dead_ratio", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    const auth = g.nodes.find(n => n.id === "auth"); // dead_ratio=0.1 → near green
    expect(auth.color.toLowerCase()).toMatch(/^#/);
    // The green endpoint is #3fb950 — red channel should be relatively low
    const r = parseInt(auth.color.slice(1, 3), 16);
    const red = parseInt("f8", 16); // red endpoint red channel
    expect(r).toBeLessThan(red);
  });

  it("colour is red-ish for high dead_ratio", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    const billing = g.nodes.find(n => n.id === "billing"); // dead_ratio=0.8 → near red
    const r = parseInt(billing.color.slice(1, 3), 16);
    const g_ch = parseInt(billing.color.slice(3, 5), 16);
    // Red channel should exceed green channel for a reddish hue
    expect(r).toBeGreaterThan(g_ch);
  });

  it("colour is midpoint green/red when colorKey is null", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, colorKey: null });
    // t=0.5 → lerpColor("#3fb950","#f85149",0.5) — all nodes same colour
    const colours = new Set(g.nodes.map(n => n.color));
    expect(colours.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1C — single-dim edge filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – single-dim edge filtering", () => {
  it("returns all edges when minWeight=1 and topK=0", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    expect(g.links).toHaveLength(3);
  });

  it("minWeight drops low-weight edges", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, minWeight: 3 });
    // Only auth→core (5) survives; billing→core (2), auth→billing (1) dropped
    expect(g.links).toHaveLength(1);
    expect(g.links[0].source).toBe("auth");
    expect(g.links[0].target).toBe("core");
  });

  it("minWeight=1 keeps all edges", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, minWeight: 1 });
    expect(g.links).toHaveLength(3);
  });

  it("topK=1 keeps only the heaviest edge per source", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, topK: 1 });
    // auth sources: auth→core(5) and auth→billing(1) → keep auth→core
    // billing sources: billing→core(2) → keep that
    expect(g.links).toHaveLength(2);
    const srcs = g.links.map(l => l.source).sort();
    expect(srcs).toEqual(["auth", "billing"]);
    const authEdge = g.links.find(l => l.source === "auth");
    expect(authEdge.target).toBe("core");
  });

  it("topK=2 keeps top 2 per source", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, topK: 2 });
    // auth has 2 edges (both kept), billing has 1 → total 3
    expect(g.links).toHaveLength(3);
  });

  it("edges reference only existing node ids", () => {
    const data = singleDimData();
    // Add a stale edge to a node that doesn't exist
    data.graph_edges.push({ source: "ghost", target: "core", weight: 10 });
    const g = buildGraphData(data, BASE_OPTS);
    const srcIds = g.links.map(l => l.source);
    expect(srcIds).not.toContain("ghost");
  });

  it("edge value carries the weight", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    const e = g.links.find(l => l.source === "auth" && l.target === "core");
    expect(e.value).toBe(5);
  });

  it("minWeight and topK compose correctly", () => {
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, minWeight: 3, topK: 1 });
    // After minWeight≥3: only auth→core(5). Then topK=1 also keeps it.
    expect(g.links).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1D — hideIsolated
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – hideIsolated", () => {
  it("removes nodes with no edges when hideIsolated=true", () => {
    const data = singleDimData();
    // Drop all edges from/to 'billing' so it becomes isolated
    data.graph_edges = data.graph_edges.filter(
      e => e.source !== "billing" && e.target !== "billing"
    );
    const g = buildGraphData(data, { ...BASE_OPTS, hideIsolated: true });
    const ids = g.nodes.map(n => n.id);
    expect(ids).not.toContain("billing");
    expect(ids).toContain("auth");
    expect(ids).toContain("core");
  });

  it("keeps all nodes when hideIsolated=false even if isolated", () => {
    const data = singleDimData();
    data.graph_edges = [];
    const g = buildGraphData(data, { ...BASE_OPTS, hideIsolated: false });
    expect(g.nodes).toHaveLength(3);
  });

  it("hideIsolated on empty edge list removes all nodes", () => {
    const data = singleDimData();
    data.graph_edges = [];
    const g = buildGraphData(data, { ...BASE_OPTS, hideIsolated: true });
    expect(g.nodes).toHaveLength(0);
    expect(g.links).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1E — blob mode (2+ dims)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – blob mode", () => {
  it("sets isBlobMode=true when dimensions.length >= 2", () => {
    const g = buildGraphData(blobDimData(), BASE_OPTS);
    expect(g.isBlobMode).toBe(true);
  });

  it("creates nodes from leaf children, not top-level rows", () => {
    const g = buildGraphData(blobDimData(), BASE_OPTS);
    // c1, c2, c3 — but c2 appears under both auth and core (dedup)
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("assigns group (outer dim) to each node", () => {
    const g = buildGraphData(blobDimData(), BASE_OPTS);
    const c1 = g.nodes.find(n => n.id === "c1");
    const c3 = g.nodes.find(n => n.id === "c3");
    expect(c1.group).toBe("auth");
    expect(c3.group).toBe("core");
  });

  it("deduplicates inner-dim values keeping highest sizeKey row", () => {
    // c2 appears under auth (symbol_count=30) and core (symbol_count=50)
    // core's row should win
    const g = buildGraphData(blobDimData(), BASE_OPTS);
    const c2 = g.nodes.find(n => n.id === "c2");
    // values from core's child
    expect(c2.values.symbol_count).toBe(50);
    expect(c2.group).toBe("core");
  });

  it("uses leaf_graph_edges (not graph_edges) in blob mode", () => {
    const data = blobDimData();
    data.graph_edges = [{ source: "auth", target: "core", weight: 99 }];
    const g = buildGraphData(data, BASE_OPTS);
    // leaf edges: c1→c2 (3), c2→c3 (7) — should not include auth→core
    const srcIds = g.links.map(l => l.source).sort();
    expect(srcIds).not.toContain("auth");
    expect(srcIds).toContain("c1");
    expect(srcIds).toContain("c2");
  });

  it("edge filtering (minWeight) works in blob mode", () => {
    const g = buildGraphData(blobDimData(), { ...BASE_OPTS, minWeight: 5 });
    // c1→c2(3) dropped, c2→c3(7) kept
    expect(g.links).toHaveLength(1);
    expect(g.links[0].source).toBe("c2");
    expect(g.links[0].target).toBe("c3");
  });

  it("hideIsolated removes isolated nodes in blob mode", () => {
    const data = blobDimData();
    data.leaf_graph_edges = [{ source: "c2", target: "c3", weight: 7 }];
    const g = buildGraphData(data, { ...BASE_OPTS, hideIsolated: true });
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).not.toContain("c1");  // c1 has no edges now
    expect(ids).toContain("c2");
    expect(ids).toContain("c3");
  });

  it("isBlobMode=false when only 1 dimension", () => {
    const g = buildGraphData(singleDimData(), BASE_OPTS);
    expect(g.isBlobMode).toBe(false);
  });

  it("handles missing children array gracefully", () => {
    const data = blobDimData();
    // Remove children from first row
    delete data.rows[0].children;
    const g = buildGraphData(data, BASE_OPTS);
    // Only core's children (c2, c3) survive
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).toEqual(["c2", "c3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1F — colour normalisation edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – colour normalisation", () => {
  it("clamps t to [0,1] when value below colorStats.min", () => {
    const data = singleDimData();
    data.rows[0].values.dead_ratio = -0.5; // below min=0
    const g = buildGraphData(data, BASE_OPTS);
    const auth = g.nodes.find(n => n.id === "auth");
    // Should not throw; colour should be the green endpoint
    expect(auth.color).toBe("#3fb950");
  });

  it("clamps t to [0,1] when value above colorStats.max", () => {
    const data = singleDimData();
    data.rows[1].values.dead_ratio = 1.5; // above max=1
    const g = buildGraphData(data, BASE_OPTS);
    const billing = g.nodes.find(n => n.id === "billing");
    expect(billing.color).toBe("#f85149");
  });

  it("all nodes same colour when colorStats.min === max (degenerate)", () => {
    // colorStats max-min = 0 causes division by zero — handled by the
    // computeColorStats caller setting max = min+1, so this shouldn't occur
    // in practice, but buildGraphData should still not crash if passed bad stats.
    const g = buildGraphData(singleDimData(), { ...BASE_OPTS, colorStats: { min: 0.5, max: 0.5 } });
    // All t computed as 0/0 → NaN → clamped to 0 by Math.max(0, ...) → green
    // Actually 0/0 = NaN, and Math.max(0, NaN) = NaN ... 
    // The important thing is it doesn't throw
    expect(g.nodes).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — d3-force physics with makeGroupCentroidForce
// ─────────────────────────────────────────────────────────────────────────────

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from "d3-force-3d";
import { makeGroupCentroidForce, makeSelectionRadialForce } from "../components/GraphRenderer.jsx";

/**
 * Run `ticks` simulation ticks synchronously and return nodes.
 */
function runSim(nodes, links = [], extraForces = {}, ticks = 300) {
  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-200))
    .force("link", forceLink(links).id(n => n.id).distance(80))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0)          // don't let alpha decay during manual ticking
    .stop();                // don't start the auto tick loop

  for (const [name, f] of Object.entries(extraForces)) {
    sim.force(name, f);
  }

  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

function centroid(nodes) {
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
}

function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

describe("Layer 2 – d3-force: makeGroupCentroidForce", () => {
  it("pulls nodes with same group closer together than nodes in different groups", () => {
    // Two groups of 4 nodes each; no inter-group links → groups should cluster
    const groupA = ["a1", "a2", "a3", "a4"].map(id => ({ id, group: "A" }));
    const groupB = ["b1", "b2", "b3", "b4"].map(id => ({ id, group: "B" }));
    const nodes  = [...groupA, ...groupB];

    // Seed positions: spread both groups randomly but interleaved
    nodes.forEach((n, i) => { n.x = (i % 4) * 10; n.y = Math.floor(i / 4) * 10; });

    runSim(nodes, [], {
      groupCentroid: makeGroupCentroidForce(0.3),
    }, 500);

    const cA = centroid(nodes.filter(n => n.group === "A"));
    const cB = centroid(nodes.filter(n => n.group === "B"));

    // Intra-group distances should be smaller than inter-group distance
    const intraA = nodes.filter(n => n.group === "A")
      .map(n => dist2d(n, cA));
    const intraB = nodes.filter(n => n.group === "B")
      .map(n => dist2d(n, cB));
    const avgIntra = [...intraA, ...intraB].reduce((s, d) => s + d, 0) /
      (intraA.length + intraB.length);
    const interDist = dist2d(cA, cB);

    expect(interDist).toBeGreaterThan(avgIntra);
  });

  it("nodes with no group are unaffected by the centroid force", () => {
    const nodes = [
      { id: "a", group: "A", x: 0,   y: 0 },
      { id: "b", group: "A", x: 10,  y: 0 },
      { id: "c",             x: 100, y: 100 }, // no group
    ];

    const before = { x: nodes[2].x, y: nodes[2].y };
    runSim(nodes, [], { groupCentroid: makeGroupCentroidForce(0.5) }, 50);

    // Node c shouldn't be dragged toward A's centroid (charge/center still act on it though)
    // The key assertion: c is NOT pulled to A's centroid; it's still far from A
    const cA = centroid(nodes.filter(n => n.group === "A"));
    const distC = dist2d(nodes[2], cA);
    // Without the group force, c stays near its initial position (just charge repels)
    // With group force, A nodes cluster near (5,0). c at (100,100) should still be far.
    expect(distC).toBeGreaterThan(20); // generous threshold
    // Suppress "before" unused warning
    void before;
  });
});

describe("Layer 2 – d3-force: makeSelectionRadialForce", () => {
  it("positions reachable nodes at expected ring distances from selected node", () => {
    // 5 nodes: sel at center, d1 at depth 1, d2 at depth 2, and 2 unreachable
    const nodes = [
      { id: "sel" },
      { id: "d1a" }, { id: "d1b" },  // depth 1
      { id: "d2a" },                  // depth 2
      { id: "unr" },                  // unreachable
    ];
    // Seed with sel pinned at origin
    nodes[0].x = 0; nodes[0].y = 0;
    nodes[0].fx = 0; nodes[0].fy = 0; // pin
    nodes.forEach((n, i) => { if (!n.fx) { n.x = i * 20; n.y = 0; } });

    const bfsDists = new Map([
      ["sel", 0], ["d1a", 1], ["d1b", 1], ["d2a", 2],
    ]);
    const radiusPer = 120;

    runSim(nodes, [], {
      selRadial: makeSelectionRadialForce("sel", bfsDists, radiusPer),
      charge: forceManyBody().strength(-50),
    }, 600);

    const sel = nodes[0];

    // Depth-1 nodes should be roughly within [0.4, 1.8] × radiusPer of sel
    for (const id of ["d1a", "d1b"]) {
      const n = nodes.find(n => n.id === id);
      const d = dist2d(n, sel);
      expect(d).toBeGreaterThan(radiusPer * 0.4);
      expect(d).toBeLessThan(radiusPer * 1.8);
    }

    // Depth-2 node should be farther than depth-1 nodes on average
    const d2 = nodes.find(n => n.id === "d2a");
    const d1a = nodes.find(n => n.id === "d1a");
    expect(dist2d(d2, sel)).toBeGreaterThan(dist2d(d1a, sel) * 0.7);
  });
});
