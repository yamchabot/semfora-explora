/**
 * layoutMetrics.js
 *
 * Pure measurement functions for graph layout quality.
 * Input: positioned nodes + links (after simulation).
 * Output: numerical scores — no rendering, no DOM, no canvas.
 *
 * These metrics model how a human perceives a graph layout:
 *   - Can I see the edges? (edgeVisibility)
 *   - Do crossing edges confuse me? (edgeCrossings)
 *   - Are nodes squashed on top of each other? (nodeOverlap)
 *   - Does the layout reflect the graph distance? (stress)
 *   - Can I see the hub in a hub-and-spoke? (hubCentrality)
 *   - Does a pipeline look like a pipeline? (chainLinearity)
 *   - Are blobs clearly separated visual units? (blobSeparation, blobIntegrity)
 *   - Is my attention drawn to the right nodes? (sizeProminence)
 *   - Can I read edges at their angles? (angularResolution)
 */

// ── Geometry primitives ───────────────────────────────────────────────────────

export function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function centroid(nodes) {
  if (!nodes.length) return { x: 0, y: 0 };
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
}

/** Visual radius of a node (matches production: val ranges 4–22). */
export function nodeRadius(n) {
  return n.val ?? 6;
}

/** Resolve link endpoints to node objects. */
function resolveLink(link, nodeMap) {
  const srcId = typeof link.source === 'object' ? link.source.id : link.source;
  const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
  return [nodeMap.get(srcId), nodeMap.get(tgtId)];
}

function nodeMap(nodes) {
  return new Map(nodes.map(n => [n.id, n]));
}

/** PCA axis spans → { major, minor, ratio }. */
export function axisSpans(nodes) {
  if (nodes.length < 2) return { major: 0, minor: 0, ratio: 1 };
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const n of nodes) {
    const dx = n.x - cx, dy = n.y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c1 = Math.cos(angle), s1 = Math.sin(angle);
  const c2 = -s1, s2 = c1;
  const proj1 = nodes.map(n => (n.x - cx) * c1 + (n.y - cy) * s1);
  const proj2 = nodes.map(n => (n.x - cx) * c2 + (n.y - cy) * s2);
  const span = p => Math.max(...p) - Math.min(...p);
  const major = span(proj1), minor = span(proj2);
  // Cap at 10.0 — a perfectly straight chain has minor≈0 → Infinity, which
  // serialises to JSON null. 10.0 means "essentially infinite elongation" and
  // is safely above any user constraint threshold (max 2.2 in current formulas).
  return { major, minor, ratio: minor < 1 ? 10.0 : Math.min(10.0, major / minor) };
}

// ── 1. Edge visibility ────────────────────────────────────────────────────────

/**
 * For each edge: gap = distance between node surfaces (center-to-center minus
 * sum of radii). A gap > threshold means the edge is visible to a human eye.
 *
 * Returns:
 *   ratio       0–1   fraction of edges that are visible
 *   avgGap      px    mean surface gap across all edges
 *   minGap      px    worst-case edge gap
 *   invisible   []    link objects where gap ≤ threshold
 */
export function edgeVisibility(nodes, links, threshold = 8) {
  const map = nodeMap(nodes);
  let visible = 0, totalGap = 0, minGap = Infinity;
  const invisible = [];

  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    const d   = dist(a, b);
    const gap = d - nodeRadius(a) - nodeRadius(b);
    totalGap += gap;
    if (gap < minGap) minGap = gap;
    if (gap > threshold) visible++;
    else invisible.push(link);
  }

  return {
    ratio:     links.length ? visible / links.length : 1,
    avgGap:    links.length ? totalGap / links.length : 0,
    minGap:    links.length ? minGap : 0,
    invisible,
  };
}

// ── 2. Node overlap ───────────────────────────────────────────────────────────

/**
 * Fraction of node pairs where visual circles overlap.
 * 0 = no overlaps (perfect), 1 = every pair overlaps.
 *
 * Returns:
 *   ratio         0–1   fraction of pairs that overlap
 *   maxOverlap    px    worst-case overlap depth
 *   overlapping   []    [nodeA, nodeB] pairs
 */
export function nodeOverlap(nodes) {
  let overlapping = 0, maxOverlap = 0;
  const pairs = [];
  const N = nodes.length;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = nodes[i], b = nodes[j];
      const d      = dist(a, b);
      const minGap = nodeRadius(a) + nodeRadius(b);
      if (d < minGap) {
        const depth = minGap - d;
        overlapping++;
        if (depth > maxOverlap) maxOverlap = depth;
        pairs.push([a, b]);
      }
    }
  }
  const totalPairs = N * (N - 1) / 2;
  return {
    ratio:       totalPairs ? overlapping / totalPairs : 0,
    maxOverlap,
    overlapping: pairs,
  };
}

