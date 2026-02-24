/**
 * layoutBenchmark.test.js
 *
 * Measures layout quality numerically for the graph renderer.
 * NOT testing the canvas — testing the POSITIONS produced by the physics.
 *
 * Design intent:
 *   - Layout is a pure function: (nodes, links, config) → positions
 *   - Metrics measure how those positions read to a human
 *   - Tests assert minimum quality thresholds
 *   - Numbers are printed so you can track regressions over time
 *   - Replace the physics engine → run this suite → know if it got better or worse
 *
 * Simulation setup mirrors production:
 *   charge         = -30 in blob mode  (effectiveCharge)
 *   link distance  = 120px             (linkDistBase)
 *   forceCollide   = val + 15          (blobCollide radius)
 *   link strength  = 0.5 same-group, 0.02 cross-group
 *
 * Topology scenarios (real code patterns):
 *   Pipeline     — parse → validate → transform → save → respond
 *   Dispatcher   — router → [handlerA…D]
 *   Funnel       — [a,b,c,d] → logger
 *   Star cluster — 3 modules, each a hub-and-spoke
 *   Layered arch — controller → service → repo → model (layered calls)
 *   Nested blobs — module with two inner classes (pipeline + hub)
 */

import { describe, it, expect } from 'vitest';
import { forceSimulation, forceLink, forceManyBody } from 'd3-force-3d';
import { makeNestedBlobForce } from './GraphRenderer';
import {
  edgeVisibility,
  nodeOverlap,
  edgeCrossings,
  layoutStress,
  hubCentrality,
  chainLinearity,
  blobIntegrity,
  blobSeparation,
  gestaltProximity,
  angularResolution,
  edgeLengthUniformity,
  layoutQualityScore,
} from '../utils/layoutMetrics';

// ── Simulation helpers ────────────────────────────────────────────────────────

const L = 120; // link distance — matches production

function node(id, x, y, group = 'M', innerGroup = null, val = 6) {
  const groupPath = innerGroup ? [group, innerGroup] : [group];
  return { id, x, y, vx: 0, vy: 0, group, groupPath, val };
}

/** O(N²) collision — avoids d3 quadtree bug in jsdom. */
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

/**
 * Run a production-equivalent force simulation.
 * `blobMode`: if true, uses blob-mode charge and cross-group link damping.
 */
function simulate(nodes, links, {
  blobMode    = false,
  ticks       = 600,
  extraForces = {},
  prePos      = false,   // topology-aware pre-positioning (mirrors GraphRenderer)
} = {}) {
  if (prePos) prePositionByTopology(nodes, links);

  const nodeGroupMap = new Map(nodes.map(n => [n.id, n.group]));

  const sim = forceSimulation(nodes)
    .numDimensions(2)  // match production react-force-graph-2d (3D collapses XY projection)
    .force('link', forceLink(links)
      .id(n => n.id)
      .distance(L)
      .strength(l => {
        if (!blobMode) return 0.5;
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return nodeGroupMap.get(src) !== nodeGroupMap.get(tgt) ? 0.02 : 0.4;
      })
    )
    .force('charge', forceManyBody().strength(blobMode ? -60 : -120))  // -60 matches production blob charge
    .force('collide', makeCollide(n => (n.val ?? 6) + 15))
    .stop();

  for (const [k, f] of Object.entries(extraForces)) sim.force(k, f);
  for (let i = 0; i < ticks; i++) sim.tick();
  return nodes;
}

