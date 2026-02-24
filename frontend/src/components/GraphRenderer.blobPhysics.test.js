/**
 * GraphRenderer.blobPhysics.test.js
 *
 * Characterisation tests for the "boundary flattening" bug in
 * makeVoronoiContainmentForce, and regression tests for the margin-zone fix.
 *
 * THE BUG
 * ───────
 * Stage 4 (straggler correction) only fires when a node has already crossed
 * the Voronoi midpoint (sbd > 0).  Stage 2 (centroid attraction) is alpha-
 * dependent and fades to zero as the simulation cools.  Together these create
 * a dead zone: a node sitting just inside the boundary (barely closer to its
 * own centroid) receives zero corrective force once alpha ≈ 0.  Charge
 * repulsion from the interior keeps pushing nodes outward; they drift to the
 * boundary and park there, forming a flat line.
 *
 * THE FIX (option 1 — boundary margin zone)
 * ─────────────────────────────────────────
 * makeVoronoiContainmentForce gains a `boundaryMargin` parameter (default 0).
 * Stage 4 now fires when sbd > -boundaryMargin — i.e. the node is within
 * `boundaryMargin` units of the boundary — and applies a proportional pixel-
 * push toward the centroid.  Depth = 0 at the outer margin edge, 1 at the
 * boundary.  This is alpha-independent, so it acts even on a cooled sim.
 *
 * SIGN CONVENTION used in helpers:
 *   sbd = (otherDist - ownDist) / 2
 *         positive  → node is closer to its OWN centroid (safely inside)
 *         zero      → exactly at the Voronoi midpoint (boundary)
 *         negative  → node has crossed into the other group's territory
 *
 * (The force code uses (ownDist - otherDist)/2, which has opposite sign.)
 *
 * Test blocks:
 *   [CURRENT]   – documents the bug (should pass today)
 *   [FIX]       – regression tests for the fix (should fail today, pass after fix)
 *   [INVARIANT] – must pass before AND after the fix
 */

import { describe, it, expect } from "vitest";
import { makeVoronoiContainmentForce } from "./GraphRenderer.jsx";
import { forceCollide } from "d3-force-3d";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function node(id, group, x, y) {
  return { id, group, groupPath: [group], x, y, vx: 0, vy: 0 };
}

/**
 * Build a scenario where the two group centroids are well-anchored.
 * 'anchorCount' nodes tightly clustered at (cx, 0) per group ensure that
 * the centroid is close to cx even when one or two "test" nodes are elsewhere.
 */
function makeAnchors(group, cx, anchorCount = 50) {
  return Array.from({ length: anchorCount }, (_, i) =>
    node(`${group}_anchor${i}`, group, cx + (i % 3) * 0.1, (i % 3) * 0.1)
  );
}

/**
 * Run a mini physics loop for `ticks` steps.
 * Forces receive alpha on each tick.
 * velocityDecay and alphaDecay match D3 defaults.
 */
function runSim(nodes, forces, {
  ticks         = 300,
  velocityDecay = 0.4,
  alphaDecay    = 1 - Math.pow(0.001, 1 / 300),
} = {}) {
  let alpha = 1.0;
  for (let t = 0; t < ticks; t++) {
    for (const f of forces) f(alpha);
    for (const n of nodes) {
      n.vx *= velocityDecay;
      n.vy *= velocityDecay;
      n.x  += n.vx;
      n.y  += n.vy;
    }
    alpha *= (1 - alphaDecay);
  }
}

/** Simple O(n²) charge repulsion (alpha-independent to stress-test containment). */
function makeChargeForce(nodes, strength = -200) {
  return function() {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 1;
        const d  = Math.sqrt(d2);
        const f  = strength / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
  };
}

/** Centroid of a node array. */
function centroid(ns) {
  return {
    x: ns.reduce((s, n) => s + n.x, 0) / ns.length,
    y: ns.reduce((s, n) => s + n.y, 0) / ns.length,
  };
}

/**
 * Signed boundary distance (test-file convention):
 *   positive = node is closer to OWN centroid = safely inside
 *   zero     = at Voronoi midpoint
 *   negative = closer to OTHER centroid = has crossed boundary
 */
