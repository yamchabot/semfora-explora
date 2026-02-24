import { describe, it, expect } from "vitest";
import {
  findOptimalCircularOrder,
  buildPairWeights,
  computeTopologyAwareGroupPos,
  countCorridorCrossings,
} from "./topologyLayout.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeNodes(groups) {
  return groups.flatMap((g, gi) =>
    Array.from({ length: 3 }, (_, i) => ({ id: `${g}${i}`, group: g }))
  );
}

function makeLinks(pairs) {
  return pairs.map(([s, t]) => ({ source: s, target: t }));
}

// ── buildPairWeights ─────────────────────────────────────────────────────────

describe("buildPairWeights", () => {
  it("counts cross-module edges correctly", () => {
    const nodes = makeNodes(["A", "B", "C"]);
    const links = makeLinks([["A0","B0"], ["A1","B1"], ["A0","C0"]]);
    const pw = buildPairWeights(nodes, links);
    expect(pw["A|B"]).toBe(2);
    expect(pw["A|C"]).toBe(1);
    expect(pw["B|C"]).toBeUndefined();
  });

  it("ignores intra-module edges", () => {
    const nodes = makeNodes(["A"]);
    const links = makeLinks([["A0","A1"], ["A1","A2"]]);
    const pw = buildPairWeights(nodes, links);
    expect(Object.keys(pw)).toHaveLength(0);
  });

  it("normalises key order (smaller group first)", () => {
    const nodes = makeNodes(["A", "B"]);
    const links = makeLinks([["B0","A0"]]);
    const pw = buildPairWeights(nodes, links);
    expect(pw["A|B"]).toBe(1);
    expect(pw["B|A"]).toBeUndefined();
  });
});

// ── findOptimalCircularOrder ──────────────────────────────────────────────────

describe("findOptimalCircularOrder", () => {
  it("returns unchanged order for ≤ 2 groups", () => {
    expect(findOptimalCircularOrder(["A"], {})).toEqual(["A"]);
    expect(findOptimalCircularOrder(["A","B"], {"A|B":3})).toEqual(["A","B"]);
  });

  it("avoids crossing for the classic 4-module case", () => {
    // A-C: 4 edges, B-D: 4 edges.
    // Naive order A-B-C-D puts A-C and B-D diagonally opposite → they cross.
    // Optimal: A-C adjacent, B-D adjacent → no crossing.
    const groups  = ["A","B","C","D"];
    const weights = { "A|C": 4, "B|D": 4 };
    const order   = findOptimalCircularOrder(groups, weights);

    const pos = new Map(order.map((g, i) => [g, i]));
    // A and C should be adjacent (positions differ by 1, wrapping)
    const posA = pos.get("A"), posC = pos.get("C");
    const gap  = Math.min(Math.abs(posA - posC), 4 - Math.abs(posA - posC));
    expect(gap).toBe(1);

    // B and D should be adjacent
    const posB = pos.get("B"), posD = pos.get("D");
    const gapBD = Math.min(Math.abs(posB - posD), 4 - Math.abs(posB - posD));
    expect(gapBD).toBe(1);
  });

  it("returns 0 corridor crossings for the optimal order", () => {
    const groups  = ["A","B","C","D"];
    const weights = { "A|C": 4, "B|D": 4 };
    const order   = findOptimalCircularOrder(groups, weights);
    const R = 400;
    const pos = new Map(order.map((g, i) => {
      const a = (2 * Math.PI * i) / 4;
      return [g, { x: Math.cos(a) * R, y: Math.sin(a) * R }];
    }));
    const { crossingPairs } = countCorridorCrossings(pos, weights);
    expect(crossingPairs).toBe(0);
  });

  it("naive order A-B-C-D DOES have crossings (confirms the problem exists)", () => {
    const weights = { "A|C": 4, "B|D": 4 };
    const R = 400;
    const pos = new Map([
      ["A", { x:  R, y:  0 }],
      ["B", { x:  0, y:  R }],
      ["C", { x: -R, y:  0 }],
      ["D", { x:  0, y: -R }],
    ]);
    const { crossingPairs } = countCorridorCrossings(pos, weights);
    expect(crossingPairs).toBe(1);
  });

  it("handles 3 groups with no crossings possible", () => {
    // 3 groups on a triangle — no pair of non-sharing corridors can cross
    const groups  = ["A","B","C"];
    const weights = { "A|B":2, "B|C":2, "A|C":2 };
    const order   = findOptimalCircularOrder(groups, weights);
    expect(order).toHaveLength(3);
    // All three groups are present
    expect(new Set(order)).toEqual(new Set(groups));
  });

  it("5 modules: pipeline A-B-C-D-E but A-E also connected", () => {
    const groups  = ["A","B","C","D","E"];
    const weights = { "A|B":2, "B|C":2, "C|D":2, "D|E":2, "A|E":5 };
    const order   = findOptimalCircularOrder(groups, weights);
    // A and E should be adjacent (they have the strongest coupling)
    const pos = new Map(order.map((g, i) => [g, i]));
    const posA = pos.get("A"), posE = pos.get("E");
    const gap  = Math.min(Math.abs(posA - posE), 5 - Math.abs(posA - posE));
    expect(gap).toBe(1);
  });
});

