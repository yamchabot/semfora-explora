/**
 * graphShapes.test.js
 *
 * Tests that force-directed layout produces recognisable program-structure
 * shapes, and that blob containment forces don't crush those shapes.
 *
 * Good software has recurring call-graph motifs:
 *   - Pipeline  : A→B→C→D→E          — should form an elongated LINE
 *   - Dispatcher: hub→[A,B,C,D]       — hub in centre, spokes radiate outward
 *   - Funnel    : [A,B,C,D]→sink      — sink near centroid of callers
 *   - Two-chain : A→B→C  +  D→E→F    — two separate strands, not one ball
 *
 * Naming:
 *   [INVARIANT] — must hold in every configuration
 *   [CURRENT]   — passes today (outer blob with near-zero attractStrength)
 *   [FIX]       — goal: should pass once inner-blob structure is solved
 *                 Expected to FAIL with 2-level nesting as of this commit.
 */

import { describe, it, expect } from 'vitest';
import { forceSimulation, forceLink, forceManyBody } from 'd3-force-3d';
import { makeNestedBlobForce } from './GraphRenderer';

const L = 120; // link distance — matches production default

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Create a node with explicit starting position.
 * group = outer blob key (module).  innerGroup = inner blob key (class).
 */
function node(id, x, y, group, innerGroup = null, val = 6) {
  const groupPath = innerGroup ? [group, innerGroup] : [group];
  return { id, x, y, vx: 0, vy: 0, group, groupPath, val };
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function centroid(nodes) {
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
}

/**
 * O(N²) collision force — avoids the d3-force-3d quadtree bug in jsdom.
 * Direct position-push (no velocity), applied each tick before integration.
 */
function makeCollideForce(radiusFn) {
  let _nodes = [];
  function force() {
    for (let i = 0; i < _nodes.length; i++) {
      for (let j = i + 1; j < _nodes.length; j++) {
        const a = _nodes[i], b = _nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const r  = radiusFn(a) + radiusFn(b);
        if (d < r) {
          const push = (r - d) / d * 0.5;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }
  force.initialize = nodes => { _nodes = nodes; };
  return force;
}

/**
 * PCA on node positions → returns major and minor axis spans.
 * A chain should have major >> minor (elongation ratio > 2).
 * A hub's spokes should have major ≈ minor (roughly circular).
 */
function axisSpans(nodes) {
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const n of nodes) {
    const dx = n.x - cx, dy = n.y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // Principal axis angle (eigenvector of 2×2 cov matrix)
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c1 = Math.cos(angle), s1 = Math.sin(angle);
  const c2 = -s1,             s2 = c1;             // perpendicular
  const proj1 = nodes.map(n => (n.x - cx) * c1 + (n.y - cy) * s1);
  const proj2 = nodes.map(n => (n.x - cx) * c2 + (n.y - cy) * s2);
  const span  = p => Math.max(...p) - Math.min(...p);
  return { major: span(proj1), minor: span(proj2) };
}

/**
 * Run a D3 force simulation to convergence.
 * `extraForces` = { key: forceObject | null } added/replaced after defaults.
 */
function runSim(nodes, links, extraForces = {}, ticks = 500) {
  const sim = forceSimulation(nodes)
    .force('link',    forceLink(links).id(n => n.id).distance(L).strength(0.5))
    .force('charge',  forceManyBody().strength(-30))
    .force('collide', makeCollideForce(n => (n.val ?? 6) + 15))
    .stop();
  for (const [k, f] of Object.entries(extraForces)) sim.force(k, f);
  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

// ── INVARIANT: pure topology shapes (no blob forces) ─────────────────────────

describe('[INVARIANT] Topology shapes — no blob containment', () => {

  it('pipeline A→B→C→D→E forms an elongated line (major/minor > 2)', () => {
    // e.g.  parse() → validate() → transform() → enrich() → save()
    const nodes = [
      node('A', 0,     0, 'M'),
      node('B', L,     0, 'M'),
      node('C', 2 * L, 0, 'M'),
      node('D', 3 * L, 0, 'M'),
      node('E', 4 * L, 0, 'M'),
    ];
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'D', target: 'E' },
    ];
    runSim(nodes, links, {}, 500);
    const { major, minor } = axisSpans(nodes);
    expect(major).toBeGreaterThan(3 * L);      // at least 3× link-length span
    expect(major / minor).toBeGreaterThan(2);  // clearly elongated
  });

  it('dispatcher hub→[A,B,C,D]: hub is near centroid of spokes', () => {
    // e.g.  router() → [handlerA, handlerB, handlerC, handlerD]
    const nodes = [
      node('Hub', 0,  0,  'M'),
      node('A',   L,  0,  'M'),
      node('B',   0,  L,  'M'),
      node('C',  -L,  0,  'M'),
      node('D',   0, -L,  'M'),
    ];
    const links = [
      { source: 'Hub', target: 'A' },
      { source: 'Hub', target: 'B' },
      { source: 'Hub', target: 'C' },
      { source: 'Hub', target: 'D' },
    ];
    runSim(nodes, links, {}, 500);
    const hub    = nodes.find(n => n.id === 'Hub');
    const spokes = nodes.filter(n => n.id !== 'Hub');
    const c      = centroid(spokes);
    const hubDist        = dist(hub, c);
    const avgSpokeDist   = spokes.reduce((s, n) => s + dist(n, c), 0) / spokes.length;
    // Hub should be much closer to the group centroid than any spoke is
    expect(hubDist).toBeLessThan(avgSpokeDist * 0.5);
  });

  it('funnel [A,B,C,D]→sink: sink ends up near centroid of callers', () => {
    // e.g.  [serviceA, serviceB, serviceC, serviceD] all call logger()
    const nodes = [
      node('A',  L,  L,  'M'),
      node('B', -L,  L,  'M'),
      node('C', -L, -L,  'M'),
      node('D',  L, -L,  'M'),
      node('Z',  0,  0,  'M'),   // the shared sink
    ];
    const links = [
      { source: 'A', target: 'Z' },
      { source: 'B', target: 'Z' },
      { source: 'C', target: 'Z' },
      { source: 'D', target: 'Z' },
    ];
    runSim(nodes, links, {}, 500);
    const sink    = nodes.find(n => n.id === 'Z');
    const sources = nodes.filter(n => n.id !== 'Z');
    const c       = centroid(sources);
    expect(dist(sink, c)).toBeLessThan(L * 0.5);
  });

  it('two-chain separation: A→B→C and D→E→F remain two strands, not one ball', () => {
    // Two independent pipelines in the same scope.
    // Expect: each chain stays elongated, and the two chains stay apart.
    const nodes = [
      node('A', 0,     0,    'M'),
      node('B', L,     0,    'M'),
      node('C', 2 * L, 0,    'M'),
      node('D', 0,     2*L,  'M'),
      node('E', L,     2*L,  'M'),
      node('F', 2 * L, 2*L,  'M'),
    ];
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'D', target: 'E' },
      { source: 'E', target: 'F' },
    ];
    runSim(nodes, links, {}, 500);
    const chain1 = nodes.filter(n => ['A','B','C'].includes(n.id));
    const chain2 = nodes.filter(n => ['D','E','F'].includes(n.id));
    const c1 = centroid(chain1);
    const c2 = centroid(chain2);
    // Chains should be separated (charge pushes them apart)
    expect(dist(c1, c2)).toBeGreaterThan(L);
    // Each chain is still elongated
    expect(axisSpans(chain1).major / axisSpans(chain1).minor).toBeGreaterThan(1.5);
    expect(axisSpans(chain2).major / axisSpans(chain2).minor).toBeGreaterThan(1.5);
  });
});

// ── CURRENT: shapes survive a single outer blob ───────────────────────────────

describe('[CURRENT] Topology shapes survive outer blob (1-level nesting)', () => {

  it('pipeline elongation ratio > 2 inside one outer blob', () => {
    const nodes = [
      node('A', 0,     0, 'M'),
      node('B', L,     0, 'M'),
      node('C', 2 * L, 0, 'M'),
      node('D', 3 * L, 0, 'M'),
      node('E', 4 * L, 0, 'M'),
    ];
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'D', target: 'E' },
    ];
    // Two modules M and N, so Voronoi boundary exists at level 0
    const bystanders = [
      node('X', 0, -400, 'N'),
      node('Y', L, -400, 'N'),
    ];
    const allNodes = [...nodes, ...bystanders];
    const blob0 = makeNestedBlobForce(0, 2);
    runSim(allNodes, links, { groupCentroid: blob0 }, 500);

    const { major, minor } = axisSpans(nodes);
    expect(major / minor).toBeGreaterThan(2);
  });

  it('hub centrality preserved inside one outer blob', () => {
    const nodes = [
      node('Hub', 0,  0,  'M'),
      node('A',   L,  0,  'M'),
      node('B',   0,  L,  'M'),
      node('C',  -L,  0,  'M'),
      node('D',   0, -L,  'M'),
    ];
    const links = [
      { source: 'Hub', target: 'A' },
      { source: 'Hub', target: 'B' },
      { source: 'Hub', target: 'C' },
      { source: 'Hub', target: 'D' },
    ];
    const bystanders = [node('X', 0, -500, 'N'), node('Y', L, -500, 'N')];
    const allNodes   = [...nodes, ...bystanders];
    const blob0      = makeNestedBlobForce(0, 2);
    runSim(allNodes, links, { groupCentroid: blob0 }, 500);

    const hub         = allNodes.find(n => n.id === 'Hub');
    const spokes      = allNodes.filter(n => ['A','B','C','D'].includes(n.id));
    const c           = centroid(spokes);
    const hubDist     = dist(hub, c);
    const avgSpoke    = spokes.reduce((s, n) => s + dist(n, c), 0) / spokes.length;
    expect(hubDist).toBeLessThan(avgSpoke * 0.6); // slightly relaxed vs pure topology
  });
});