// ── 3. Edge crossings ─────────────────────────────────────────────────────────

/** True if segments (p1→p2) and (p3→p4) properly intersect. */
function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false; // parallel
  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/**
 * Count edge pairs that visually cross each other.
 * Human perception: each crossing adds cognitive load.
 * Ideal = 0 crossings.
 *
 * Returns:
 *   count         number of crossing pairs
 *   ratio         crossings / total possible pairs
 *   normalised    crossings / edges (crossings per edge)
 */
export function edgeCrossings(nodes, links) {
  const map  = nodeMap(nodes);
  const segs = links.map(l => {
    const [a, b] = resolveLink(l, map);
    return a && b ? { a, b } : null;
  }).filter(Boolean);

  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const { a: a1, b: b1 } = segs[i];
      const { a: a2, b: b2 } = segs[j];
      // Skip edges that share a node (they always appear to cross at that node)
      if (a1.id === a2.id || a1.id === b2.id || b1.id === a2.id || b1.id === b2.id) continue;
      if (segmentsIntersect(a1, b1, a2, b2)) count++;
    }
  }

  const possiblePairs = segs.length * (segs.length - 1) / 2;
  return {
    count,
    ratio:      possiblePairs ? count / possiblePairs : 0,
    normalised: segs.length   ? count / segs.length  : 0,
  };
}

// ── 4. Stress (Kamada-Kawai) ──────────────────────────────────────────────────

/**
 * Layout stress: how well actual distances match graph-theoretic distances.
 * Computes BFS distances from each node, then measures how much the layout
 * distorts those distances.
 *
 * stress = Σ_{i<j} (||pos_i - pos_j|| - d_ij × L)² / (d_ij × L)²
 *
 * 0 = perfect (every pair at exactly graph-distance apart).
 * Lower = more faithful to the graph structure.
 *
 * Returns:
 *   stress    number   total normalised stress
 *   perEdge   number   stress / num pairs (comparable across graph sizes)
 */
/**
 * intraOnly = true  → only count node-pairs within the same group.
 * This avoids penalising intentional inter-module spacing (blob separation).
 */
export function layoutStress(nodes, links, idealEdgeLength = 120, intraOnly = false) {
  const map = nodeMap(nodes);

  // Build undirected adjacency
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    adj.get(a.id).push(b.id);
    adj.get(b.id).push(a.id);
  }

  // BFS shortest-path distances from each node
  function bfs(startId) {
    const dist = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of (adj.get(cur) ?? [])) {
        if (!dist.has(nb)) { dist.set(nb, dist.get(cur) + 1); queue.push(nb); }
      }
    }
    return dist;
  }

  let stress = 0, pairs = 0;
  const ids = nodes.map(n => n.id);
  for (let i = 0; i < ids.length; i++) {
    const dists = bfs(ids[i]);
    for (let j = i + 1; j < ids.length; j++) {
      if (intraOnly && nodes[i].group !== nodes[j].group) continue;
      const d_ij = dists.get(ids[j]);
      if (d_ij == null || d_ij === 0) continue;
      const ideal   = d_ij * idealEdgeLength;
      const actual  = dist(nodes[i], nodes[j]);
      stress += (actual - ideal) ** 2 / ideal ** 2;
      pairs++;
    }
  }

  return { stress, perEdge: pairs ? stress / pairs : 0 };
}

// ── 5. Hub centrality ─────────────────────────────────────────────────────────

/**
 * For each hub node (degree ≥ minDegree), measure how close it is to the
 * centroid of its direct neighbours. A dispatcher sitting at the centre of
 * its callee cloud is perceptually readable.
 *
 * Returns per-hub scores: { nodeId, error, normalised }
 *   error       px   dist(hub, centroid(neighbours))
 *   normalised  0–1  error / avgNeighbourDist (0 = perfectly central)
 */
