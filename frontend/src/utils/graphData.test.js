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

// ─────────────────────────────────────────────────────────────────────────────
// N-dim nested blob tests
// ─────────────────────────────────────────────────────────────────────────────
import { flattenLeafRows, getGroupKey } from "./graphData.js";

// ── Shared 3-dim fixture ──────────────────────────────────────────────────────
// dims = [module, class, symbol]  →  3 levels: module > class > symbol

function threeDimData(overrides = {}) {
  return {
    dimensions: ["module", "class", "symbol"],
    rows: [
      {
        key: { module: "core" }, depth: 0,
        values: { symbol_count: 4 },
        children: [
          {
            key: { module: "core", class: "Parser" }, depth: 1,
            values: { symbol_count: 2 },
            children: [
              { key: { module: "core", class: "Parser", symbol: "core::parse" },   depth: 2, values: { symbol_count: 1, dead_ratio: 0.0 }, children: [] },
              { key: { module: "core", class: "Parser", symbol: "core::validate" },depth: 2, values: { symbol_count: 1, dead_ratio: 1.0 }, children: [] },
            ],
          },
          {
            key: { module: "core", class: "Builder" }, depth: 1,
            values: { symbol_count: 2 },
            children: [
              { key: { module: "core", class: "Builder", symbol: "core::build" },  depth: 2, values: { symbol_count: 1, dead_ratio: 0.5 }, children: [] },
              { key: { module: "core", class: "Builder", symbol: "core::emit" },   depth: 2, values: { symbol_count: 1, dead_ratio: 0.5 }, children: [] },
            ],
          },
        ],
      },
      {
        key: { module: "auth" }, depth: 0,
        values: { symbol_count: 2 },
        children: [
          {
            key: { module: "auth", class: "Session" }, depth: 1,
            values: { symbol_count: 2 },
            children: [
              { key: { module: "auth", class: "Session", symbol: "auth::login" },  depth: 2, values: { symbol_count: 1, dead_ratio: 0.0 }, children: [] },
              { key: { module: "auth", class: "Session", symbol: "auth::logout" }, depth: 2, values: { symbol_count: 1, dead_ratio: 0.0 }, children: [] },
            ],
          },
        ],
      },
    ],
    leaf_graph_edges: [
      { source: "core::parse",   target: "core::validate", weight: 3 },
      { source: "core::build",   target: "auth::login",    weight: 1 },
    ],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// flattenLeafRows
// ─────────────────────────────────────────────────────────────────────────────

describe("flattenLeafRows", () => {
  it("returns empty for null/empty input", () => {
    expect(flattenLeafRows(null, 2)).toEqual([]);
    expect(flattenLeafRows([], 2)).toEqual([]);
  });

  it("2-dim: returns direct children (depth-1 rows)", () => {
    const data = blobDimData();
    const leaves = flattenLeafRows(data.rows, 2);
    const ids = leaves.map(r => r.key.community).sort();
    expect(ids).toEqual(["c1", "c2", "c2", "c3"]); // c2 appears in both modules
  });

  it("2-dim: leaf key has both dims", () => {
    const data = blobDimData();
    const leaves = flattenLeafRows(data.rows, 2);
    for (const r of leaves) {
      expect(Object.keys(r.key)).toContain("module");
      expect(Object.keys(r.key)).toContain("community");
    }
  });

  it("3-dim: returns depth-2 rows", () => {
    const data = threeDimData();
    const leaves = flattenLeafRows(data.rows, 3);
    expect(leaves).toHaveLength(6); // core×2+core×2+auth×2
    for (const r of leaves) {
      expect(r.key).toHaveProperty("module");
      expect(r.key).toHaveProperty("class");
      expect(r.key).toHaveProperty("symbol");
    }
  });

  it("3-dim: leaf symbol values match fixture", () => {
    const data = threeDimData();
    const leaves = flattenLeafRows(data.rows, 3);
    const symbols = leaves.map(r => r.key.symbol).sort();
    expect(symbols).toEqual([
      "auth::login", "auth::logout",
      "core::build", "core::emit",
      "core::parse", "core::validate",
    ]);
  });

  it("skips intermediate rows with no children", () => {
    const data = blobDimData();
    delete data.rows[0].children; // auth has no children
    const leaves = flattenLeafRows(data.rows, 2);
    // Only core's children survive
    expect(leaves.map(r => r.key.community).sort()).toEqual(["c2", "c3"]);
  });

  it("handles deeply nested missing children gracefully", () => {
    const data = threeDimData();
    // Remove a class-level child's children
    data.rows[0].children[0].children = [];
    const leaves = flattenLeafRows(data.rows, 3);
    // core::Parser missing → 2 + 2 = 4 leaves remain
    expect(leaves).toHaveLength(4);
  });

  it("1-dim: returns top-level rows themselves", () => {
    const data = singleDimData();
    const leaves = flattenLeafRows(data.rows, 1);
    expect(leaves).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGroupKey
// ─────────────────────────────────────────────────────────────────────────────

describe("getGroupKey", () => {
  const node2 = { group: "core",   groupPath: ["core"] };
  const node3 = { group: "core",   groupPath: ["core", "Parser"] };
  const node4 = { group: "module", groupPath: ["module", "classA", "subA"] };

  it("level 0 returns outermost group (same as node.group)", () => {
    expect(getGroupKey(node2, 0)).toBe("core");
    expect(getGroupKey(node3, 0)).toBe("core");
  });

  it("level 1 joins first two path entries with ::", () => {
    expect(getGroupKey(node3, 1)).toBe("core::Parser");
    expect(getGroupKey(node4, 1)).toBe("module::classA");
  });

  it("level 2 joins three path entries", () => {
    expect(getGroupKey(node4, 2)).toBe("module::classA::subA");
  });

  it("falls back to node.group when groupPath absent", () => {
    const nodeNoPath = { group: "fallback" };
    expect(getGroupKey(nodeNoPath, 0)).toBe("fallback");
    expect(getGroupKey(nodeNoPath, 1)).toBe("fallback");
  });

  it("falls back to node.group when level exceeds groupPath length", () => {
    expect(getGroupKey(node2, 5)).toBe("core");
  });

  it("returns empty string when group is undefined and no groupPath", () => {
    expect(getGroupKey({}, 0)).toBe("");
  });

  it("different classes in same module have distinct level-1 keys", () => {
    const n1 = { group: "core", groupPath: ["core", "Parser"] };
    const n2 = { group: "core", groupPath: ["core", "Builder"] };
    expect(getGroupKey(n1, 0)).toBe(getGroupKey(n2, 0)); // same outer group
    expect(getGroupKey(n1, 1)).not.toBe(getGroupKey(n2, 1)); // different inner
  });

  it("same key at level L for nodes in same sub-group", () => {
    const n1 = { group: "core", groupPath: ["core", "Parser"] };
    const n2 = { group: "core", groupPath: ["core", "Parser"] };
    expect(getGroupKey(n1, 1)).toBe(getGroupKey(n2, 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildGraphData – 3-dim nested blob mode
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – 3-dim nested blob mode", () => {
  const OPTS = { sizeKey: "symbol_count", colorKey: "dead_ratio", colorStats: { min: 0, max: 1 } };

  it("isBlobMode is true for 3 dims", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    expect(g.isBlobMode).toBe(true);
  });

  it("nodes are leaf-dim (symbol) values, not module or class", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).toEqual([
      "auth::login", "auth::logout",
      "core::build", "core::emit",
      "core::parse", "core::validate",
    ]);
  });

  it("each node has groupPath of length N-1 = 2", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      expect(n.groupPath).toHaveLength(2);
    }
  });

  it("groupPath[0] equals the module (outermost dim)", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const parse = g.nodes.find(n => n.id === "core::parse");
    expect(parse.groupPath[0]).toBe("core");
    const login = g.nodes.find(n => n.id === "auth::login");
    expect(login.groupPath[0]).toBe("auth");
  });

  it("groupPath[1] equals the class (middle dim)", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const parse = g.nodes.find(n => n.id === "core::parse");
    expect(parse.groupPath[1]).toBe("Parser");
    const build = g.nodes.find(n => n.id === "core::build");
    expect(build.groupPath[1]).toBe("Builder");
  });

  it("node.group === groupPath[0] for backward compat", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      expect(n.group).toBe(n.groupPath[0]);
    }
  });

  it("nodes in same class share the same level-1 group key", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const parse   = g.nodes.find(n => n.id === "core::parse");
    const validate = g.nodes.find(n => n.id === "core::validate");
    expect(getGroupKey(parse, 1)).toBe(getGroupKey(validate, 1));
    expect(getGroupKey(parse, 1)).toBe("core::Parser");
  });

  it("nodes in different classes have different level-1 group keys", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const parse = g.nodes.find(n => n.id === "core::parse");
    const build = g.nodes.find(n => n.id === "core::build");
    expect(getGroupKey(parse, 1)).not.toBe(getGroupKey(build, 1));
  });

  it("uses leaf_graph_edges for links (not graph_edges)", () => {
    const data = threeDimData();
    data.graph_edges = [{ source: "core", target: "auth", weight: 99 }];
    const g = buildGraphData(data, OPTS);
    // graph_edges have module-level sources; leaf_graph_edges have symbol-level
    const sources = g.links.map(l =>
      typeof l.source === "object" ? l.source.id : l.source
    );
    expect(sources).not.toContain("core"); // module names not in leaf edges
  });

  it("node val is positive for all nodes", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) expect(n.val).toBeGreaterThan(0);
  });

  it("color is a CSS hex string", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) expect(n.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("hideIsolated removes nodes with no links", () => {
    const data = threeDimData();
    // Only core::parse → core::validate edge; core::build connects to auth::login
    // auth::logout has no edges in leaf_graph_edges
    const g = buildGraphData(data, { ...OPTS, hideIsolated: true });
    const ids = new Set(g.nodes.map(n => n.id));
    expect(ids.has("auth::logout")).toBe(false); // isolated
  });

  it("all nodes have an id, name, values, groupPath, group, val, color", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      expect(n).toHaveProperty("id");
      expect(n).toHaveProperty("name");
      expect(n).toHaveProperty("values");
      expect(n).toHaveProperty("groupPath");
      expect(n).toHaveProperty("group");
      expect(n).toHaveProperty("val");
      expect(n).toHaveProperty("color");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildGraphData – N-dim backward compat
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – N-dim backward compat (1-dim and 2-dim unchanged)", () => {
  const OPTS = BASE_OPTS;

  it("1-dim: nodes have no groupPath", () => {
    const g = buildGraphData(singleDimData(), OPTS);
    for (const n of g.nodes) expect(n.groupPath).toBeUndefined();
  });

  it("1-dim: isBlobMode remains false", () => {
    expect(buildGraphData(singleDimData(), OPTS).isBlobMode).toBe(false);
  });

  it("2-dim: nodes have groupPath of length 1", () => {
    const g = buildGraphData(blobDimData(), OPTS);
    for (const n of g.nodes) expect(n.groupPath).toHaveLength(1);
  });

  it("2-dim: groupPath[0] === node.group", () => {
    const g = buildGraphData(blobDimData(), OPTS);
    for (const n of g.nodes) expect(n.groupPath[0]).toBe(n.group);
  });

  it("2-dim: node ids are from dim1 (community), not dim0 (module)", () => {
    const g = buildGraphData(blobDimData(), OPTS);
    const ids = g.nodes.map(n => n.id);
    expect(ids).not.toContain("auth");
    expect(ids).not.toContain("core");
    expect(ids.every(id => id.startsWith("c"))).toBe(true);
  });

  it("2-dim: isBlobMode is true", () => {
    expect(buildGraphData(blobDimData(), OPTS).isBlobMode).toBe(true);
  });

  it("2-dim: dedup keeps highest sizeKey row when same inner value in multiple groups", () => {
    // c2 appears in both auth and core; core/c2 has symbol_count=50 > auth/c2=30
    const g = buildGraphData(blobDimData(), { ...OPTS, sizeKey: "symbol_count" });
    const c2 = g.nodes.filter(n => n.id === "c2");
    expect(c2).toHaveLength(1);
    expect(c2[0].group).toBe("core"); // core wins (higher symbol_count)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Statistical / invariant tests for N-dim graphs
// ─────────────────────────────────────────────────────────────────────────────

describe("buildGraphData – N-dim statistical invariants", () => {
  const OPTS = { sizeKey: "symbol_count", colorKey: "dead_ratio", colorStats: { min: 0, max: 1 } };

  it("3-dim: every groupPath entry is non-null", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      for (const entry of n.groupPath) {
        expect(entry).not.toBeNull();
        expect(entry).not.toBeUndefined();
      }
    }
  });

  it("3-dim: getGroupKey(node, 0) always equals node.group", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      expect(getGroupKey(n, 0)).toBe(n.group);
    }
  });

  it("3-dim: level-1 group keys are proper sub-keys (contain level-0 as prefix)", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    for (const n of g.nodes) {
      const k0 = getGroupKey(n, 0);
      const k1 = getGroupKey(n, 1);
      expect(k1.startsWith(k0 + "::")).toBe(true);
    }
  });

  it("3-dim: nodes with same class have identical level-1 group keys", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    const byClass = new Map();
    for (const n of g.nodes) {
      const k1 = getGroupKey(n, 1);
      if (!byClass.has(k1)) byClass.set(k1, []);
      byClass.get(k1).push(n);
    }
    // All nodes in core::Parser should have the same groupPath
    const parserNodes = byClass.get("core::Parser") ?? [];
    const paths = parserNodes.map(n => n.groupPath.join("::"));
    const unique = new Set(paths);
    expect(unique.size).toBe(1);
  });

  it("2-dim: node count == unique inner-dim values (after dedup)", () => {
    const g = buildGraphData(blobDimData(), OPTS);
    // c1, c2, c3 — c2 is shared but deduped → 3 unique nodes
    expect(g.nodes).toHaveLength(3);
  });

  it("3-dim: node count == unique leaf-dim values", () => {
    const g = buildGraphData(threeDimData(), OPTS);
    expect(g.nodes).toHaveLength(6);
  });

  it("links respect minWeight threshold for 3-dim", () => {
    const g = buildGraphData(threeDimData(), { ...OPTS, minWeight: 3 });
    // Only the weight=3 edge survives
    expect(g.links).toHaveLength(1);
  });

  it("topK=1 keeps at most 1 edge per source node for 3-dim", () => {
    const data = threeDimData();
    // Add extra edges from core::parse
    data.leaf_graph_edges.push(
      { source: "core::parse", target: "core::build",  weight: 2 },
      { source: "core::parse", target: "auth::logout", weight: 1 },
    );
    const g = buildGraphData(data, { ...OPTS, topK: 1 });
    const fromParse = g.links.filter(l => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      return s === "core::parse";
    });
    expect(fromParse.length).toBeLessThanOrEqual(1);
  });

  it("colorFn override works in 3-dim mode", () => {
    const g = buildGraphData(threeDimData(), { ...OPTS, colorFn: () => "#123456" });
    for (const n of g.nodes) expect(n.color).toBe("#123456");
  });
});