// ── CURRENT: shapes RECOVER from compressed starts ───────────────────────────
// These simulate what actually happens in the browser: nodes start piled at the
// centroid (or with tiny jitter) and must find their shape through simulation.
// If these fail, the visual result will be cramped even when physics is "correct".

describe('[CURRENT] Shapes recover from compressed initial positions', () => {

  it('pipeline recovers to elongated form when all nodes start at origin', () => {
    // Worst case: all nodes start exactly at (0,0). The simulation must spread them.
    const nodes = [
      node('A', 0, 0, 'M'),
      node('B', 0, 0, 'M'),
      node('C', 0, 0, 'M'),
      node('D', 0, 0, 'M'),
      node('E', 0, 0, 'M'),
    ];
    // Add tiny random jitter so D3 doesn't divide by zero
    for (const n of nodes) { n.x += (Math.random() - 0.5) * 2; n.y += (Math.random() - 0.5) * 2; }
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'D', target: 'E' },
    ];
    runSim(nodes, links, {}, 800);
    const { major, minor } = axisSpans(nodes);
    expect(major / minor).toBeGreaterThan(2);
    expect(major).toBeGreaterThan(2 * L);
  });

  it('pipeline recovers inside outer blob when all nodes start at centroid', () => {
    // All nodes start at (0,0); bystander module "N" is at (-400, 0).
    const nodes = [
      node('A', 0, 0, 'M'), node('B', 0, 0, 'M'), node('C', 0, 0, 'M'),
      node('D', 0, 0, 'M'), node('E', 0, 0, 'M'),
    ];
    for (const n of nodes) { n.x += (Math.random()-0.5)*2; n.y += (Math.random()-0.5)*2; }
    const bystanders = [node('X', -400, 0, 'N'), node('Y', -400, L, 'N')];
    const allNodes = [...nodes, ...bystanders];
    const links = [
      { source: 'A', target: 'B' }, { source: 'B', target: 'C' },
      { source: 'C', target: 'D' }, { source: 'D', target: 'E' },
    ];
    const blob0 = makeNestedBlobForce(0, 2);
    runSim(allNodes, links, { groupCentroid: blob0 }, 800);
    const { major, minor } = axisSpans(nodes);
    expect(major / minor).toBeGreaterThan(2);
    expect(major).toBeGreaterThan(2 * L);
  });

});