export function hubCentrality(nodes, links, minDegree = 3) {
  const map = nodeMap(nodes);

  // Use intra-module adjacency only — a hub at a module boundary can't be
  // central among neighbours in different (separated) blobs, so measuring
  // centrality against cross-module neighbours gives misleadingly high errors.
  const adj = new Map(nodes.map(n => [n.id, new Set()]));
  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    if (a.group !== b.group) continue;   // intra-module only
    adj.get(a.id).add(b.id);
    adj.get(b.id).add(a.id);
  }

  const results = [];
  for (const node of nodes) {
    const neighbours = [...(adj.get(node.id) ?? [])].map(id => map.get(id)).filter(Boolean);
    if (neighbours.length < minDegree) continue;

    const c       = centroid(neighbours);
    const error   = dist(node, c);
    const avgNbDist = neighbours.reduce((s, nb) => s + dist(node, nb), 0) / neighbours.length;
    results.push({
      nodeId:     node.id,
      error,
      normalised: avgNbDist ? error / avgNbDist : 0,
    });
  }

  const avgNormalised = results.length
    ? results.reduce((s, r) => s + r.normalised, 0) / results.length
    : 0;

  return { hubs: results, avgNormalised };
}

// ── 6. Chain linearity ────────────────────────────────────────────────────────

/**
 * Given an ordered sequence of node IDs forming a path, measure how well
 * the layout positions them in a line.
 *
 * Returns:
 *   ratio       major/minor PCA span — higher = more linear (pipeline-like)
 *   major       px  length along principal axis
 *   minor       px  width perpendicular to principal axis
 *   stepAngles  []  angle changes between consecutive nodes (0° = straight)
 *   straightness  0–1  fraction of steps with angle deviation < 30°
 */
export function chainLinearity(nodes, orderedIds) {
  const map   = nodeMap(nodes);
  const chain = orderedIds.map(id => map.get(id)).filter(Boolean);
  if (chain.length < 2) return { ratio: 1, major: 0, minor: 0, stepAngles: [], straightness: 1 };

  const { major, minor, ratio } = axisSpans(chain);

  // Step-by-step angle deviations (how much each turn bends)
  const stepAngles = [];
  for (let i = 1; i < chain.length - 1; i++) {
    const prev = chain[i - 1], cur = chain[i], next = chain[i + 1];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y,  next.x - cur.x);
    let delta = Math.abs(a2 - a1);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    stepAngles.push(delta * 180 / Math.PI); // degrees
  }

  const straightness = stepAngles.length
    ? stepAngles.filter(a => a < 30).length / stepAngles.length
    : 1;

  return { ratio, major, minor, stepAngles, straightness };
}

// ── 7. Blob integrity ─────────────────────────────────────────────────────────

/**
 * What fraction of nodes are inside their blob territory?
 * A node is "inside" if it's closer to its own blob centroid than to any
 * other blob's centroid (Voronoi criterion).
 *
 * Returns:
 *   ratio         0–1  fraction of nodes in correct territory
 *   violations    []   nodes that have drifted into wrong territory
 *   blobRadii     Map  groupKey → radius (max dist from centroid)
 */
export function blobIntegrity(nodes, groupKeyFn = n => n.group) {
  const groups = new Map();
  for (const n of nodes) {
    const gk = groupKeyFn(n);
    if (!gk) continue;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(n);
  }

  if (groups.size < 2) return { ratio: 1, violations: [], blobRadii: new Map() };

  // Compute centroids
  const centroids = new Map([...groups.entries()].map(([gk, ns]) => [gk, centroid(ns)]));

  // Compute radii
  const blobRadii = new Map();
  for (const [gk, ns] of groups) {
    const c = centroids.get(gk);
    const r = Math.max(...ns.map(n => dist(n, c)));
    blobRadii.set(gk, r);
  }

  // Check each node
  let inside = 0;
  const violations = [];
  for (const n of nodes) {
    const ownKey  = groupKeyFn(n);
    if (!ownKey) continue;
    const ownDist = dist(n, centroids.get(ownKey));
    let inTerritory = true;
    for (const [gk, c] of centroids) {
      if (gk === ownKey) continue;
      if (dist(n, c) < ownDist) { inTerritory = false; break; }
    }
    if (inTerritory) inside++;
    else violations.push(n);
  }

  return {
    ratio:     inside / nodes.length,
    violations,
    blobRadii,
  };
}

// ── 8. Blob separation ────────────────────────────────────────────────────────

/**
 * How well separated are the blobs from each other?
 *
 * For each pair of blob centroids, compute the "clearance":
 *   clearance = centroid_dist - radius_A - radius_B
 * Positive clearance = blobs don't overlap. Negative = they interpenetrate.
 *
 * Returns:
 *   minClearance    px   worst-case clearance (most-overlapping pair)
 *   avgClearance    px   mean clearance
 *   separationRatio      minClearance / (radius_A + radius_B) for that pair
 *   overlapping     []   [groupA, groupB] pairs where clearance < 0
 */