// ── computeTopologyAwareGroupPos ──────────────────────────────────────────────

describe("computeTopologyAwareGroupPos", () => {
  it("returns a map with one entry per group", () => {
    const nodes = makeNodes(["A","B","C","D"]);
    const links = makeLinks([["A0","C0"],["A1","C1"],["B0","D0"],["B1","D1"]]);
    const pos = computeTopologyAwareGroupPos(nodes, links, ["A","B","C","D"], 400);
    expect(pos.size).toBe(4);
    for (const g of ["A","B","C","D"]) {
      expect(pos.has(g)).toBe(true);
      expect(typeof pos.get(g).x).toBe("number");
      expect(typeof pos.get(g).y).toBe("number");
    }
  });

  it("places strongly-coupled modules adjacent in the output order", () => {
    const nodes = makeNodes(["A","B","C","D"]);
    // A-C strongly coupled, B-D strongly coupled
    const links = makeLinks([
      ["A0","C0"],["A1","C1"],["A2","C2"],["A0","C1"],
      ["B0","D0"],["B1","D1"],["B2","D2"],["B0","D1"],
    ]);
    const groups = ["A","B","C","D"];
    const pos    = computeTopologyAwareGroupPos(nodes, links, groups, 400);

    const pairWeights = buildPairWeights(nodes, links);
    const { crossingPairs } = countCorridorCrossings(pos, pairWeights);
    expect(crossingPairs).toBe(0);
  });

  it("falls back gracefully for 1–2 groups", () => {
    const nodes1 = makeNodes(["A"]);
    const pos1   = computeTopologyAwareGroupPos(nodes1, [], ["A"], 400);
    expect(pos1.size).toBe(1);

    const nodes2 = makeNodes(["A","B"]);
    const links2 = makeLinks([["A0","B0"]]);
    const pos2   = computeTopologyAwareGroupPos(nodes2, links2, ["A","B"], 400);
    expect(pos2.size).toBe(2);
  });
});

// ── countCorridorCrossings ────────────────────────────────────────────────────

describe("countCorridorCrossings", () => {
  it("detects the perpendicular cross in a 4-module square", () => {
    const R = 400;
    const pos = new Map([
      ["A", { x:  R, y:  0 }],
      ["B", { x:  0, y:  R }],
      ["C", { x: -R, y:  0 }],
      ["D", { x:  0, y: -R }],
    ]);
    const { crossingPairs, weightedRatio } = countCorridorCrossings(pos, { "A|C":1, "B|D":1 });
    expect(crossingPairs).toBe(1);
    expect(weightedRatio).toBeGreaterThan(0);
  });

  it("returns 0 when all modules are on one side", () => {
    const pos = new Map([
      ["A", { x: 0,   y: 0 }],
      ["C", { x: 100, y: 0 }],
      ["B", { x: 200, y: 0 }],
      ["D", { x: 300, y: 0 }],
    ]);
    // A-C and B-D are both on the x-axis, A-C doesn't cross B-D (they don't interleave)
    const { crossingPairs } = countCorridorCrossings(pos, { "A|C":1, "B|D":1 });
    expect(crossingPairs).toBe(0);
  });

  it("ignores corridor pairs that share a module endpoint", () => {
    const pos = new Map([
      ["A", { x:   0, y:  0 }],
      ["B", { x: 100, y:  0 }],
      ["C", { x: 200, y: 100}],
    ]);
    // A-B and A-C share A — can never be a proper crossing
    const { crossingPairs } = countCorridorCrossings(pos, { "A|B":2, "A|C":2 });
    expect(crossingPairs).toBe(0);
  });
});
