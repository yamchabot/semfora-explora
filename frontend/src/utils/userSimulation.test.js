/**
 * userSimulation.test.js
 *
 * Constraint satisfaction tests for user archetypes.
 *
 * Each test simulates a layout scenario, computes all facts, then checks
 * whether each user type can accomplish their goal.
 *
 * Failure output is intentionally rich — not "assertion failed" but a
 * complete breakdown of which constraints failed, by how much, and why.
 */

import { describe, it, expect } from 'vitest';
import { forceSimulation, forceLink, forceManyBody } from 'd3-force-3d';
import { makeNestedBlobForce } from '../components/GraphRenderer';
import { computeFacts } from './layoutMetrics';
import { checkUser, checkAllUsers, formatResult, USERS } from './userSimulation';

// ── Simulation helpers ────────────────────────────────────────────────────────

const L = 120;

function node(id, x, y, group = 'M', innerGroup = null, val = 6) {
  const groupPath = innerGroup ? [group, innerGroup] : [group];
  return { id, x, y, vx: 0, vy: 0, group, groupPath, val };
}

function makeCollide(radiusFn) {
  let _nodes = [];
  function force() {
    for (let i = 0; i < _nodes.length; i++) {
      for (let j = i + 1; j < _nodes.length; j++) {
        const a = _nodes[i], b = _nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const r = radiusFn(a) + radiusFn(b);
        if (d < r) {
          const push = (r - d) / d * 0.5;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }
  force.initialize = ns => { _nodes = ns; };
  return force;
}

function simulate(nodes, links, { blobMode = false, ticks = 600, extraForces = {} } = {}) {
  const ngm = new Map(nodes.map(n => [n.id, n.group]));
  const sim = forceSimulation(nodes)
    .force('link', forceLink(links).id(n => n.id).distance(L).strength(l => {
      if (!blobMode) return 0.5;
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return ngm.get(s) !== ngm.get(t) ? 0.02 : 0.4;
    }))
    .force('charge',  forceManyBody().strength(blobMode ? -30 : -120))
    .force('collide', makeCollide(n => (n.val ?? 6) + 15))
    .stop();
  for (const [k, f] of Object.entries(extraForces)) sim.force(k, f);
  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

/**
 * Assert a user is satisfied. On failure, print the full diagnostic —
 * not just which constraint failed but all the context.
 */
function assertUserSatisfied(result) {
  if (!result.satisfied) {
    // This message appears in the test output, making failures self-explaining
    throw new Error('\n' + formatResult(result) + '\n');
  }
}

/**
 * Assert a user is NOT satisfied (documenting known failures).
 * Prints which constraints failed so we know what to fix.
 */
function assertUserUnsatisfied(result, reason = '') {
  if (result.satisfied) {
    throw new Error(`Expected ${result.userName} to be unsatisfied${reason ? ': ' + reason : ''}, but all constraints passed`);
  }
  // Print the failure details as informational output
  console.log('\n[KNOWN FAILURE] ' + formatResult(result));
}

// ═════════════════════════════════════════════════════════════════════════════
// LAYOUT SCENARIO: Well-separated 3-module cluster (good layout)
// Should satisfy: Quick Glancer, Architecture Reviewer, New Contributor
// ═════════════════════════════════════════════════════════════════════════════

describe('Good layout: 3 well-separated modules', () => {
  function makeGoodLayout() {
    const nodes = [
      // Module A — hub pattern, varied sizes
      node('A_hub', -300,  0, 'A', null, 18), node('A1', -420, 80, 'A', null, 8),
      node('A2',    -420, -80, 'A', null, 6), node('A3', -180, 80, 'A', null, 12),
      node('A4',    -180, -80, 'A', null, 4),
      // Module B — pipeline, varied sizes
      node('B1',   -60,  0,  'B', null, 14), node('B2',  60,  0, 'B', null, 10),
      node('B3',   180,  0,  'B', null, 8),  node('B4', 300,  0, 'B', null, 6),
      node('B5',   420,  0,  'B', null, 4),
      // Module C — star, varied sizes
      node('C_hub', 0,  300, 'C', null, 16), node('C1', 120, 380, 'C', null, 7),
      node('C2',  -120, 380, 'C', null, 7),  node('C3',  0, 460,  'C', null, 9),
      node('C4',   120, 220, 'C', null, 5),
    ];
    const links = [
      // A: hub-and-spoke
      ...['A1','A2','A3','A4'].map(id => ({ source: 'A_hub', target: id })),
      // B: pipeline
      { source: 'B1', target: 'B2' }, { source: 'B2', target: 'B3' },
      { source: 'B3', target: 'B4' }, { source: 'B4', target: 'B5' },
      // C: star
      ...['C1','C2','C3','C4'].map(id => ({ source: 'C_hub', target: id })),
      // Cross-module
      { source: 'A_hub', target: 'B1' }, { source: 'B5', target: 'C_hub' },
    ];
    return { nodes, links };
  }

  let facts;
  function getGoodFacts() {
    if (facts) return facts;
    const { nodes, links } = makeGoodLayout();
    const blob0 = makeNestedBlobForce(0, 3);
    simulate(nodes, links, { blobMode: true, ticks: 700, extraForces: { groupCentroid: blob0 } });
    facts = computeFacts(nodes, links);
    return facts;
  }

  it('Quick Glancer — can read module structure at a glance', () => {
    const result = checkUser(USERS.quickGlancer, getGoodFacts());
    console.log('\n' + formatResult(result));
    assertUserSatisfied(result);
  });

  it('Architecture Reviewer — can read inter-module dependencies', () => {
    const result = checkUser(USERS.architectureReviewer, getGoodFacts());
    console.log('\n' + formatResult(result));
    assertUserSatisfied(result);
  });

  it('New Contributor — can orient in the codebase', () => {
    const result = checkUser(USERS.newContributor, getGoodFacts());
    console.log('\n' + formatResult(result));
    assertUserSatisfied(result);
  });

  it('Complexity Auditor — can identify prominent nodes', () => {
    const result = checkUser(USERS.complexityAuditor, getGoodFacts());
    console.log('\n' + formatResult(result));
    assertUserSatisfied(result);
  });

  it('all users summary table', () => {
    const summary = checkAllUsers(getGoodFacts());
    console.log('\nAll users — good layout:');
    console.table(summary.map(r => ({
      user:      r.userName,
      satisfied: r.satisfied ? '✅' : '❌',
      score:     `${Math.round(r.score * 100)}%`,
      failures:  r.failCount,
      topIssue:  r.topFailure ?? '—',
    })));
    // At least 3 of 5 users satisfied on a good layout
    const satisfied = summary.filter(r => r.satisfied).length;
    expect(satisfied).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LAYOUT SCENARIO: Compressed start — simulates the real browser experience
// Documents which users fail and exactly which constraints break
// ═════════════════════════════════════════════════════════════════════════════

describe('Compressed layout: nodes start near centroid (real browser)', () => {
  function makeCompressedLayout() {
    const nodes = [
      node('A_hub', 5, 3, 'A', null, 18), node('A1', -2, 7, 'A', null, 8),
      node('A2', 3, -4, 'A', null, 6),    node('A3', -5, 1, 'A', null, 12),
      node('A4', 1, -2, 'A', null, 4),
      node('B1', 8, 2, 'B', null, 14),    node('B2', -3, 5, 'B', null, 10),
      node('B3', 4, -1, 'B', null, 8),    node('B4', -1, 3, 'B', null, 6),
      node('B5', 2, -5, 'B', null, 4),
      node('C_hub', -4, 6, 'C', null, 16), node('C1', 6, -3, 'C', null, 7),
      node('C2', -2, 4, 'C', null, 7),     node('C3', 3, 1, 'C', null, 9),
      node('C4', -6, -2, 'C', null, 5),
    ];
    const links = [
      ...['A1','A2','A3','A4'].map(id => ({ source: 'A_hub', target: id })),
      { source: 'B1', target: 'B2' }, { source: 'B2', target: 'B3' },
      { source: 'B3', target: 'B4' }, { source: 'B4', target: 'B5' },
      ...['C1','C2','C3','C4'].map(id => ({ source: 'C_hub', target: id })),
      { source: 'A_hub', target: 'B1' }, { source: 'B5', target: 'C_hub' },
    ];
    return { nodes, links };
  }

  let facts;
  function getCompressedFacts() {
    if (facts) return facts;
    const { nodes, links } = makeCompressedLayout();
    const blob0 = makeNestedBlobForce(0, 3);
    simulate(nodes, links, { blobMode: true, ticks: 700, extraForces: { groupCentroid: blob0 } });
    facts = computeFacts(nodes, links);
    return facts;
  }

  it('all users summary — documents which users fail and which constraints break', () => {
    const f = getCompressedFacts();
    const summary = checkAllUsers(f);

    console.log('\nAll users — compressed layout:');
    console.table(summary.map(r => ({
      user:      r.userName,
      satisfied: r.satisfied ? '✅' : '❌',
      score:     `${Math.round(r.score * 100)}%`,
      failures:  r.failCount,
      topIssue:  r.topFailure ?? '—',
    })));

    for (const r of summary.filter(r => !r.satisfied)) {
      const full = checkUser(USERS[r.userId.replace(/_([a-z])/g, (_, c) => c.toUpperCase())], f);
      console.log('\n' + formatResult(full));
    }

    // Floor: at least edge visibility and no overlap should hold
    expect(f.edgeVisibility.ratio).toBeGreaterThan(0.3);
  });

  it('[KNOWN FAILURE] Debug Tracer — compressed layout breaks chain shapes', () => {
    const result = checkUser(USERS.debugTracer, getCompressedFacts());
    // This documents the known gap — see chainLinearity and hubCentrality failures
    console.log('\n' + formatResult(result));
    // We don't assert satisfied — this IS the known failure we're trying to fix
    expect(result.failures.length).toBeGreaterThan(0);
    // But the failure output tells us exactly what's broken
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LAYOUT SCENARIO: Completely broken — nodes overlapping, no separation
// All users should fail — tests that the constraint system catches bad layouts
// ═════════════════════════════════════════════════════════════════════════════

describe('Broken layout: all nodes piled at origin', () => {
  function makeBrokenFacts() {
    // All nodes at exactly the same position — worst possible layout
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`, 0, 0, i < 5 ? 'A' : 'B', null, 6 + i));
    const links = [
      { source: 'n0', target: 'n1' }, { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' }, { source: 'n5', target: 'n6' },
    ];
    // Don't simulate — keep nodes at origin
    return computeFacts(nodes, links);
  }

  it('Quick Glancer fails on broken layout', () => {
    const result = checkUser(USERS.quickGlancer, makeBrokenFacts());
    expect(result.satisfied).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    console.log('\n' + formatResult(result));
  });

  it('every user fails on completely broken layout', () => {
    const facts   = makeBrokenFacts();
    const summary = checkAllUsers(facts);
    const anyPass = summary.some(r => r.satisfied);
    expect(anyPass).toBe(false);
    console.log('\nBroken layout — all users unsatisfied:');
    console.table(summary.map(r => ({
      user: r.userName, score: `${Math.round(r.score * 100)}%`, topIssue: r.topFailure,
    })));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONSTRAINT SYSTEM UNIT TESTS
// Tests of the constraint engine itself — correctness, gap calculation,
// near-miss detection, failure ordering
// ═════════════════════════════════════════════════════════════════════════════

describe('Constraint engine', () => {
  const mockFacts = {
    blobSeparation:            { minClearance: 60 },
    nodeOverlap:               { ratio: 0 },
    gestaltProximity:          { cohesion: 0.7 },
    blobIntegrity:             { ratio: 0.98 },
    edgeVisibility:            { ratio: 0.92 },
    crossModuleEdgeVisibility: { ratio: 0.8 },
    edgeCrossings:             { normalised: 0.1 },
    chainLinearity:            { ratio: 2.5 },
    hubCentrality:             { avgNormalised: 0.2 },
    angularResolution:         { minAngle: 25 },
    prominentNodeVisibility:   { ratio: 0.9 },
    nodeSizeVariation:         { cv: 0.45 },
    layoutStress:              { perEdge: 0.8 },
  };

  it('satisfied when all constraints pass', () => {
    const result = checkUser(USERS.quickGlancer, mockFacts);
    expect(result.satisfied).toBe(true);
    expect(result.score).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('unsatisfied when one constraint fails', () => {
    const badFacts = { ...mockFacts, blobSeparation: { minClearance: 10 } };
    const result   = checkUser(USERS.quickGlancer, badFacts);
    expect(result.satisfied).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].constraint.name).toBe('blobs_not_touching');
  });

  it('gap is negative when failing a > constraint', () => {
    const badFacts = { ...mockFacts, blobSeparation: { minClearance: 10 } };
    const result   = checkUser(USERS.quickGlancer, badFacts);
    const f        = result.failures[0];
    expect(f.gap).toBeLessThan(0);           // 10 - 20 = -10
    expect(f.gapFraction).toBeLessThan(0);   // -50%
  });

  it('near-miss detected when within 10% of threshold', () => {
    // blobSeparation.minClearance threshold is 20; value 21 is just above
    const nearFacts = { ...mockFacts, blobSeparation: { minClearance: 21 } };
    const result    = checkUser(USERS.quickGlancer, nearFacts);
    expect(result.satisfied).toBe(true);
    expect(result.nearMisses.length).toBeGreaterThanOrEqual(1);
    expect(result.nearMisses[0].constraint.name).toBe('blobs_not_touching');
  });

  it('failures sorted: critical before major before minor', () => {
    const badFacts = {
      ...mockFacts,
      blobSeparation:   { minClearance: 10 },   // critical
      gestaltProximity: { cohesion: 0.1 },       // major
    };
    const result = checkUser(USERS.quickGlancer, badFacts);
    expect(result.failures[0].severity).toBe('critical');
    expect(result.failures[1].severity).toBe('major');
  });

  it('~0 operator catches non-zero overlap', () => {
    const badFacts = { ...mockFacts, nodeOverlap: { ratio: 0.05 } };
    const result   = checkUser(USERS.quickGlancer, badFacts);
    const overlap  = result.failures.find(f => f.constraint.name === 'nodes_dont_obscure_each_other');
    expect(overlap).toBeDefined();
  });

  it('formatResult includes all failed constraint names', () => {
    const badFacts = {
      ...mockFacts,
      blobSeparation:   { minClearance: 5 },
      gestaltProximity: { cohesion: 0.1 },
    };
    const result = checkUser(USERS.quickGlancer, badFacts);
    const text   = formatResult(result);
    expect(text).toContain('blobs_not_touching');
    expect(text).toContain('blobs_are_cohesive_groups');
    expect(text).toContain('❌ NO');
  });

  it('checkAllUsers returns one entry per user type', () => {
    const summary = checkAllUsers(mockFacts);
    expect(summary).toHaveLength(Object.keys(USERS).length);
    expect(summary.map(r => r.userId)).toContain('debug_tracer');
  });

  it('score reflects fraction of constraints passing', () => {
    // Quick Glancer has 4 constraints; break 1 → score should be 3/4 = 0.75
    const badFacts = { ...mockFacts, blobSeparation: { minClearance: 5 } };
    const result   = checkUser(USERS.quickGlancer, badFacts);
    expect(result.score).toBeCloseTo(0.75, 5);
  });
});