export function blobSeparation(nodes, groupKeyFn = n => n.group) {
  const groups = new Map();
  for (const n of nodes) {
    const gk = groupKeyFn(n);
    if (!gk) continue;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(n);
  }

  if (groups.size < 2) return { minClearance: Infinity, avgClearance: Infinity, separationRatio: Infinity, overlapping: [] };

  const centroids  = new Map([...groups.entries()].map(([gk, ns]) => [gk, centroid(ns)]));
  const radii      = new Map([...groups.entries()].map(([gk, ns]) => {
    const c = centroids.get(gk);
    return [gk, Math.max(1, ...ns.map(n => dist(n, c)))];
  }));

  const keys = [...groups.keys()];
  let minClearance = Infinity, totalClearance = 0, pairs = 0;
  const overlapping = [];

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const gA = keys[i], gB = keys[j];
      const d         = dist(centroids.get(gA), centroids.get(gB));
      const rSum      = radii.get(gA) + radii.get(gB);
      const clearance = d - rSum;
      if (clearance < minClearance) minClearance = clearance;
      totalClearance += clearance;
      pairs++;
      if (clearance < 0) overlapping.push([gA, gB]);
    }
  }

  const worstPair = keys.reduce((worst, gA) =>
    keys.reduce((w, gB) => {
      if (gA >= gB) return w;
      const d = dist(centroids.get(gA), centroids.get(gB));
      const r = radii.get(gA) + radii.get(gB);
      return d - r < w.clearance ? { gA, gB, clearance: d - r, rSum: r } : w;
    }, worst),
    { clearance: Infinity, rSum: 1 }
  );

  return {
    minClearance,
    avgClearance:    pairs ? totalClearance / pairs : Infinity,
    separationRatio: worstPair.rSum ? worstPair.clearance / worstPair.rSum : Infinity,
    overlapping,
  };
}

// ── 9. Within-blob vs between-blob density (Gestalt proximity) ───────────────

/**
 * Models the Gestalt principle of proximity: nodes close together look related.
 * A good blob layout has much lower within-blob avg distance than between-blob.
 *
 * Returns:
 *   withinAvg     px    avg pairwise distance within the same blob
 *   betweenAvg    px    avg pairwise distance across different blobs
 *   ratio               withinAvg / betweenAvg  (lower = better visual grouping)
 *   cohesion      0–1   1 - ratio  (higher = blobs look more like groups)
 */
export function gestaltProximity(nodes, groupKeyFn = n => n.group) {
  let withinTotal = 0, withinCount = 0;
  let betweenTotal = 0, betweenCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d  = dist(nodes[i], nodes[j]);
      const gi = groupKeyFn(nodes[i]);
      const gj = groupKeyFn(nodes[j]);
      if (gi && gj && gi === gj) { withinTotal += d; withinCount++; }
      else { betweenTotal += d; betweenCount++; }
    }
  }

  const withinAvg  = withinCount  ? withinTotal  / withinCount  : 0;
  const betweenAvg = betweenCount ? betweenTotal / betweenCount : Infinity;
  const ratio      = betweenAvg > 0 ? withinAvg / betweenAvg : 0;
  return { withinAvg, betweenAvg, ratio, cohesion: Math.max(0, 1 - ratio) };
}

// ── 10. Angular resolution ────────────────────────────────────────────────────

/**
 * Minimum angle between any two edges meeting at the same node.
 * Humans can't distinguish edges with < ~15° separation — they appear merged.
 *
 * Returns:
 *   minAngle     degrees   global minimum (worst case)
 *   avgMinAngle  degrees   mean of per-node minimums
 *   poorNodes    []        nodes where any pair of edges is < threshold
 */
export function angularResolution(nodes, links, threshold = 15) {
  const map  = nodeMap(nodes);
  const nbrs = new Map(nodes.map(n => [n.id, []]));

  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    nbrs.get(a.id).push(b);
    nbrs.get(b.id).push(a);
  }

  let globalMin = Infinity;
  const perNodeMin = [];
  const poorNodes = [];

  for (const node of nodes) {
    const nbs = nbrs.get(node.id) ?? [];
    if (nbs.length < 2) continue;

    const angles = nbs.map(nb => Math.atan2(nb.y - node.y, nb.x - node.x));
    angles.sort((a, b) => a - b);

    let localMin = Infinity;
    for (let i = 0; i < angles.length; i++) {
      let delta = angles[(i + 1) % angles.length] - angles[i];
      if (i === angles.length - 1) delta += 2 * Math.PI;
      const deg = delta * 180 / Math.PI;
      if (deg < localMin) localMin = deg;
    }

    perNodeMin.push(localMin);
    if (localMin < globalMin) globalMin = localMin;
    if (localMin < threshold) poorNodes.push(node);
  }

  const avgMinAngle = perNodeMin.length
    ? perNodeMin.reduce((s, a) => s + a, 0) / perNodeMin.length
    : 180;

  return {
    minAngle: globalMin === Infinity ? 180 : globalMin,
    avgMinAngle,
    poorNodes,
  };
}

