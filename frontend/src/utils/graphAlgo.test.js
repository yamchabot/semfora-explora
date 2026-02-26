import { describe, it, expect } from "vitest";
import {
  buildAdjacencyMaps,
  bfsFromNode,
  findChainEdges,
  collectChainNodeIds,
  convexHull,
  pointInPolygon,
  expandHullPts,
} from "./graphAlgo.js";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build simple string links. */
function links(...pairs) {
  return pairs.map(([source, target]) => ({ source, target }));
}

/** Build d3-mutated-style links (source/target are objects with .id). */
function d3Links(...pairs) {
  return pairs.map(([s, t]) => ({ source: { id: s }, target: { id: t } }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildAdjacencyMaps
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildAdjacencyMaps", () => {
  it("builds forward and backward maps from string links", () => {
    const { fwdAdj, bwdAdj } = buildAdjacencyMaps(links(["a", "b"], ["a", "c"]));
    expect(fwdAdj.get("a")).toEqual(expect.arrayContaining(["b", "c"]));
    expect(fwdAdj.get("b")).toBeUndefined();
    expect(bwdAdj.get("b")).toEqual(["a"]);
    expect(bwdAdj.get("c")).toEqual(["a"]);
  });

  it("builds adjacency from d3-mutated object links", () => {
    const { fwdAdj, bwdAdj } = buildAdjacencyMaps(d3Links(["x", "y"]));
    expect(fwdAdj.get("x")).toEqual(["y"]);
    expect(bwdAdj.get("y")).toEqual(["x"]);
  });

  it("handles mixed string and object links", () => {
    const mixed = [
      { source: "a", target: "b" },
      { source: { id: "b" }, target: { id: "c" } },
    ];
    const { fwdAdj } = buildAdjacencyMaps(mixed);
    expect(fwdAdj.get("a")).toEqual(["b"]);
    expect(fwdAdj.get("b")).toEqual(["c"]);
  });

  it("returns empty maps for empty link array", () => {
    const { fwdAdj, bwdAdj } = buildAdjacencyMaps([]);
    expect(fwdAdj.size).toBe(0);
    expect(bwdAdj.size).toBe(0);
  });

  it("supports multiple edges from the same source", () => {
    const { fwdAdj } = buildAdjacencyMaps(links(["a", "b"], ["a", "c"], ["a", "d"]));
    expect(fwdAdj.get("a")).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// bfsFromNode
// ═══════════════════════════════════════════════════════════════════════════════

describe("bfsFromNode", () => {
  // a → b → c → d
  const linearAdj = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["d"]],
  ]);

  it("includes start node at distance 0", () => {
    const dist = bfsFromNode("a", linearAdj, 5);
    expect(dist.get("a")).toBe(0);
  });

  it("assigns correct hop counts along a linear chain", () => {
    const dist = bfsFromNode("a", linearAdj, 5);
    expect(dist.get("b")).toBe(1);
    expect(dist.get("c")).toBe(2);
    expect(dist.get("d")).toBe(3);
  });

  it("stops at maxD — node exactly at maxD is included, beyond is not", () => {
    const dist = bfsFromNode("a", linearAdj, 2);
    expect(dist.has("b")).toBe(true);
    expect(dist.has("c")).toBe(true);  // exactly at maxD=2
    expect(dist.has("d")).toBe(false); // would be 3 hops
  });

  it("returns only start node when maxD is 0", () => {
    const dist = bfsFromNode("a", linearAdj, 0);
    expect(dist.size).toBe(1);
    expect(dist.get("a")).toBe(0);
  });

  it("handles disconnected nodes (not in adj)", () => {
    const dist = bfsFromNode("z", linearAdj, 5);
    expect(dist.size).toBe(1);
    expect(dist.get("z")).toBe(0);
    expect(dist.has("a")).toBe(false);
  });

  it("does not infinite-loop on cycles", () => {
    const cycleAdj = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]], // cycle back
    ]);
    const dist = bfsFromNode("a", cycleAdj, 10);
    // Should visit each node exactly once
    expect(dist.size).toBe(3);
    expect(dist.get("a")).toBe(0);
    expect(dist.get("b")).toBe(1);
    expect(dist.get("c")).toBe(2);
  });

  it("fans out correctly in a branching graph", () => {
    const fanAdj = new Map([
      ["root", ["x", "y", "z"]],
      ["x",    ["leaf1"]],
      ["y",    ["leaf2"]],
    ]);
    const dist = bfsFromNode("root", fanAdj, 5);
    expect(dist.get("root")).toBe(0);
    expect(dist.get("x")).toBe(1);
    expect(dist.get("y")).toBe(1);
    expect(dist.get("z")).toBe(1);
    expect(dist.get("leaf1")).toBe(2);
    expect(dist.get("leaf2")).toBe(2);
    expect(dist.has("leaf3")).toBe(false);
  });

  it("works for backward BFS (reverse adjacency)", () => {
    // bwdAdj: c ← b ← a  (so BFS from c going backward)
    const bwdAdj = new Map([
      ["b", ["a"]],
      ["c", ["b"]],
    ]);
    const dist = bfsFromNode("c", bwdAdj, 5);
    expect(dist.get("c")).toBe(0);
    expect(dist.get("b")).toBe(1);
    expect(dist.get("a")).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findChainEdges
// ═══════════════════════════════════════════════════════════════════════════════

describe("findChainEdges", () => {
  // Helper: build adj maps and call findChainEdges in one shot
  function chainEdges(linkPairs, selectedIds, maxHops = 10) {
    const ls = links(...linkPairs);
    const { fwdAdj, bwdAdj } = buildAdjacencyMaps(ls);
    return findChainEdges(selectedIds, fwdAdj, bwdAdj, ls, maxHops);
  }

  it("returns empty map when fewer than 2 nodes selected", () => {
    const m = chainEdges([["a", "b"]], ["a"]);
    expect(m.size).toBe(0);
  });

  it("returns empty map for empty selection", () => {
    const m = chainEdges([["a", "b"]], []);
    expect(m.size).toBe(0);
  });

  it("finds a direct edge between two selected nodes", () => {
    // a → b,  select [a, b]
    // fwd[0]=BFS from a: {a:0, b:1}; bwd[1]=BFS from b backward: {b:0, a:1}
    // For edge a→b: du=0, dvu=1>0 ✓, dv=0, duT=1>0 ✓ → len = du+1+dv = 0+1+0 = 1
    const m = chainEdges([["a", "b"]], ["a", "b"]);
    expect(m.has("a|b")).toBe(true);
    expect(m.get("a|b")).toBe(1);
  });

  it("finds path through an intermediate node", () => {
    // a → mid → b
    const m = chainEdges([["a", "mid"], ["mid", "b"]], ["a", "b"]);
    expect(m.has("a|mid")).toBe(true);
    expect(m.has("mid|b")).toBe(true);
  });

  it("chain length reflects actual hop count", () => {
    // a → m1 → m2 → b (chain length 3)
    const m = chainEdges(
      [["a", "m1"], ["m1", "m2"], ["m2", "b"]],
      ["a", "b"]
    );
    expect(m.has("a|m1")).toBe(true);
    expect(m.has("m1|m2")).toBe(true);
    expect(m.has("m2|b")).toBe(true);
    // a|m1: du=0, +1, dv(m1→b)=2  → len=3
    expect(m.get("a|m1")).toBe(3);
  });

  it("returns empty map when no path exists between selected nodes", () => {
    // a → b, c → d (two disconnected components; select a and d)
    const m = chainEdges([["a", "b"], ["c", "d"]], ["a", "d"]);
    expect(m.size).toBe(0);
  });

  it("does not include side-branch edges that can't reach target", () => {
    // a → b → c (target), a → sidecar (dead end)
    const m = chainEdges(
      [["a", "b"], ["b", "c"], ["a", "sidecar"]],
      ["a", "c"]
    );
    expect(m.has("a|b")).toBe(true);
    expect(m.has("b|c")).toBe(true);
    expect(m.has("a|sidecar")).toBe(false); // sidecar can't reach c
  });

  it("excludes edges that exceed maxHops", () => {
    // a → b → c → d,  maxHops=2  (path a→b→c is len=2, a→b→c→d is len=3)
    const m = chainEdges(
      [["a", "b"], ["b", "c"], ["c", "d"]],
      ["a", "d"],
      2
    );
    // With maxHops=2, the path a→b→c→d (len=3) exceeds it → no edges
    expect(m.size).toBe(0);
  });

  it("picks shorter chain length when two paths exist", () => {
    // Direct: a → b (len=1)
    // Long:   a → x → b (len=2)
    const m = chainEdges(
      [["a", "b"], ["a", "x"], ["x", "b"]],
      ["a", "b"]
    );
    expect(m.has("a|b")).toBe(true);
    expect(m.get("a|b")).toBe(1); // shorter path wins
  });

  it("handles multiple selected nodes — finds all pairwise chains", () => {
    // a → b → c (linear), select [a, b, c]
    const m = chainEdges(
      [["a", "b"], ["b", "c"]],
      ["a", "b", "c"]
    );
    // a→b chain: a|b ✓
    // b→c chain: b|c ✓
    // a→c chain (through b): a|b ✓ (already), b|c ✓ (already)
    expect(m.has("a|b")).toBe(true);
    expect(m.has("b|c")).toBe(true);
  });

  it("handles d3-mutated object links", () => {
    const ls = d3Links(["a", "b"]);
    const { fwdAdj, bwdAdj } = buildAdjacencyMaps(ls);
    const m = findChainEdges(["a", "b"], fwdAdj, bwdAdj, ls, 10);
    expect(m.has("a|b")).toBe(true);
  });

  it("does not fabricate a reverse edge that doesn't exist in the graph", () => {
    // a → b only (no b → a edge). Select [a, b].
    // The algorithm should find "a|b" but must NOT invent "b|a".
    const m = chainEdges([["a", "b"]], ["a", "b"]);
    expect(m.has("a|b")).toBe(true);   // real edge, on the chain
    expect(m.has("b|a")).toBe(false);  // reverse does not exist in graph → must not appear
  });

  it("excludes cycle side-loops (monotone guard filters them)", () => {
    // a → b → c → b (cycle on b-c), select [a, c]
    // The edge c→b goes backward toward S, so the backward guard should reject it
    const m = chainEdges(
      [["a", "b"], ["b", "c"], ["c", "b"]],
      ["a", "c"]
    );
    expect(m.has("a|b")).toBe(true);
    expect(m.has("b|c")).toBe(true);
    expect(m.has("c|b")).toBe(false); // rejected by monotone backward guard
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// collectChainNodeIds
// ═══════════════════════════════════════════════════════════════════════════════

describe("collectChainNodeIds", () => {
  it("returns selected nodes even when map is empty", () => {
    const ids = collectChainNodeIds(new Map(), ["a", "b"]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("includes both endpoints of every chain edge", () => {
    const edgeMap = new Map([["x|y", 1], ["y|z", 2]]);
    const ids = collectChainNodeIds(edgeMap, ["x", "z"]);
    expect(ids.has("x")).toBe(true);
    expect(ids.has("y")).toBe(true);
    expect(ids.has("z")).toBe(true);
  });

  it("deduplicates nodes that appear in multiple edges", () => {
    const edgeMap = new Map([["a|b", 1], ["a|c", 1]]);
    const ids = collectChainNodeIds(edgeMap, ["a"]);
    expect(ids.size).toBe(3); // a, b, c
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convexHull
// ═══════════════════════════════════════════════════════════════════════════════

describe("convexHull", () => {
  it("returns single point for 1-element input", () => {
    const h = convexHull([[1, 2]]);
    expect(h).toHaveLength(1);
    expect(h[0]).toEqual([1, 2]);
  });

  it("returns both points for 2-element input", () => {
    const h = convexHull([[0, 0], [1, 1]]);
    expect(h).toHaveLength(2);
  });

  it("returns copies (not references) of the input points", () => {
    const pt = [0, 0];
    const h  = convexHull([pt, [1, 0]]);
    h[0][0]  = 99;
    expect(pt[0]).toBe(0); // original unchanged
  });

  it("computes hull for a unit square — 4 corners, no interior points", () => {
    const pts = [[0,0],[1,0],[1,1],[0,1]];
    const h   = convexHull(pts);
    expect(h).toHaveLength(4);
    // All corners should be on the hull
    const set = new Set(h.map(p => `${p[0]},${p[1]}`));
    expect(set.has("0,0")).toBe(true);
    expect(set.has("1,0")).toBe(true);
    expect(set.has("1,1")).toBe(true);
    expect(set.has("0,1")).toBe(true);
  });

  it("excludes interior points from the hull", () => {
    // Square with a centre point that should NOT appear on the hull
    const pts = [[0,0],[2,0],[2,2],[0,2],[1,1]]; // centre = interior
    const h   = convexHull(pts);
    expect(h).toHaveLength(4);
    const set = new Set(h.map(p => `${p[0]},${p[1]}`));
    expect(set.has("1,1")).toBe(false);
  });

  it("handles collinear points — interior collinear points are excluded", () => {
    // Three collinear points: only the two extremes should survive
    const pts = [[0,0],[1,0],[2,0]];
    const h   = convexHull(pts);
    // Monotone chain excludes interior collinear points (cross == 0 → pop)
    expect(h.length).toBeLessThanOrEqual(2);
    const set = new Set(h.map(p => `${p[0]},${p[1]}`));
    expect(set.has("0,0")).toBe(true);
    expect(set.has("2,0")).toBe(true);
  });

  it("handles a triangle — all 3 points on hull", () => {
    const pts = [[0,0],[3,0],[1,2]];
    const h   = convexHull(pts);
    expect(h).toHaveLength(3);
  });

  it("is stable with duplicate points (no crash)", () => {
    const pts = [[0,0],[0,0],[1,0],[0,1]];
    expect(() => convexHull(pts)).not.toThrow();
  });

  it("handles a large point cloud — hull is a subset of input", () => {
    // 9-point 3×3 grid: only 4 corner points on the hull
    const pts = [];
    for (let x = 0; x <= 2; x++)
      for (let y = 0; y <= 2; y++)
        pts.push([x, y]);
    const h = convexHull(pts);
    expect(h.length).toBe(4);
    const set = new Set(h.map(p => `${p[0]},${p[1]}`));
    expect(set.has("0,0")).toBe(true);
    expect(set.has("2,0")).toBe(true);
    expect(set.has("2,2")).toBe(true);
    expect(set.has("0,2")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pointInPolygon
// ═══════════════════════════════════════════════════════════════════════════════

describe("pointInPolygon", () => {
  // Axis-aligned square for most tests
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it("returns true for a point clearly inside a square", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("returns false for a point to the right of a square", () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it("returns false for a point above-left of a square", () => {
    expect(pointInPolygon(-1, 11, square)).toBe(false);
  });

  it("returns false for a point below a square", () => {
    expect(pointInPolygon(5, -1, square)).toBe(false);
  });

  it("works for a triangle — inside", () => {
    const tri = [[0, 0], [10, 0], [5, 10]];
    expect(pointInPolygon(5, 4, tri)).toBe(true);
  });

  it("works for a triangle — outside (far corner)", () => {
    const tri = [[0, 0], [10, 0], [5, 10]];
    expect(pointInPolygon(0, 9, tri)).toBe(false);
  });

  it("works for a 6-point polygon", () => {
    // Regular-ish hexagon approximation
    const hex = [[5,0],[9,2],[9,7],[5,10],[1,7],[1,2]];
    expect(pointInPolygon(5, 5, hex)).toBe(true);   // center
    expect(pointInPolygon(0, 0, hex)).toBe(false);  // corner outside
  });

  // ── degenerate inputs ──────────────────────────────────────────────────────

  it("returns false for null hull", () => {
    expect(pointInPolygon(0, 0, null)).toBe(false);
  });

  it("returns false for empty hull", () => {
    expect(pointInPolygon(0, 0, [])).toBe(false);
  });

  it("falls back to radius-30 circle for a 1-point hull — inside", () => {
    // Origin node; click at (20, 0) is within radius 30
    expect(pointInPolygon(20, 0, [[0, 0]])).toBe(true);
  });

  it("falls back to radius-30 circle for a 1-point hull — outside", () => {
    expect(pointInPolygon(40, 0, [[0, 0]])).toBe(false);
  });

  it("falls back to radius-30 circle for a 2-point hull — inside (midpoint)", () => {
    // Midpoint of [0,0]-[10,0] is [5,0]; click at [5,0] is distance 0 < 30
    expect(pointInPolygon(5, 0, [[0, 0], [10, 0]])).toBe(true);
  });

  it("falls back to radius-30 circle for a 2-point hull — outside (far away)", () => {
    expect(pointInPolygon(100, 0, [[0, 0], [10, 0]])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// expandHullPts
// ═══════════════════════════════════════════════════════════════════════════════

describe("expandHullPts", () => {
  it("returns null/undefined hull unchanged", () => {
    expect(expandHullPts(null, 5)).toBeNull();
    expect(expandHullPts(undefined, 5)).toBeUndefined();
  });

  it("returns empty array unchanged", () => {
    expect(expandHullPts([], 10)).toEqual([]);
  });

  it("preserves point count", () => {
    const pts = [[0,0],[10,0],[10,10],[0,10]];
    expect(expandHullPts(pts, 5)).toHaveLength(4);
  });

  it("with padding 0 returns same coordinates", () => {
    const pts = [[1,0],[0,1],[-1,0],[0,-1]];
    const exp = expandHullPts(pts, 0);
    exp.forEach(([x,y], i) => {
      expect(x).toBeCloseTo(pts[i][0], 6);
      expect(y).toBeCloseTo(pts[i][1], 6);
    });
  });

  it("expands a diamond (vertices at distance 1 from origin) by padding 1 → distance 2", () => {
    // Diamond centred at origin; each vertex is exactly 1 unit from origin
    const diamond = [[1,0],[0,1],[-1,0],[0,-1]];
    const exp = expandHullPts(diamond, 1);
    exp.forEach(([x, y]) => {
      expect(Math.sqrt(x*x + y*y)).toBeCloseTo(2, 5);
    });
  });

  it("expands a square — each corner moves further from centroid by padding", () => {
    // Square with centroid at (5,5); each corner is sqrt(50) ≈ 7.07 from centroid
    const sq = [[0,0],[10,0],[10,10],[0,10]];
    const pad = 5;
    const exp = expandHullPts(sq, pad);
    const cx = 5, cy = 5;
    sq.forEach(([ox, oy], i) => {
      const origDist = Math.sqrt((ox-cx)**2 + (oy-cy)**2);
      const [nx, ny] = exp[i];
      const newDist  = Math.sqrt((nx-cx)**2 + (ny-cy)**2);
      expect(newDist).toBeCloseTo(origDist + pad, 5);
    });
  });

  it("expands outward — no point moves toward centroid", () => {
    const pts = [[0,0],[6,0],[3,5]]; // triangle
    const cx = pts.reduce((s,p)=>s+p[0],0)/3;
    const cy = pts.reduce((s,p)=>s+p[1],0)/3;
    const exp = expandHullPts(pts, 10);
    pts.forEach(([ox,oy], i) => {
      const origDist = Math.sqrt((ox-cx)**2+(oy-cy)**2);
      const [nx,ny]  = exp[i];
      const newDist  = Math.sqrt((nx-cx)**2+(ny-cy)**2);
      expect(newDist).toBeGreaterThan(origDist);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob hit-test integration  (convexHull + expandHullPts + pointInPolygon)
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests mirror the exact logic used in GraphRenderer's onBackgroundClick:
//   hull     = convexHull(nodePts)
//   expanded = expandHullPts(hull, HIT_PAD)
//   hit      = pointInPolygon(gx, gy, expanded)

describe("blob hit-test integration", () => {
  const HIT_PAD = 40; // matches the constant in GraphRenderer

  it("click at the centroid of a node cluster is a hit", () => {
    const nodes = [[10,10],[40,10],[40,40],[10,40],[25,25]];
    const hull  = convexHull(nodes);
    const exp   = expandHullPts(hull, HIT_PAD);
    expect(pointInPolygon(25, 25, exp)).toBe(true);
  });

  it("click in empty space between spread-out nodes hits (inside hull)", () => {
    // Four corner-nodes with a large empty centre; click at centre = hit
    const nodes = [[0,0],[100,0],[100,100],[0,100]];
    const hull  = convexHull(nodes);
    const exp   = expandHullPts(hull, HIT_PAD);
    expect(pointInPolygon(50, 50, exp)).toBe(true);
  });

  it("click just outside the node hull but within HIT_PAD expansion is a hit", () => {
    const nodes = [[0,0],[100,0],[100,100],[0,100]];
    const hull  = convexHull(nodes);
    // Without expansion: point to the left of the blob misses
    expect(pointInPolygon(-10, 50, hull)).toBe(false);
    // With expansion: same point is now inside the padded area
    const exp = expandHullPts(hull, HIT_PAD);
    expect(pointInPolygon(-10, 50, exp)).toBe(true);
  });

  it("click far from all nodes misses", () => {
    const nodes = [[0,0],[50,0],[50,50],[0,50]];
    const hull  = convexHull(nodes);
    const exp   = expandHullPts(hull, HIT_PAD);
    expect(pointInPolygon(300, 300, exp)).toBe(false);
  });

  it("two separate blobs — click correctly identifies which one was hit", () => {
    // Blob A centred around (0,0); Blob B centred around (200,0)
    const blobA = [[-20,-20],[20,-20],[20,20],[-20,20]];
    const blobB = [[180,-20],[220,-20],[220,20],[180,20]];
    const hullA = convexHull(blobA), expA = expandHullPts(hullA, HIT_PAD);
    const hullB = convexHull(blobB), expB = expandHullPts(hullB, HIT_PAD);

    // Click at (0,0) should hit A, miss B
    expect(pointInPolygon(0, 0, expA)).toBe(true);
    expect(pointInPolygon(0, 0, expB)).toBe(false);

    // Click at (200,0) should hit B, miss A
    expect(pointInPolygon(200, 0, expA)).toBe(false);
    expect(pointInPolygon(200, 0, expB)).toBe(true);
  });

  it("single-node blob (degenerate hull) is still clickable within fallback radius", () => {
    const nodes  = [[50, 50]];
    const hull   = convexHull(nodes);   // returns [[50,50]] — 1 point
    const exp    = expandHullPts(hull, HIT_PAD);
    // Point at the node itself: hits
    expect(pointInPolygon(50, 50, exp)).toBe(true);
    // Point just outside fallback radius: misses
    expect(pointInPolygon(50 + 35, 50, exp)).toBe(false);
  });
});