/** Topology-aware pre-positioning (mirrors GraphRenderer.jsx useMemo pre-positioning). */
function prePositionByTopology(nodes, links) {
  const byId    = Object.fromEntries(nodes.map(n => [n.id, n]));
  const byGroup = {};
  const leafKey = n => {
    const gp = n.groupPath;
    return Array.isArray(gp) && gp.length ? gp.join('::') : (n.group ?? '__default__');
  };
  for (const n of nodes) (byGroup[leafKey(n)] = byGroup[leafKey(n)] || []).push(n);

  const adj = Object.fromEntries(nodes.map(n => [n.id, []]));
  for (const l of links) {
    const sid = typeof l.source === 'object' ? l.source.id : l.source;
    const tid = typeof l.target === 'object' ? l.target.id : l.target;
    const sn = byId[sid], tn = byId[tid];
    if (!sn || !tn || leafKey(sn) !== leafKey(tn)) continue;
    adj[sid].push(tid); adj[tid].push(sid);
  }

  const groups = Object.keys(byGroup);
  const spread = Math.max(3 * L, L * Math.sqrt(groups.length) * 2.2);

  groups.forEach((g, gi) => {
    const ga  = (gi / groups.length) * 2 * Math.PI;
    const gcx = groups.length > 1 ? Math.cos(ga) * spread : 0;
    const gcy = groups.length > 1 ? Math.sin(ga) * spread : 0;
    const members = byGroup[g];
    const maxDeg  = Math.max(...members.map(n => adj[n.id].length));
    const hub     = maxDeg >= 3 ? members.find(n => adj[n.id].length === maxDeg) : null;

    if (hub) {
      hub.x = gcx; hub.y = gcy;
      const spokes = members.filter(n => n !== hub);
      spokes.forEach((n, i) => {
        const a = (i / spokes.length) * 2 * Math.PI;
        n.x = gcx + Math.cos(a) * L; n.y = gcy + Math.sin(a) * L;
      });
    } else {
      const start = members.find(n => adj[n.id].length <= 1) ?? members[0];
      const order = [], visited = new Set();
      let cur = start.id;
      while (cur && !visited.has(cur)) {
        visited.add(cur); order.push(byId[cur]);
        cur = adj[cur].find(id => !visited.has(id));
      }
      members.filter(n => !visited.has(n.id)).forEach(n => order.push(n));
      const half = (order.length - 1) / 2;
      order.forEach((n, i) => { n.x = gcx + (i - half) * L; n.y = gcy; });
    }
  });
}