// ── 11. Edge length uniformity ────────────────────────────────────────────────

/**
 * Humans expect edges to be roughly the same length — variance signals
 * uneven layout. Measured as coefficient of variation (stddev / mean).
 *
 * Returns:
 *   mean    px
 *   stddev  px
 *   cv      stddev/mean  (lower = more uniform, 0 = all edges identical)
 *   min/max px
 */
export function edgeLengthUniformity(nodes, links) {
  const map = nodeMap(nodes);
  const lengths = [];
  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (a && b) lengths.push(dist(a, b));
  }
  if (!lengths.length) return { mean: 0, stddev: 0, cv: 0, min: 0, max: 0 };

  const mean   = lengths.reduce((s, l) => s + l, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  return { mean, stddev, cv: mean ? stddev / mean : 0, min: Math.min(...lengths), max: Math.max(...lengths) };
}

// ── 12. Composite layout quality score ───────────────────────────────────────

/**
 * Weighted composite of the above metrics into a single 0–100 score.
 * Higher = better.  Weights reflect perceptual importance.
 *
 * This is a benchmark number, not a pass/fail assertion.
 * Use it to compare renderer configurations.
 */
export function layoutQualityScore(nodes, links, opts = {}) {
  const {
    idealEdgeLength = 120,
    edgeVisThreshold = 8,
    groupKeyFn = n => n.group,
  } = opts;

  const vis    = edgeVisibility(nodes, links, edgeVisThreshold);
  const ovlp   = nodeOverlap(nodes);
  const cross  = edgeCrossings(nodes, links);
  const stress = layoutStress(nodes, links, idealEdgeLength);
  const prox   = groupKeyFn ? gestaltProximity(nodes, groupKeyFn) : null;
  const integ  = groupKeyFn ? blobIntegrity(nodes, groupKeyFn) : null;

  // Each component: 0–1, higher = better
  const components = {
    edgeVisibility:  vis.ratio,                                    // w=25
    noOverlap:       1 - Math.min(1, ovlp.ratio * 20),            // w=20
    fewCrossings:    1 - Math.min(1, cross.normalised),            // w=15
    lowStress:       1 - Math.min(1, stress.perEdge / 2),         // w=20
    gestaltCohesion: prox  ? prox.cohesion : 1,                    // w=10
    blobIntegrity:   integ ? integ.ratio   : 1,                    // w=10
  };

  const weights = { edgeVisibility: 25, noOverlap: 20, fewCrossings: 15,
                    lowStress: 20, gestaltCohesion: 10, blobIntegrity: 10 };
  const totalW = Object.values(weights).reduce((s, w) => s + w, 0);

  const score = Object.entries(components)
    .reduce((s, [k, v]) => s + v * (weights[k] ?? 0), 0) / totalW * 100;

  return { score: Math.round(score * 10) / 10, components, raw: { vis, ovlp, cross, stress, prox, integ } };
}

// ── 13. Cross-module edge visibility ─────────────────────────────────────────

/**
 * Of all edges that cross a blob boundary (different group keys), what
 * fraction are visible — i.e. the gap between node surfaces exceeds threshold?
 *
 * Architecture Reviewers need to see these edges to understand coupling.
 *
 * Returns:
 *   ratio      0–1   fraction of cross-module edges that are visible
 *   count      number of cross-module edges found
 *   visible    number of those with gap > threshold
 */
export function crossModuleEdgeVisibility(nodes, links, threshold = 8, groupKeyFn = n => n.group) {
  const map = nodeMap(nodes);
  let count = 0, visible = 0;

  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    if (groupKeyFn(a) === groupKeyFn(b)) continue; // same group — skip
    count++;
    const gap = dist(a, b) - nodeRadius(a) - nodeRadius(b);
    if (gap > threshold) visible++;
  }

  return { ratio: count ? visible / count : 1, count, visible };
}

// ── 14. Node size variation ───────────────────────────────────────────────────

/**
 * Coefficient of variation (stddev / mean) of node visual radii.
 * If all nodes are the same size the size encoding is useless (CV ≈ 0).
 * A Complexity Auditor needs CV > 0.3 to reliably spot large vs small nodes.
 *
 * Returns:
 *   cv      stddev / mean  (0 = all same, 1 = highly varied)
 *   mean    px
 *   stddev  px
 *   min/max px
 */