function sbd(n, ownC, otherC) {
  const dOwn   = Math.sqrt((n.x - ownC.x)   ** 2 + (n.y - ownC.y)   ** 2);
  const dOther = Math.sqrt((n.x - otherC.x) ** 2 + (n.y - otherC.y) ** 2);
  return (dOther - dOwn) / 2;  // positive → inside own territory
}

/**
 * Project a node onto the axis from ownC toward otherC.
 * Higher value → closer to (or past) the Voronoi boundary on that side.
 */
function boundaryProjection(n, ownC, otherC) {
  const ax = otherC.x - ownC.x, ay = otherC.y - ownC.y;
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  return ((n.x - ownC.x) * ax + (n.y - ownC.y) * ay) / len;
}

/**
 * "Boundary layer fraction": fraction of nodes whose projection onto the
 * ownC→otherC axis is in the outermost `outerFrac` portion of the blob.
 * A uniform distribution would show ~outerFrac. Flattening → much higher.
 */
function boundaryLayerFraction(ns, ownC, otherC, outerFrac = 0.25) {
  const projs   = ns.map(n => boundaryProjection(n, ownC, otherC));
  const maxP    = Math.max(...projs);
  const minP    = Math.min(...projs);
  const thresh  = minP + (maxP - minP) * (1 - outerFrac);
  return projs.filter(p => p >= thresh).length / ns.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// [CURRENT] dead-zone unit tests — document the bug at the force level
// ─────────────────────────────────────────────────────────────────────────────

describe("[CURRENT] Stage 4 dead zone — confirms boundary pile-up mechanism", () => {
  /**
   * We use 50 anchor nodes per group to pin each centroid tightly.
   * A single "test" node is added near the boundary.
   * cA ≈ −200, cB ≈ +200, Voronoi midpoint ≈ 0.
   */
  function makeScene(testX) {
    const nodes = [
      ...makeAnchors("A", -200),
      ...makeAnchors("B",  200),
      node("test", "A", testX, 0),
    ];
    return nodes;
  }

  it("node exactly at Voronoi midpoint (x=0): Stage 4 fires only weakly at alpha≈0", () => {
    // At x=0: ownDist ≈ 200, otherDist ≈ 200 → sbd ≈ 0 → condition sbd>0 barely true/false.
    // With 50 anchors, centroid A shifts slightly (to ~-196), so x=0 is just inside A.
    const nodes  = makeScene(0);
    const f      = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    f.initialize(nodes);
    const test   = nodes.find(n => n.id === "test");
    const xBefore = test.x;
    f(0.0001); // near-zero alpha
    // Stage 4 may or may not fire (node is right at/near boundary).
    // Either way: with alpha≈0, Stage 2 contributes < 0.001px. No big correction.
    expect(Math.abs(test.x - xBefore)).toBeLessThan(3);
  });

  it("node 10px inside boundary: zero correction at alpha=0 (the dead zone)", () => {
    // With cA≈-196, cB≈200, Voronoi midpoint at x≈2.
    // x=-8 is ~10px inside A's side → sbd > 0 (just inside), Stage 4 doesn't fire.
    const nodes  = makeScene(-8);
    const f      = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    f.initialize(nodes);
    const test   = nodes.find(n => n.id === "test");
    const xBefore = test.x;
    f(0.0001); // Stage 2 dead (alpha≈0), Stage 4 check: otherDist > ownDist → no fire
    // Node barely inside boundary → no corrective force → stays put
    expect(Math.abs(test.x - xBefore)).toBeLessThan(1);
  });

  it("node 10px past boundary: Stage 4 fires and moves node toward A", () => {
    // x=+12 is ~10px past the midpoint (x≈2) → Stage 4 fires.
    const nodes  = makeScene(12);
    const f      = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    f.initialize(nodes);
    const test   = nodes.find(n => n.id === "test");
    const xBefore = test.x;
    f(0.001);
    expect(test.x).toBeLessThan(xBefore - 0.5); // pushed back toward A
  });

  it("asymmetry: node just past boundary corrected, node just inside is not", () => {
    // Test the dead zone contrast:
    //   outside (+12) → Stage 4 fires → moves left
    //   inside  (-8)  → Stage 4 dead zone → barely moves
    const nodesOut = makeScene(12);
    const nodesIn  = makeScene(-8);

    const fOut = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    fOut.initialize(nodesOut);
    const fIn  = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    fIn.initialize(nodesIn);

    const tOut = nodesOut.find(n => n.id === "test");
    const tIn  = nodesIn.find(n => n.id === "test");
    const xOut = tOut.x, xIn = tIn.x;

    fOut(0.0001);
    fIn(0.0001);

    const deltaOut = tOut.x - xOut;
    const deltaIn  = tIn.x  - xIn;

    // Outside: Stage 4 fires → meaningfully corrected (moves left)
    expect(deltaOut).toBeLessThan(-0.5);
    // Inside: dead zone → negligible movement
    expect(Math.abs(deltaIn)).toBeLessThan(1);
    // Outside node gets significantly more correction than inside node
    expect(deltaOut).toBeLessThan(deltaIn - 0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [CURRENT] Simulation-level flattening characterisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ring-topology link force: each node connected to its two neighbours.
 * Keeps the blob compact while allowing charge to spread nodes out.
 * Without links, a pure charge simulation just explodes the blobs apart.
 */
function makeRingLinkForce(nodes, groupSize, linkDist = 50, strength = 0.5) {
  return function(alpha) {
    for (let g = 0; g < nodes.length / groupSize; g++) {
      const base = g * groupSize;
      for (let i = 0; i < groupSize; i++) {
        const a   = nodes[base + i];
        const b   = nodes[base + (i + 1) % groupSize];
        const dx  = b.x - a.x, dy = b.y - a.y;
        const d   = Math.sqrt(dx * dx + dy * dy) || 1;
        const k   = strength * alpha * (d - linkDist) / d;
        a.vx += dx * k; a.vy += dy * k;
        b.vx -= dx * k; b.vy -= dy * k;
      }
    }
  };
}

/**
 * Aspect ratio of the front `frontFrac` of nodes (by projection onto the
 * centroid-centroid axis):  y_stddev / x_stddev.
 *
 * A "flat edge" has many nodes at the same x but spread over y →
 *   LOW x_stddev, HIGH y_stddev → HIGH aspect ratio (> 2.5).
 *
 * A healthy circular blob crescent has roughly equal spread in both →
 *   aspect ratio closer to 1.
 */
function frontAspectRatio(ns, cA, cB, frontFrac = 0.30) {
  const projs = ns.map(n => boundaryProjection(n, cA, cB));
  const maxP  = Math.max(...projs);
  const minP  = Math.min(...projs);
  const thresh = minP + (maxP - minP) * (1 - frontFrac);
  const front  = ns.filter((_, i) => projs[i] >= thresh);
  if (front.length < 2) return 1;
  const mx = front.reduce((s, n) => s + n.x, 0) / front.length;
  const my = front.reduce((s, n) => s + n.y, 0) / front.length;
  const vx = front.reduce((s, n) => s + (n.x - mx) ** 2, 0) / front.length;
  const vy = front.reduce((s, n) => s + (n.y - my) ** 2, 0) / front.length;
  return Math.sqrt(vy) / Math.max(Math.sqrt(vx), 0.5);
}

describe("[CURRENT] Flat-line configuration is a stable dead zone (no margin)", () => {
  /**
   * Direct characterisation: pre-position nodes in the flat-line state that
   * the user observes (all nodes at x = blobFront, spread over y).
   *
   * With blobPadding=30 and centroids at ±100, Stage 3 equilibrium puts the
   * front of blob A at x ≈ -15 (half-padding inside the boundary at x=0).
   * These nodes have sbd_force = -15 → Stage 4 condition (sbd > 0) is false.
   * With alpha ≈ 0, Stage 2 is also dead.  Result: zero corrective force.
   * The flat line is a permanent equilibrium — this IS the bug.
   */
  function buildFlatLineScene(margin = 0) {
    // 50 anchors strongly pin centroid A at -100, centroid B at +100.
    const nodes = [...makeAnchors("A", -100, 50), ...makeAnchors("B", 100, 50)];
    // 8 front nodes placed in a flat line at x = -15 (just inside boundary at x=0).
    // They span y = [-70, -50, ..., +70] — the classic flat-edge pattern.
    for (let i = 0; i < 8; i++) {
      nodes.push(node(`front${i}`, "A", -15, -70 + i * 20));
    }
    return nodes;
  }

  it("flat-line nodes are NOT corrected at alpha=0 without margin (dead zone)", () => {
    const nodes   = buildFlatLineScene(0);
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 30, 0, 0);
    contain.initialize(nodes);

    const fronts  = nodes.filter(n => n.id?.startsWith("front"));
    const xBefore = fronts.map(n => n.x);

    contain(0.0001);  // alpha ≈ 0 — Stage 2 dead, Stage 4 checks sbd

    // x = -15: ownDist ≈ 85, otherDist ≈ 115 → sbd_force = (85-115)/2 = -15 < 0
    // Stage 4 condition (sbd > 0) is FALSE → no correction → nodes stay put
    for (let i = 0; i < fronts.length; i++) {
      expect(Math.abs(fronts[i].x - xBefore[i])).toBeLessThan(0.5);
    }
  });

  it("flat-line is a stable equilibrium: re-running force leaves nodes unchanged", () => {
    // This proves the flat-line is not transient — it's where nodes park permanently.
    const nodes   = buildFlatLineScene(0);
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 30, 0, 0);
    contain.initialize(nodes);

    const fronts  = nodes.filter(n => n.id?.startsWith("front"));
    const xAfter1 = fronts.map(n => { contain(0.0001); return n.x; });
    const xAfter2 = fronts.map(n => { contain(0.0001); return n.x; });

    // 10 ticks later — still no movement
    for (let i = 0; i < fronts.length; i++) {
      expect(Math.abs(xAfter2[i] - xAfter1[i])).toBeLessThan(0.01);
    }
  });

  it("single isolated blob shows more uniform distribution (no neighbouring boundary)", () => {
    const nodes = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * 2 * Math.PI;
      return node(`A${i}`, "A", 70 * Math.cos(a), 70 * Math.sin(a));
    });
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 20, 0, 0);
    contain.initialize(nodes);
    const charge  = makeChargeForce(nodes, -300);

    runSim(nodes, [contain, charge], { ticks: 500 });

    const cA       = centroid(nodes);
    const fakeOther = { x: cA.x + 300, y: cA.y };
    const lf       = boundaryLayerFraction(nodes, cA, fakeOther, 0.25);

    // Isolated blob: no flat edge → close to uniform (~25% in outer 25%)
    expect(lf).toBeLessThan(0.40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [FIX] Regression tests — these must pass after the margin-zone fix
// ─────────────────────────────────────────────────────────────────────────────

describe("[FIX] Boundary margin zone eliminates dead zone and reduces flat-edge", () => {
  function makeScene(testX) {
    return [
      ...makeAnchors("A", -200),
      ...makeAnchors("B",  200),
      node("test", "A", testX, 0),
    ];
  }

  it("node 10px inside boundary IS pushed back when boundaryMargin=35", () => {
    const nodes  = makeScene(-8);
    // margin=35: fires when sbd_force > -35, i.e. within 35px of boundary
    const f      = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f.initialize(nodes);
    const test   = nodes.find(n => n.id === "test");
    const xBefore = test.x;
    f(0.0001); // alpha≈0 — only the margin zone correction acts
    // The fix: node within margin zone gets pushed back toward A centroid
    expect(test.x).toBeLessThan(xBefore - 0.3);
  });

  it("correction is stronger for nodes closer to the boundary (linear ramp)", () => {
    // node at -8 (close to boundary) should get stronger push than node at -28 (deeper)
    const nodesNear = makeScene(-8);
    const nodesDeep = makeScene(-28);
    const f1 = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f1.initialize(nodesNear);
    const f2 = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f2.initialize(nodesDeep);

    const tNear = nodesNear.find(n => n.id === "test");
    const tDeep = nodesDeep.find(n => n.id === "test");
    const xNear = tNear.x, xDeep = tDeep.x;

    f1(0.0001); f2(0.0001);

    // Node nearer to boundary gets bigger correction (more negative delta)
    expect(tNear.x - xNear).toBeLessThan(tDeep.x - xDeep);
  });

  it("node well inside margin boundary gets zero correction (no over-tightening)", () => {
    // x=-100 is ~102px inside boundary → outside the 35px margin zone → no correction
    const nodes  = makeScene(-100);
    const f      = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f.initialize(nodes);
    const test   = nodes.find(n => n.id === "test");
    const xBefore = test.x;
    f(0.0001);
    // Well inside the blob → margin zone doesn't fire → no change
    expect(Math.abs(test.x - xBefore)).toBeLessThan(1);
  });

  it("flat-line nodes ARE pushed back with margin=35 (closer to boundary)", () => {
    // Front nodes at x=-5: only 5px inside the Voronoi boundary.
    // With margin=35: depth=(sbd+35)/35 ≈ 0.9 → pushPx ≈ 2.5px per tick.
    // Detectable even accounting for anchor centroid shift.
    const nodes   = [
      ...makeAnchors("A", -200, 50), ...makeAnchors("B", 200, 50),
      ...Array.from({ length: 8 }, (_, i) => node(`front${i}`, "A", -5, -70 + i * 20)),
    ];
    // Anchors at ±200 keep centroids at ≈ ±196, midpoint at ≈ 0.
    // Node at x=-5: ownDist≈191, otherDist≈205 → sbd≈-7 → within margin=35.
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    contain.initialize(nodes);

    const fronts  = nodes.filter(n => n.id?.startsWith("front"));
    const xBefore = fronts.map(n => n.x);

    contain(0.0001);

    // depth = (-7+35)/35 = 0.8, pushPx = 0.8 * 35 * 0.08 = 2.24px
    // All front nodes should move clearly toward A (measurable x change)
    for (let i = 0; i < fronts.length; i++) {
      expect(fronts[i].x).toBeLessThan(xBefore[i] - 0.5);  // moved > 0.5px toward A
    }
  });

  it("margin zone breaks the stable equilibrium: signed boundary dist increases", () => {
    // Show that the no-fix equilibrium (sbd constant) is broken by the fix.
    // With margin active, the force keeps pushing → sbd increases after each tick.
    const nodes   = [
      ...makeAnchors("A", -200, 50), ...makeAnchors("B", 200, 50),
      node("front0", "A", -5, 0),  // single node right inside boundary
    ];
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    contain.initialize(nodes);
    const front = nodes.find(n => n.id === "front0");

    // Compute initial sbd (positive = inside own territory)
    const cA0 = { x: nodes.filter(n=>n.group==="A").reduce((s,n)=>s+n.x,0) /
                       nodes.filter(n=>n.group==="A").length, y: 0 };
    const cB0 = { x: nodes.filter(n=>n.group==="B").reduce((s,n)=>s+n.x,0) /
                       nodes.filter(n=>n.group==="B").length, y: 0 };
    const sbdBefore = sbd(front, cA0, cB0);

    // Run 5 ticks
    for (let t = 0; t < 5; t++) {
      contain(0.0001);
      for (const n of nodes) { n.vx *= 0.4; n.vy *= 0.4; n.x += n.vx; n.y += n.vy; }
    }

    // Compute sbd after ticks using current centroids
    const nA2 = nodes.filter(n => n.group === "A");
    const cA2 = { x: nA2.reduce((s,n)=>s+n.x,0)/nA2.length, y: 0 };
    const sbdAfter = sbd(front, cA2, cB0);

    // After fix: sbd increased (node moved deeper inside → further from boundary)
    expect(sbdAfter).toBeGreaterThan(sbdBefore + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [INVARIANT] Must pass before AND after the fix
// ─────────────────────────────────────────────────────────────────────────────

describe("[INVARIANT] Core correctness — holds with and without margin fix", () => {
  it("node clearly past boundary is always corrected (Stage 4)", () => {
    const nodes = [
      ...makeAnchors("A", -200),
      ...makeAnchors("B",  200),
      node("far", "A", 30, 0),   // well past midpoint ~x=2
    ];
    const f = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    f.initialize(nodes);
    const t = nodes.find(n => n.id === "far");
    const x0 = t.x;
    f(0.001);
    expect(t.x).toBeLessThan(x0);
  });

  it("node deep inside own blob is undisturbed at alpha=0 (no over-tightening)", () => {
    const nodes = [
      ...makeAnchors("A", -200),
      ...makeAnchors("B",  200),
      node("deep", "A", -160, 0),  // 160px inside boundary → well outside any margin zone
    ];
    const f = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f.initialize(nodes);
    const t = nodes.find(n => n.id === "deep");
    const x0 = t.x;
    f(0.0001);
    expect(Math.abs(t.x - x0)).toBeLessThan(2);
  });

  it("group centroids remain clearly separated after full sim", () => {
    const nodes = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 2 * Math.PI;
      nodes.push(node(`A${i}`, "A", -100 + 40 * Math.cos(a), 40 * Math.sin(a)));
      nodes.push(node(`B${i}`, "B",  100 + 40 * Math.cos(a), 40 * Math.sin(a)));
    }
    const f = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f.initialize(nodes);
    const charge = makeChargeForce(nodes, -150);
    runSim(nodes, [f, charge], { ticks: 300 });

    const cA = centroid(nodes.filter(n => n.group === "A"));
    const cB = centroid(nodes.filter(n => n.group === "B"));
    const d  = Math.sqrt((cA.x - cB.x) ** 2 + (cA.y - cB.y) ** 2);
    expect(d).toBeGreaterThan(80);
  });

  it("all A nodes remain closer to A centroid than B centroid after sim", () => {
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      nodes.push(node(`A${i}`, "A", -120 + 50 * Math.cos(a), 50 * Math.sin(a)));
      nodes.push(node(`B${i}`, "B",  120 + 50 * Math.cos(a), 50 * Math.sin(a)));
    }
    const f = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    f.initialize(nodes);
    const charge = makeChargeForce(nodes, -150);
    runSim(nodes, [f, charge], { ticks: 300 });

    const cA = centroid(nodes.filter(n => n.group === "A"));
    const cB = centroid(nodes.filter(n => n.group === "B"));

    for (const n of nodes.filter(n => n.group === "A")) {
      const dA = Math.sqrt((n.x - cA.x) ** 2 + (n.y - cA.y) ** 2);
      const dB = Math.sqrt((n.x - cB.x) ** 2 + (n.y - cB.y) ** 2);
      expect(dA).toBeLessThan(dB);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [REGRESSION] Blob collapse prevention
// ─────────────────────────────────────────────────────────────────────────────
//
// THE BUG
// ───────
// Previous fixes to the ring-accumulation problem (centripetal alpha floor,
// soft radial wall) both caused nodes to collapse into a single tightly-
// overlapping cluster.  The user saw a blob that appeared as one large dot.
//
// ROOT CAUSE
// ──────────
// Any inward force that outweighs the outward charge collapses nodes.  The
// alpha-floor set centripetal >> charge at low alpha; the soft radial wall
// pushed all perimeter nodes inward every tick, converging to a point.
//
// THE FIX
// ───────
// Replace long-range charge (strength -350, causes ring) with:
//   1. Tiny charge (-5): barely enough to maintain coarse inter-blob spacing.
//   2. forceCollide(7): short-range repulsion.  Prevents overlap without
//      any boundary-seeking behaviour.  Nodes pack into a disc; centripetal
//      keeps the disc together; collision keeps nodes apart.
//
// TESTS
// ─────
//   [CURRENT]  documents the collapse (centripetal alone → nodes stack)
//   [FIX]      verifies forceCollide prevents the collapse
//   [INVARIANT] holds before and after: blobs stay separated

describe("[REGRESSION] Blob collapse prevention (forceCollide fix)", () => {
  /** Start N nodes clustered near origin — worst case for collapse testing. */
  function makeBlobNodes(N, group, spread = 5) {
    let i = 0;
    return Array.from({ length: N }, () =>
      node(`${group}${i++}`, group,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread)
    );
  }

  /** RMS distance of nodes from their own centroid (overall spread). */
  function rmsSpread(nodes) {
    const c   = centroid(nodes);
    const sum = nodes.reduce((s, n) => s + (n.x - c.x) ** 2 + (n.y - c.y) ** 2, 0);
    return Math.sqrt(sum / nodes.length);
  }

  /** Smallest pairwise distance between any two nodes. */
  function minPairDist(nodes) {
    let min = Infinity;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.sqrt((nodes[i].x - nodes[j].x) ** 2 + (nodes[i].y - nodes[j].y) ** 2);
        if (d < min) min = d;
      }
    return min;
  }

  /**
   * Simple O(N²) collision: push overlapping pairs apart by direct position
   * adjustment.  More predictable in jsdom/vitest than d3's quadtree-based
   * forceCollide (which has issues initialising outside a browser context).
   */
  function makeCollideForce(nodes, radius = 7) {
    return function() {
      const minDist = radius * 2;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d  = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          if (d < minDist) {
            const push = (minDist - d) / d * 0.5;
            a.x -= dx * push;  a.y -= dy * push;
            b.x += dx * push;  b.y += dy * push;
          }
        }
      }
    };
  }

  it("[CURRENT] centripetal alone collapses nodes to a point (documents the bug)", () => {
    const nodes   = makeBlobNodes(20, "A");
    const contain = makeVoronoiContainmentForce(0.5, 0.35, 60, 0, 0); // strong centripetal
    contain.initialize(nodes);
    runSim(nodes, [contain], { ticks: 300 });
    // No repulsion → centripetal pulls everything to centroid → all nodes at same spot.
    expect(rmsSpread(nodes)).toBeLessThan(3);
  });

  it("[FIX] forceCollide prevents collapse — rmsSpread > collision radius", () => {
    const nodes   = makeBlobNodes(20, "A");
    const contain = makeVoronoiContainmentForce(0.5, 0.35, 60, 0, 0);
    contain.initialize(nodes);
    const collide = makeCollideForce(nodes, 7);
    runSim(nodes, [contain, collide], { ticks: 300 });
    // Collision keeps nodes separated: spread must exceed at least one collision radius.
    expect(rmsSpread(nodes)).toBeGreaterThan(7);
  });

  it("[FIX] minimum inter-node gap stays above 80% of collision radius", () => {
    const RADIUS  = 7;
    const nodes   = makeBlobNodes(20, "A");
    const contain = makeVoronoiContainmentForce(0.3, 0.35, 60, 0, 0);
    contain.initialize(nodes);
    const collide = makeCollideForce(nodes, RADIUS);
    runSim(nodes, [contain, collide], { ticks: 400 });
    // forceCollide(7) should keep every pair > ~5.6 px apart.
    expect(minPairDist(nodes)).toBeGreaterThan(RADIUS * 0.8);
  });

  it("[FIX] nodes fill blob interior — not all bunched at perimeter (no ring)", () => {
    // Start in worst-case ring layout to ensure convergence is tested.
    const nodes = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * 2 * Math.PI;
      return node(`A${i}`, "A", 80 * Math.cos(a), 80 * Math.sin(a));
    });
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 0);
    contain.initialize(nodes);
    const collide = makeCollideForce(nodes, 7);
    runSim(nodes, [contain, collide], { ticks: 400 });

    const c       = centroid(nodes);
    const dists   = nodes.map(n => Math.sqrt((n.x - c.x) ** 2 + (n.y - c.y) ** 2));
    const maxDist = Math.max(...dists);
    // A perfect ring would have 0 nodes inside the inner 60% of max radius.
    // A uniform disc would have ~36%.  We require ≥ 25%.
    const innerFrac = dists.filter(d => d < maxDist * 0.6).length / nodes.length;
    expect(innerFrac).toBeGreaterThan(0.25);
  });

  it("[INVARIANT] two blobs with collision force remain separated", () => {
    const nodesA = makeBlobNodes(15, "A"); nodesA.forEach(n => { n.x -= 100; });
    const nodesB = makeBlobNodes(15, "B"); nodesB.forEach(n => { n.x += 100; });
    const all    = [...nodesA, ...nodesB];
    const contain = makeVoronoiContainmentForce(0.10, 0.35, 60, 0, 35);
    contain.initialize(all);
    const collide = makeCollideForce(all, 7);
    runSim(all, [contain, collide], { ticks: 300 });

    const cA = centroid(all.filter(n => n.group === "A"));
    const cB = centroid(all.filter(n => n.group === "B"));
    const d  = Math.sqrt((cA.x - cB.x) ** 2 + (cA.y - cB.y) ** 2);
    expect(d).toBeGreaterThan(30);
  });
});