// ── FIX: shapes survive 2-level nested blobs ─────────────────────────────────
// These tests are EXPECTED TO FAIL with the current physics.
// They document the goal: inner class blobs should not crush call-graph shapes.

describe('[FIX] Topology shapes survive nested blobs (2-level nesting)', () => {

  /**
   * Module M, two classes:
   *   class X — pipeline: A → B → C → D
   *   class Y — hub:      H → [P, Q, R]
   *
   * The Voronoi boundary between X and Y compresses both inner blobs.
   * X's pipeline should still look like a pipeline (not a ball).
   */
  it('[FIX] pipeline in inner class blob is still elongated (major/minor > 2)', () => {
    // Start all nodes compressed near their class centroids — simulating what
    // the browser does when jitter is small relative to the desired topology size.
    const nodes = [
      // Class X pipeline — all crammed near (0, -L)
      node('A', (Math.random()-0.5)*10,     -L+(Math.random()-0.5)*10, 'M', 'X'),
      node('B', (Math.random()-0.5)*10,     -L+(Math.random()-0.5)*10, 'M', 'X'),
      node('C', (Math.random()-0.5)*10,     -L+(Math.random()-0.5)*10, 'M', 'X'),
      node('D', (Math.random()-0.5)*10,     -L+(Math.random()-0.5)*10, 'M', 'X'),
      // Class Y hub — all crammed near (0, L)
      node('H', (Math.random()-0.5)*10,      L+(Math.random()-0.5)*10, 'M', 'Y'),
      node('P', (Math.random()-0.5)*10,      L+(Math.random()-0.5)*10, 'M', 'Y'),
      node('Q', (Math.random()-0.5)*10,      L+(Math.random()-0.5)*10, 'M', 'Y'),
      node('R', (Math.random()-0.5)*10,      L+(Math.random()-0.5)*10, 'M', 'Y'),
    ];
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'H', target: 'P' },
      { source: 'H', target: 'Q' },
      { source: 'H', target: 'R' },
    ];
    const blob0 = makeNestedBlobForce(0, 1); // single outer blob — no inter-module boundary
    const blob1 = makeNestedBlobForce(1, 2); // two inner class blobs
    runSim(nodes, links, { groupCentroid: blob0, groupCentroid_1: blob1 }, 700);

    const pipeline = nodes.filter(n => ['A','B','C','D'].includes(n.id));
    const { major, minor } = axisSpans(pipeline);
    // Pipeline must still look like a line, not a cluster
    expect(major / minor).toBeGreaterThan(2);
    // And the pipeline must span a meaningful distance — not squashed to a point
    expect(major).toBeGreaterThan(1.5 * L);
  });

  it('[FIX] hub centrality preserved inside inner class blob', () => {
    const rnd = () => (Math.random()-0.5)*10;
    const nodes = [
      node('A', rnd(), -L+rnd(), 'M', 'X'),
      node('B', rnd(), -L+rnd(), 'M', 'X'),
      node('C', rnd(), -L+rnd(), 'M', 'X'),
      node('D', rnd(), -L+rnd(), 'M', 'X'),
      node('H', rnd(),  L+rnd(), 'M', 'Y'),
      node('P', rnd(),  L+rnd(), 'M', 'Y'),
      node('Q', rnd(),  L+rnd(), 'M', 'Y'),
      node('R', rnd(),  L+rnd(), 'M', 'Y'),
    ];
    const links = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'H', target: 'P' },
      { source: 'H', target: 'Q' },
      { source: 'H', target: 'R' },
    ];
    const blob0 = makeNestedBlobForce(0, 1);
    const blob1 = makeNestedBlobForce(1, 2);
    runSim(nodes, links, { groupCentroid: blob0, groupCentroid_1: blob1 }, 700);

    const hub    = nodes.find(n => n.id === 'H');
    const spokes = nodes.filter(n => ['P','Q','R'].includes(n.id));
    const c      = centroid(spokes);
    const hubDist    = dist(hub, c);
    const avgSpoke   = spokes.reduce((s, n) => s + dist(n, c), 0) / spokes.length;
    expect(hubDist).toBeLessThan(avgSpoke * 0.6);
  });

  it('[FIX] two independent chains in the same inner class stay as two strands', () => {
    // Both chains start crammed near class centroid (0,0).
    const rnd = () => (Math.random()-0.5)*10;
    const nodes = [
      node('A1', rnd(), rnd(), 'M', 'X'),
      node('B1', rnd(), rnd(), 'M', 'X'),
      node('C1', rnd(), rnd(), 'M', 'X'),
      node('A2', rnd(), rnd(), 'M', 'X'),
      node('B2', rnd(), rnd(), 'M', 'X'),
      node('C2', rnd(), rnd(), 'M', 'X'),
      // Filler class Y so level-1 boundary exists
      node('Y1', rnd(), -L*3+rnd(), 'M', 'Y'),
      node('Y2', rnd(), -L*3+rnd(), 'M', 'Y'),
      node('Y3', rnd(), -L*3+rnd(), 'M', 'Y'),
    ];
    const links = [
      { source: 'A1', target: 'B1' },
      { source: 'B1', target: 'C1' },
      { source: 'A2', target: 'B2' },
      { source: 'B2', target: 'C2' },
      { source: 'Y1', target: 'Y2' },
    ];
    const blob0 = makeNestedBlobForce(0, 1);
    const blob1 = makeNestedBlobForce(1, 2);
    runSim(nodes, links, { groupCentroid: blob0, groupCentroid_1: blob1 }, 700);

    const chain1 = nodes.filter(n => ['A1','B1','C1'].includes(n.id));
    const chain2 = nodes.filter(n => ['A2','B2','C2'].includes(n.id));
    // Each chain should still be elongated
    expect(axisSpans(chain1).major / axisSpans(chain1).minor).toBeGreaterThan(1.5);
    expect(axisSpans(chain2).major / axisSpans(chain2).minor).toBeGreaterThan(1.5);
    // Centroid separation: the two chains should remain identifiably separate
    expect(dist(centroid(chain1), centroid(chain2))).toBeGreaterThan(L * 0.5);
  });

  it('[FIX] multi-module scenario: pipeline in M1 not crushed by M2 boundary', () => {
    // Two modules M1 (at ~origin) and M2 (at ~-L*4 below).
    // M1 has inner classes X (pipeline A→B→C→D) and Y (filler).
    // All M1 nodes start crammed near (0,0); M2 nodes start near (0,-L*3).
    const rnd = () => (Math.random()-0.5)*15;
    const nodes = [
      node('A',   rnd(),       rnd(),       'M1', 'X'),
      node('B',   rnd(),       rnd(),       'M1', 'X'),
      node('C',   rnd(),       rnd(),       'M1', 'X'),
      node('D',   rnd(),       rnd(),       'M1', 'X'),
      node('Y1',  rnd(),       rnd(),       'M1', 'Y'),
      node('Y2',  rnd(),       rnd(),       'M1', 'Y'),
      node('M2a', rnd(), -L*3+rnd(), 'M2', 'Z'),
      node('M2b', rnd(), -L*3+rnd(), 'M2', 'Z'),
      node('M2c', rnd(), -L*3+rnd(), 'M2', 'Z'),
    ];
    const links = [
      { source: 'A',  target: 'B'  },
      { source: 'B',  target: 'C'  },
      { source: 'C',  target: 'D'  },
      { source: 'Y1', target: 'Y2' },
      { source: 'M2a',target: 'M2b'},
    ];
    const blob0 = makeNestedBlobForce(0, 2); // outer: M1 vs M2
    const blob1 = makeNestedBlobForce(1, 2); // inner: X vs Y within M1
    runSim(nodes, links, { groupCentroid: blob0, groupCentroid_1: blob1 }, 700);

    const pipeline = nodes.filter(n => ['A','B','C','D'].includes(n.id));
    const { major, minor } = axisSpans(pipeline);
    expect(major / minor).toBeGreaterThan(2);
    expect(major).toBeGreaterThan(1.5 * L);
  });
});