export function nodeSizeVariation(nodes) {
  if (!nodes.length) return { cv: 0, mean: 0, stddev: 0, min: 0, max: 0 };
  const radii  = nodes.map(n => nodeRadius(n));
  const mean   = radii.reduce((s, r) => s + r, 0) / radii.length;
  const stddev = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
  return { cv: mean ? stddev / mean : 0, mean, stddev, min: Math.min(...radii), max: Math.max(...radii) };
}

// ── 15. Prominent node visibility ────────────────────────────────────────────

/**
 * For the top-N nodes by visual size (the most "important" nodes), what
 * fraction are unobscured — i.e. not overlapping with other nodes?
 *
 * A Complexity Auditor needs prominent (large) nodes to stand out visually.
 *
 * Returns:
 *   ratio        0–1   fraction of prominent nodes that are unobscured
 *   topN         the nodes examined
 *   obscured     prominent nodes that overlap with something
 */
export function prominentNodeVisibility(nodes, topN = 5) {
  if (!nodes.length) return { ratio: 1, topN: [], obscured: [] };
  const sorted   = [...nodes].sort((a, b) => nodeRadius(b) - nodeRadius(a));
  const top      = sorted.slice(0, topN);
  const obscured = [];

  for (const prominent of top) {
    const overlaps = nodes.some(other => {
      if (other.id === prominent.id) return false;
      return dist(prominent, other) < nodeRadius(prominent) + nodeRadius(other);
    });
    if (overlaps) obscured.push(prominent);
  }

  return { ratio: top.length ? (top.length - obscured.length) / top.length : 1, topN: top, obscured };
}

// ── 16. Blob edge routing ─────────────────────────────────────────────────────

/**
 * For multi-module graphs, measures whether cross-module edge corridors are
 * "clean" — i.e., the straight-line path between two connected modules'
 * centroids does NOT pass through any other module's blob.
 *
 * This captures the user-visible problem where Module A connects to Module C,
 * but Module B physically sits between them so all A→C edges visually
 * cross through B even though A↔B and B↔C coupling may be much weaker.
 *
 * The check is centroid-to-centroid, not per-edge, so it measures blob-level
 * layout quality rather than individual edge geometry.
 *
 * Returns:
 *   ratio           0–1  fraction of connected corridors that are unobstructed
 *                        (1.0 = every A→C path is visually clear of other blobs)
 *   violatingPairs  int  number of connected module pairs with blocked corridors
 *   totalPairs      int  total number of connected module pairs checked
 */