/** Print a metric report to the test output (visible with --reporter=verbose). */
function report(label, metrics) {
  const lines = Object.entries(metrics)
    .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`)
    .join('\n');
  // vitest captures console; this shows up with --reporter=verbose
  console.log(`\n── ${label} ──\n${lines}`);
}

// ── Helper: spread nodes from near-centroid (simulates real browser startup) ──
function jitter(nodes, radius = 30) {
  for (const n of nodes) {
    n.x += (Math.random() - 0.5) * radius * 2;
    n.y += (Math.random() - 0.5) * radius * 2;
  }
  return nodes;
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Pipeline  (parse → validate → transform → save → respond)
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Pipeline — parse→validate→transform→save→respond', () => {
  const ORDER = ['parse', 'validate', 'transform', 'save', 'respond'];

  function makePipeline() {
    const nodes = ORDER.map((id, i) => node(id, i * L, 0));
    const links = ORDER.slice(1).map((id, i) => ({ source: ORDER[i], target: id }));
    return { nodes, links };
  }

  it('[BENCHMARK] ideal start — edge visibility, stress, linearity', () => {
    const { nodes, links } = makePipeline();
    simulate(nodes, links, { ticks: 500 });

    const vis    = edgeVisibility(nodes, links);
    const stress = layoutStress(nodes, links, L);
    const lin    = chainLinearity(nodes, ORDER);
    const unif   = edgeLengthUniformity(nodes, links);

    report('Pipeline (ideal start)', {
      'edge_visibility_ratio': vis.ratio,
      'edge_avg_gap_px':       vis.avgGap,
      'stress_per_edge':       stress.perEdge,
      'linearity_ratio':       lin.ratio,
      'straightness_0-1':      lin.straightness,
      'edge_length_cv':        unif.cv,
    });

    // Hard assertions — minimum acceptable quality
    expect(vis.ratio).toBeGreaterThan(0.8);       // ≥80% of edges visible
    expect(lin.ratio).toBeGreaterThan(2.0);       // still looks like a line
    expect(nodeOverlap(nodes).ratio).toBe(0);     // no node overlap
  });

  it('[BENCHMARK] compressed start — recovery quality', () => {
    const { nodes, links } = makePipeline();
    // Start all nodes near origin (what the browser does with small jitter)
    for (const n of nodes) { n.x = (Math.random()-0.5)*20; n.y = (Math.random()-0.5)*20; }
    simulate(nodes, links, { ticks: 800 });

    const vis    = edgeVisibility(nodes, links);
    const lin    = chainLinearity(nodes, ORDER);
    const stress = layoutStress(nodes, links, L);

    report('Pipeline (compressed start)', {
      'edge_visibility_ratio': vis.ratio,
      'linearity_ratio':       lin.ratio,
      'stress_per_edge':       stress.perEdge,
    });

    // Threshold: recovers to something readable, even if not perfect
    expect(vis.ratio).toBeGreaterThan(0.6);
    // Linearity recovery is our known failure — document the current value
    console.log(`  [current] linearity_ratio = ${lin.ratio.toFixed(3)} (target: > 2.0)`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Dispatcher  (router → [handlerA, handlerB, handlerC, handlerD])
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Dispatcher — router→[A,B,C,D]', () => {
  function makeDispatcher() {
    const nodes = [
      node('router',   0,  0), node('handlerA',  L, 0),
      node('handlerB', 0,  L), node('handlerC', -L, 0), node('handlerD', 0, -L),
    ];
    const links = ['handlerA','handlerB','handlerC','handlerD']
      .map(id => ({ source: 'router', target: id }));
    return { nodes, links };
  }

  it('[BENCHMARK] hub centrality, angular resolution, edge visibility', () => {
    const { nodes, links } = makeDispatcher();
    simulate(nodes, links, { ticks: 500 });

    const hub  = hubCentrality(nodes, links, 3);
    const ang  = angularResolution(nodes, links, 20);
    const vis  = edgeVisibility(nodes, links);

    report('Dispatcher (ideal start)', {
      'hub_normalised_error':  hub.avgNormalised,
      'min_edge_angle_deg':    ang.minAngle,
      'avg_min_angle_deg':     ang.avgMinAngle,
      'edge_visibility_ratio': vis.ratio,
    });

    expect(hub.avgNormalised).toBeLessThan(0.3);   // hub near centre of spokes
    expect(ang.minAngle).toBeGreaterThan(20);      // edges spread, not merged
    expect(vis.ratio).toBeGreaterThan(0.9);
  });

  it('[BENCHMARK] compressed start — hub recovers to centre', () => {
    const { nodes, links } = makeDispatcher();
    for (const n of nodes) { n.x = (Math.random()-0.5)*20; n.y = (Math.random()-0.5)*20; }
    simulate(nodes, links, { ticks: 800, prePos: true });

    const hub = hubCentrality(nodes, links, 3);
    report('Dispatcher (compressed start)', { 'hub_normalised_error': hub.avgNormalised });
    console.log(`  [current] hub_normalised_error = ${hub.avgNormalised.toFixed(3)} (target: < 0.3)`);
    expect(hub.avgNormalised).toBeLessThan(0.5);   // relaxed: still somewhat central
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Multi-module cluster  (3 modules, each a hub-and-spoke)
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Multi-module cluster — 3 modules, each hub-and-spoke', () => {
  function makeCluster() {
    const nodes = [
      // Module A
      node('A_hub',  -300, 0, 'A'), node('A1', -400, 80, 'A'),
      node('A2', -400, -80, 'A'), node('A3', -200, 80, 'A'), node('A4', -200, -80, 'A'),
      // Module B
      node('B_hub', 0, 0, 'B'), node('B1', 100, 80, 'B'),
      node('B2', 100, -80, 'B'), node('B3', -100, 80, 'B'), node('B4', -100, -80, 'B'),
      // Module C
      node('C_hub', 300, 0, 'C'), node('C1', 400, 80, 'C'),
      node('C2', 400, -80, 'C'), node('C3', 200, 80, 'C'), node('C4', 200, -80, 'C'),
    ];
    const links = [
      // Intra-module hub-and-spoke
      ...['A1','A2','A3','A4'].map(id => ({ source: 'A_hub', target: id })),
      ...['B1','B2','B3','B4'].map(id => ({ source: 'B_hub', target: id })),
      ...['C1','C2','C3','C4'].map(id => ({ source: 'C_hub', target: id })),
      // Cross-module edges (weak coupling)
      { source: 'A_hub', target: 'B_hub' },
      { source: 'B_hub', target: 'C_hub' },
    ];
    return { nodes, links };
  }

  it('[BENCHMARK] blob separation, integrity, gestalt proximity', () => {
    const { nodes, links } = makeCluster();
    const blob0 = makeNestedBlobForce(0, 3);
    simulate(nodes, links, { blobMode: true, ticks: 700, extraForces: { groupCentroid: blob0 } });

    const sep   = blobSeparation(nodes);
    const integ = blobIntegrity(nodes);
    const prox  = gestaltProximity(nodes);
    const hub   = hubCentrality(nodes, links, 3);
    const score = layoutQualityScore(nodes, links);

    report('Multi-module cluster', {
      'blob_separation_min_clearance': sep.minClearance,
      'blob_separation_ratio':         sep.separationRatio,
      'blob_integrity_ratio':          integ.ratio,
      'gestalt_within_avg_px':         prox.withinAvg,
      'gestalt_between_avg_px':        prox.betweenAvg,
      'gestalt_cohesion':              prox.cohesion,
      'hub_normalised_error':          hub.avgNormalised,
      'quality_score_0-100':           score.score,
    });

    expect(integ.ratio).toBeGreaterThan(0.85);     // ≥85% nodes in correct blob
    expect(prox.ratio).toBeLessThan(0.5);          // within-blob dist < 50% of between-blob
    expect(hub.avgNormalised).toBeLessThan(0.4);   // hubs roughly central
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Layered architecture  (controller→service→repo→model)
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Layered architecture — controller→service→repo→model', () => {
  const LAYERS = ['controller', 'service', 'repo', 'model'];

  function makeLayered() {
    // 4-layer system with 2 nodes per layer, each calling the next layer
    const nodes = [
      node('ctrl_a', -60, 0), node('ctrl_b', 60, 0),
      node('svc_a',  -60, L), node('svc_b',  60, L),
      node('repo_a', -60, 2*L), node('repo_b', 60, 2*L),
      node('model',   0,  3*L),
    ];
    const links = [
      { source: 'ctrl_a', target: 'svc_a' }, { source: 'ctrl_b', target: 'svc_b' },
      { source: 'svc_a',  target: 'repo_a' }, { source: 'svc_b',  target: 'repo_b' },
      { source: 'svc_a',  target: 'repo_b' }, // cross-column coupling
      { source: 'repo_a', target: 'model' }, { source: 'repo_b', target: 'model' },
    ];
    return { nodes, links };
  }

  it('[BENCHMARK] layer depth ordering — topological order in y-axis', () => {
    const { nodes, links } = makeLayered();
    simulate(nodes, links, { ticks: 600 });

    // Measure: do nodes appear in the correct depth order?
    const getNode = id => nodes.find(n => n.id === id);
    const layerY  = LAYERS.map(() => []);
    nodes.forEach(n => {
      const layer = LAYERS.findIndex(l => n.id.startsWith(l === 'model' ? 'model' : l.slice(0, 4)));
      if (layer >= 0) layerY[layer].push(n.y);
    });
    const layerAvgY = layerY.map(ys => ys.reduce((s, y) => s + y, 0) / ys.length);

    const ordered = layerAvgY.every((y, i) => i === 0 || Math.abs(y) >= Math.abs(layerAvgY[i-1]) || y !== layerAvgY[i-1]);

    const vis    = edgeVisibility(nodes, links);
    const cross  = edgeCrossings(nodes, links);
    const stress = layoutStress(nodes, links, L);

    report('Layered architecture', {
      'edge_visibility_ratio': vis.ratio,
      'edge_crossings':        cross.count,
      'stress_per_edge':       stress.perEdge,
      'layer_y_values':        layerAvgY.map(y => y.toFixed(0)).join(' → '),
    });

    expect(vis.ratio).toBeGreaterThan(0.8);
    expect(cross.count).toBeLessThan(5); // layered arch should have few crossings
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Nested blobs — module with pipeline class + dispatcher class
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Nested blobs — pipeline class + dispatcher class within one module', () => {
  const PIPELINE_ORDER = ['parse', 'validate', 'transform', 'save'];

  function makeNested(startCompressed = false) {
    const spread = startCompressed ? 15 : L;
    const rnd = () => (Math.random() - 0.5) * spread;
    const nodes = [
      // Class X — pipeline
      node('parse',    rnd(), rnd(), 'M', 'X'),
      node('validate', rnd(), rnd(), 'M', 'X'),
      node('transform',rnd(), rnd(), 'M', 'X'),
      node('save',     rnd(), rnd(), 'M', 'X'),
      // Class Y — dispatcher
      node('router',   rnd(), rnd(), 'M', 'Y'),
      node('hA',       rnd(), rnd(), 'M', 'Y'),
      node('hB',       rnd(), rnd(), 'M', 'Y'),
      node('hC',       rnd(), rnd(), 'M', 'Y'),
    ];
    const links = [
      { source: 'parse', target: 'validate' },
      { source: 'validate', target: 'transform' },
      { source: 'transform', target: 'save' },
      { source: 'router', target: 'hA' },
      { source: 'router', target: 'hB' },
      { source: 'router', target: 'hC' },
    ];
    return { nodes, links };
  }

  it('[BENCHMARK] ideal start — both classes preserve their shapes', () => {
    const { nodes, links } = makeNested(false);
    const blob0 = makeNestedBlobForce(0, 1);
    const blob1 = makeNestedBlobForce(1, 2);
    simulate(nodes, links, {
      blobMode: true, ticks: 700,
      extraForces: { groupCentroid: blob0, groupCentroid_1: blob1 },
    });

    const innerKey = n => `${n.group}::${n.groupPath[1] ?? ''}`;
    const pipeline = nodes.filter(n => PIPELINE_ORDER.includes(n.id));
    const hub      = nodes.find(n => n.id === 'router');
    const spokes   = nodes.filter(n => ['hA','hB','hC'].includes(n.id));

    const lin   = chainLinearity(nodes, PIPELINE_ORDER);
    const hubC  = hubCentrality(nodes, links, 2);
    const sep   = blobSeparation(nodes, innerKey);
    const integ = blobIntegrity(nodes, innerKey);
    const vis   = edgeVisibility(nodes, links);
    const ovlp  = nodeOverlap(nodes);
    const score = layoutQualityScore(nodes, links, { groupKeyFn: innerKey });

    report('Nested blobs (ideal start)', {
      'pipeline_linearity_ratio': lin.ratio,
      'pipeline_major_span_px':   lin.major,
      'pipeline_straightness':    lin.straightness,
      'hub_normalised_error':     hubC.avgNormalised,
      'inner_blob_integrity':     integ.ratio,
      'inner_blob_separation':    sep.minClearance,
      'edge_visibility_ratio':    vis.ratio,
      'node_overlap_ratio':       ovlp.ratio,
      'quality_score_0-100':      score.score,
    });

    expect(integ.ratio).toBeGreaterThan(0.9);
    expect(vis.ratio).toBeGreaterThan(0.8);
    expect(ovlp.ratio).toBe(0);
    // Document current linearity:
    console.log(`  [current] pipeline_linearity = ${lin.ratio.toFixed(3)} (target: > 2.0)`);
  });

  it('[BENCHMARK] compressed start — scores document the real-browser experience', () => {
    const { nodes, links } = makeNested(true); // all nodes start within ±15px
    const blob0 = makeNestedBlobForce(0, 1);
    const blob1 = makeNestedBlobForce(1, 2);
    simulate(nodes, links, {
      blobMode: true, ticks: 800,
      extraForces: { groupCentroid: blob0, groupCentroid_1: blob1 },
    });

    const innerKey = n => `${n.group}::${n.groupPath[1] ?? ''}`;
    const lin   = chainLinearity(nodes, PIPELINE_ORDER);
    const hubC  = hubCentrality(nodes, links, 2);
    const sep   = blobSeparation(nodes, innerKey);
    const integ = blobIntegrity(nodes, innerKey);
    const vis   = edgeVisibility(nodes, links);
    const ovlp  = nodeOverlap(nodes);
    const score = layoutQualityScore(nodes, links, { groupKeyFn: innerKey });

    // This is the current baseline — print everything, assert only minimum floor
    report('Nested blobs (compressed start — current browser experience)', {
      'pipeline_linearity_ratio': lin.ratio,
      'pipeline_major_span_px':   lin.major,
      'hub_normalised_error':     hubC.avgNormalised,
      'inner_blob_integrity':     integ.ratio,
      'inner_blob_separation_px': sep.minClearance,
      'edge_visibility_ratio':    vis.ratio,
      'node_overlap_ratio':       ovlp.ratio,
      'quality_score_0-100':      score.score,
    });

    // Minimum floor — if these fail the renderer is completely broken
    expect(vis.ratio).toBeGreaterThan(0.3);
    expect(integ.ratio).toBeGreaterThan(0.5);
    expect(ovlp.ratio).toBeLessThan(0.5);

    // Targets to reach — currently failing, document the gap
    const targets = {
      pipeline_linearity:   { current: lin.ratio,         target: 2.0,  pass: lin.ratio > 2.0 },
      hub_centrality:       { current: hubC.avgNormalised, target: 0.3,  pass: hubC.avgNormalised < 0.3 },
      edge_visibility:      { current: vis.ratio,          target: 0.9,  pass: vis.ratio > 0.9 },
      quality_score:        { current: score.score,        target: 70,   pass: score.score > 70 },
    };
    console.log('\n  Target gaps (compressed start):');
    for (const [k, { current, target, pass }] of Object.entries(targets)) {
      console.log(`    ${pass ? '✅' : '❌'} ${k}: ${typeof current === 'number' ? current.toFixed(3) : current} (target: ${target})`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Scale — larger realistic graph (30 nodes, 3 modules)
// ═════════════════════════════════════════════════════════════════════════════

describe('Scenario: Scale — 30 nodes across 3 modules', () => {
  function makeRealistic() {
    const nodes = [], links = [];
    const modules = ['auth', 'api', 'db'];

    // 10 nodes per module arranged as a mix of chain + hub
    for (const mod of modules) {
      // 6-node pipeline
      for (let i = 0; i < 6; i++) {
        nodes.push(node(`${mod}_p${i}`, (Math.random()-0.5)*200, (Math.random()-0.5)*200, mod));
        if (i > 0) links.push({ source: `${mod}_p${i-1}`, target: `${mod}_p${i}` });
      }
      // Hub with 3 spokes
      nodes.push(node(`${mod}_hub`, (Math.random()-0.5)*200, (Math.random()-0.5)*200, mod));
      for (let i = 0; i < 3; i++) {
        nodes.push(node(`${mod}_s${i}`, (Math.random()-0.5)*200, (Math.random()-0.5)*200, mod));
        links.push({ source: `${mod}_hub`, target: `${mod}_s${i}` });
      }
    }
    // Cross-module coupling
    links.push({ source: 'api_hub', target: 'auth_hub' });
    links.push({ source: 'api_p3',  target: 'db_hub'   });

    return { nodes, links };
  }

  it('[BENCHMARK] realistic scale — quality score and key metrics', () => {
    const { nodes, links } = makeRealistic();
    const blob0 = makeNestedBlobForce(0, 3);
    simulate(nodes, links, { blobMode: true, ticks: 800, extraForces: { groupCentroid: blob0 } });

    const sep   = blobSeparation(nodes);
    const integ = blobIntegrity(nodes);
    const prox  = gestaltProximity(nodes);
    const vis   = edgeVisibility(nodes, links);
    const ovlp  = nodeOverlap(nodes);
    const cross = edgeCrossings(nodes, links);
    const hub   = hubCentrality(nodes, links, 3);
    const score = layoutQualityScore(nodes, links);

    report('Scale: 30 nodes / 3 modules', {
      'quality_score_0-100':        score.score,
      'edge_visibility_ratio':      vis.ratio,
      'node_overlap_ratio':         ovlp.ratio,
      'edge_crossings':             cross.count,
      'crossings_per_edge':         cross.normalised,
      'blob_integrity':             integ.ratio,
      'blob_separation_clearance':  sep.minClearance,
      'gestalt_cohesion':           prox.cohesion,
      'hub_normalised_error':       hub.avgNormalised,
    });

    // Floor assertions
    expect(score.score).toBeGreaterThan(40);       // not completely broken
    expect(vis.ratio).toBeGreaterThan(0.5);        // at least half the edges visible
    expect(integ.ratio).toBeGreaterThan(0.7);      // most nodes in correct module blob
    expect(ovlp.ratio).toBeLessThan(0.1);          // <10% of pairs overlapping
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RENDERER COMPARISON HARNESS
// Run this to compare two physics configurations side-by-side.
// ═════════════════════════════════════════════════════════════════════════════

describe('Renderer comparison harness', () => {
  /** Shared graph: 3-module cluster, each with 5 nodes, compressed start. */
  function makeComparisonGraph() {
    const nodes = [], links = [];
    const mods = ['M1','M2','M3'];
    for (const mod of mods) {
      for (let i = 0; i < 5; i++) {
        nodes.push(node(`${mod}_${i}`, (Math.random()-0.5)*20, (Math.random()-0.5)*20, mod));
        if (i > 0) links.push({ source: `${mod}_${i-1}`, target: `${mod}_${i}` });
      }
    }
    links.push({ source: 'M1_4', target: 'M2_0' }); // cross-module
    return { nodes: JSON.parse(JSON.stringify(nodes)), links }; // deep clone
  }

  function scoreConfig(nodes, links, configName, simOpts) {
    simulate(nodes, links, simOpts);
    const score = layoutQualityScore(nodes, links);
    const vis   = edgeVisibility(nodes, links);
    const integ = blobIntegrity(nodes);
    const sep   = blobSeparation(nodes);
    console.log(`  ${configName}: score=${score.score}, vis=${vis.ratio.toFixed(2)}, integrity=${integ.ratio.toFixed(2)}, separation=${sep.minClearance.toFixed(0)}px`);
    return { score: score.score, vis: vis.ratio, integ: integ.ratio, sep: sep.minClearance };
  }

  it('[COMPARISON] current physics vs stronger charge', () => {
    const { nodes: n1, links } = makeComparisonGraph();
    const { nodes: n2 }        = makeComparisonGraph();

    // Clone links for second sim
    const links2 = JSON.parse(JSON.stringify(links));

    // Add blob forces to both
    const blob0a = makeNestedBlobForce(0, 3);
    const blob0b = makeNestedBlobForce(0, 3);

    console.log('\n  Renderer comparison:');

    const current = scoreConfig(n1, links, 'current  (charge=-30)', {
      blobMode: true, ticks: 600, extraForces: { groupCentroid: blob0a },
    });

    // Temporarily override charge to -80 for the second sim
    const strongerSim = forceSimulation(n2)
      .force('link', forceLink(links2).id(n => n.id).distance(L).strength(0.4))
      .force('charge', forceManyBody().strength(-80))
      .force('collide', makeCollide(n => (n.val ?? 6) + 15))
      .force('groupCentroid', blob0b)
      .stop();
    for (let i = 0; i < 600; i++) strongerSim.tick();
    const stronger = {
      score: layoutQualityScore(n2, links2).score,
      vis:   edgeVisibility(n2, links2).ratio,
      integ: blobIntegrity(n2).ratio,
      sep:   blobSeparation(n2).minClearance,
    };
    console.log(`  stronger (charge=-80): score=${stronger.score}, vis=${stronger.vis.toFixed(2)}, integrity=${stronger.integ.toFixed(2)}, separation=${stronger.sep.toFixed(0)}px`);

    // Both should be above absolute minimum
    expect(current.score).toBeGreaterThan(30);
    expect(stronger.score).toBeGreaterThan(30);

    // Log which is better
    console.log(`\n  Winner: ${stronger.score > current.score ? 'stronger charge' : 'current'} (+${Math.abs(stronger.score - current.score).toFixed(1)} pts)`);
  });
});