export function blobEdgeRouting(nodes, links, groupKeyFn = n => n.group) {
  const groups = [...new Set(nodes.map(groupKeyFn))];
  if (groups.length < 3) {
    // Need ≥ 3 modules for any "intermediate" blob to obstruct a corridor.
    // Two-module graphs trivially have perfect routing.
    return { ratio: 1.0, violatingPairs: 0, totalPairs: 0 };
  }

  // Centroid and approximate visual radius per group
  const groupNodes = {};
  nodes.forEach(n => {
    const g = groupKeyFn(n);
    if (!groupNodes[g]) groupNodes[g] = [];
    groupNodes[g].push(n);
  });

  const centroids = {}, radii = {};
  for (const g of groups) {
    const ns = groupNodes[g];
    const cx = ns.reduce((s, n) => s + n.x, 0) / ns.length;
    const cy = ns.reduce((s, n) => s + n.y, 0) / ns.length;
    centroids[g] = { x: cx, y: cy };
    // Visual radius: max distance from centroid to node surface
    radii[g] = ns.reduce(
      (mx, n) => Math.max(mx, Math.hypot(n.x - cx, n.y - cy) + (n.val ?? 6) + 8),
      20
    );
  }

  // Find all directly-connected module pairs (at least one cross-edge)
  const nMap = new Map(nodes.map(n => [n.id, n]));
  const connectedPairSet = new Set();
  for (const link of links) {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    const src = nMap.get(srcId), tgt = nMap.get(tgtId);
    if (!src || !tgt) continue;
    const sg = groupKeyFn(src), tg = groupKeyFn(tgt);
    if (sg === tg) continue;
    const key = sg < tg ? `${sg}|${tg}` : `${tg}|${sg}`;
    connectedPairSet.add(key);
  }

  const connectedPairs = [...connectedPairSet];
  if (connectedPairs.length === 0) return { ratio: 1.0, violatingPairs: 0, totalPairs: 0 };

  // Build a weight map (number of cross-edges per pair) so violations on
  // strongly-coupled pairs count more than violations on weak pairs.
  // Semantic justification: Fatima cares more about a heavily-used FE→BE
  // corridor being clear than a single auxiliary GW→Auth edge.
  const nMapR = new Map(nodes.map(n => [n.id, n]));
  const pairWeightsR = {};
  for (const link of links) {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    const src = nMapR.get(srcId), tgt = nMapR.get(tgtId);
    if (!src || !tgt) continue;
    const sg = groupKeyFn(src), tg = groupKeyFn(tgt);
    if (sg === tg) continue;
    const key = sg < tg ? `${sg}|${tg}` : `${tg}|${sg}`;
    pairWeightsR[key] = (pairWeightsR[key] || 0) + 1;
  }

  let violatingWeight = 0, totalWeight = 0, violatingPairs = 0;
  for (const key of connectedPairs) {
    const pairW = pairWeightsR[key] || 1;
    totalWeight += pairW;

    const [ga, gc] = key.split('|');
    const ca = centroids[ga], cc = centroids[gc];
    const dx = cc.x - ca.x, dy = cc.y - ca.y;
    const corridorLen2 = dx * dx + dy * dy;
    if (corridorLen2 < 1) continue;

    let blocked = false;
    for (const gb of groups) {
      if (gb === ga || gb === gc) continue;
      const cb = centroids[gb];
      const rb = radii[gb];

      // Project centroid_B onto the corridor segment A→C.
      // t ∈ [0,1]: t=0 at A's centroid, t=1 at C's centroid.
      const t = Math.max(0, Math.min(1,
        ((cb.x - ca.x) * dx + (cb.y - ca.y) * dy) / corridorLen2
      ));

      // Only check blobs that are genuinely in the middle of the corridor —
      // blobs very close to either endpoint are adjacent and expected to be
      // "next to" one of the modules, not "between" them.
      if (t < 0.15 || t > 0.85) continue;

      const closestX = ca.x + t * dx;
      const closestY = ca.y + t * dy;
      const distToSeg = Math.hypot(cb.x - closestX, cb.y - closestY);

      // Corridor blocked if a blob's visual radius (plus a small margin) overlaps
      // the straight-line path between the two connected centroids.
      if (distToSeg < rb + 25) {
        blocked = true;
        break; // one obstruction per corridor is enough
      }
    }
    if (blocked) {
      violatingWeight += pairW;
      violatingPairs++;
    }
  }

  // Weighted ratio: violations on heavy-traffic corridors penalise more.
  // Unweighted count also returned for diagnostics.
  const ratio = totalWeight > 0
    ? (totalWeight - violatingWeight) / totalWeight
    : 1.0;
  return { ratio, violatingPairs, totalPairs: connectedPairs.length,
           violatingWeight, totalWeight };
}

// ── 17. Auto-detect linear chains ────────────────────────────────────────────

/**
 * Find all maximal linear chains in the graph — sequences where each interior
 * node has degree exactly 2 (one in, one out in the chain).
 *
 * Returns an array of ordered node-ID arrays, each of length ≥ 3.
 * Used to automatically compute chainLinearity without needing a manual
 * ordered-IDs input.
 */
export function autoDetectChains(nodes, links) {
  const map = nodeMap(nodes);

  // Build undirected adjacency
  const adj = new Map(nodes.map(n => [n.id, new Set()]));
  for (const link of links) {
    const [a, b] = resolveLink(link, map);
    if (!a || !b) continue;
    adj.get(a.id).add(b.id);
    adj.get(b.id).add(a.id);
  }

  const degree = id => (adj.get(id) ?? new Set()).size;

  // Chain nodes: degree 1 (endpoint) or 2 (interior)
  const isChainNode = id => degree(id) <= 2;

  const visited = new Set();
  const chains  = [];

  // Start from each degree-1 node (chain endpoint)
  for (const n of nodes) {
    if (visited.has(n.id) || degree(n.id) !== 1 || !isChainNode(n.id)) continue;

    const chain = [n.id];
    visited.add(n.id);

    let prev = null, cur = n.id;
    while (true) {
      const neighbours = [...(adj.get(cur) ?? [])].filter(nb => nb !== prev && isChainNode(nb));
      if (!neighbours.length) break;
      const next = neighbours[0];
      if (visited.has(next)) break;
      chain.push(next);
      visited.add(next);
      prev = cur; cur = next;
      if (degree(cur) !== 2) break; // reached another endpoint
    }

    if (chain.length >= 3) chains.push(chain);
  }

  return chains;
}

// ── 17. Compute all facts at once ─────────────────────────────────────────────

/**
 * Run every metric and return a flat facts object ready for constraint checking.
 * This is the single entry point for user simulation constraint systems.
 */
export function computeFacts(nodes, links, opts = {}) {
  const { groupKeyFn = n => n.group, idealEdgeLength = 120, topProminentN = 5 } = opts;

  const chains = autoDetectChains(nodes, links);
  const chainLinearities = chains.map(ch => chainLinearity(nodes, ch));
  const avgChainLinearity = chainLinearities.length
    ? chainLinearities.reduce((s, c) => s + c.ratio, 0) / chainLinearities.length
    : 1;
  const avgChainStraightness = chainLinearities.length
    ? chainLinearities.reduce((s, c) => s + c.straightness, 0) / chainLinearities.length
    : 1;

  // Module-level summary stats
  const moduleCount = new Set(nodes.map(groupKeyFn)).size;
  const nMap = new Map(nodes.map(n => [n.id, n]));
  const crossEdgeCount = links.filter(l => {
    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
    const s = nMap.get(srcId), t = nMap.get(tgtId);
    return s && t && groupKeyFn(s) !== groupKeyFn(t);
  }).length;
  const crossEdgeRatio = links.length > 0 ? crossEdgeCount / links.length : 0;

  // ── Raw data for Python spatial/statistical analysis ─────────────────────

  // Compact node list: positions + module label (Python uses for sklearn)
  const nodeList = nodes.map(n => ({ x: n.x, y: n.y, g: groupKeyFn(n) }));

  // Degree distribution
  const degMap = new Map(nodes.map(n => [n.id, 0]));
  for (const l of links) {
    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
    if (degMap.has(srcId)) degMap.set(srcId, degMap.get(srcId) + 1);
    if (degMap.has(tgtId)) degMap.set(tgtId, degMap.get(tgtId) + 1);
  }
  const degVals  = [...degMap.values()];
  const degSum   = degVals.reduce((s, d) => s + d, 0);
  const degMean  = degVals.length ? degSum / degVals.length : 0;
  const degMax   = degVals.length ? Math.max(...degVals) : 0;
  // Gini coefficient of degree distribution
  const sortedDeg = [...degVals].sort((a, b) => a - b);
  const giniNum   = sortedDeg.reduce((s, d, i) => s + (2 * i - degVals.length + 1) * d, 0);
  const degGini   = degSum > 0 ? Math.abs(giniNum / (degVals.length * degSum)) : 0;

  // Chain node positions (for sklearn R² in Python — only chains ≥ 3 nodes)
  const chainNodePos = chains
    .filter(ch => ch.length >= 3)
    .map(ch => ch.map(id => {
      const nd = nMap.get(id);
      return nd ? { x: nd.x, y: nd.y } : null;
    }).filter(Boolean));

  // All edge direction angles in degrees (for angle entropy)
  const edgeAngles = links.map(l => {
    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
    const s = nMap.get(srcId), t = nMap.get(tgtId);
    return s && t ? Math.atan2(t.y - s.y, t.x - s.x) * 180 / Math.PI : null;
  }).filter(a => a !== null);

  return {
    moduleCount,
    crossEdgeRatio,
    nodeList,
    degreeDist:   { values: degVals, mean: degMean, max: degMax, gini: degGini },
    chainNodePos,
    edgeAngles,
    edgeVisibility:             edgeVisibility(nodes, links),
    nodeOverlap:                nodeOverlap(nodes),
    edgeCrossings:              edgeCrossings(nodes, links),
    layoutStress:               layoutStress(nodes, links, idealEdgeLength),
    intraModuleStress:          layoutStress(nodes, links, idealEdgeLength, true),
    hubCentrality:              hubCentrality(nodes, links),
    chainLinearity:             { ratio: avgChainLinearity, straightness: avgChainStraightness, chains: chainLinearities },
    blobIntegrity:              blobIntegrity(nodes, groupKeyFn),
    blobSeparation:             blobSeparation(nodes, groupKeyFn),
    gestaltProximity:           gestaltProximity(nodes, groupKeyFn),
    angularResolution:          angularResolution(nodes, links),
    edgeLengthUniformity:       edgeLengthUniformity(nodes, links),
    crossModuleEdgeVisibility:  crossModuleEdgeVisibility(nodes, links, 8, groupKeyFn),
    nodeSizeVariation:          nodeSizeVariation(nodes),
    prominentNodeVisibility:    prominentNodeVisibility(nodes, topProminentN),
    qualityScore:               layoutQualityScore(nodes, links, { groupKeyFn, idealEdgeLength }),
    blobEdgeRouting:            blobEdgeRouting(nodes, links, groupKeyFn),
  };
}
