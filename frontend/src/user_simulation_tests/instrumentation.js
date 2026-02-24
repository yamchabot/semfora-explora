/**
 * Layer 1: Instrumentation
 *
 * Pure geometry extraction. No thresholds, no judgement, no perception.
 * A camera could theoretically produce all of this from a rendered image.
 *
 * Input:  nodes with { id, x, y, val?, group? }
 *         links with { source, target } (source/target may be id strings or node objects)
 * Output: plain objects with raw geometric facts
 */

export function nodeId(n) {
  return typeof n === "object" && n !== null ? n.id : n;
}

export function nodeRadius(n) {
  return (n.val ?? 6) + 4;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Spatial aggregates
// ---------------------------------------------------------------------------

/** { [group]: { x, y, count } } */
export function groupCentroids(nodes) {
  const acc = {};
  for (const n of nodes) {
    const g = n.group ?? "__default__";
    if (!acc[g]) acc[g] = { x: 0, y: 0, count: 0 };
    acc[g].x += n.x;
    acc[g].y += n.y;
    acc[g].count++;
  }
  return Object.fromEntries(
    Object.entries(acc).map(([g, v]) => [
      g,
      { x: v.x / v.count, y: v.y / v.count, count: v.count },
    ])
  );
}

/** Mean distance from each group's centroid to its members. { [group]: radius } */
export function groupRadii(nodes, precomputedCentroids) {
  const cents = precomputedCentroids ?? groupCentroids(nodes);
  const result = {};
  for (const [g, c] of Object.entries(cents)) {
    const members = nodes.filter((n) => (n.group ?? "__default__") === g);
    if (!members.length) { result[g] = 0; continue; }
    result[g] = members.reduce((s, n) => s + dist(n, c), 0) / members.length;
  }
  return result;
}

/** Axis-aligned bounding box per group. { [group]: { minX, maxX, minY, maxY, width, height } } */
export function groupBounds(nodes) {
  const bounds = {};
  for (const n of nodes) {
    const g = n.group ?? "__default__";
    if (!bounds[g]) bounds[g] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const b = bounds[g];
    b.minX = Math.min(b.minX, n.x);
    b.maxX = Math.max(b.maxX, n.x);
    b.minY = Math.min(b.minY, n.y);
    b.maxY = Math.max(b.maxY, n.y);
  }
  return Object.fromEntries(
    Object.entries(bounds).map(([g, b]) => [
      g,
      { ...b, width: b.maxX - b.minX, height: b.maxY - b.minY },
    ])
  );
}

/** Centroid of all nodes regardless of group. { x, y } */
export function globalCentroid(nodes) {
  if (!nodes.length) return { x: 0, y: 0 };
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
}

// ---------------------------------------------------------------------------
// Pairwise / edge geometry
// ---------------------------------------------------------------------------

/** All pairwise distances (O(N²)). Returns array of { a, b, d }. */
export function pairwiseDistances(nodes) {
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      pairs.push({ a: nodes[i], b: nodes[j], d: dist(nodes[i], nodes[j]) });
    }
  }
  return pairs;
}

/** Edge lengths. Returns array of { source, target, length }. */
export function edgeLengths(nodes, links) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return links.map((l) => {
    const s = byId[nodeId(l.source)];
    const t = byId[nodeId(l.target)];
    return { source: nodeId(l.source), target: nodeId(l.target), length: s && t ? dist(s, t) : null };
  });
}

/** In/out degree per node. { [nodeId]: { in, out, total } } */
export function nodeDegrees(nodes, links) {
  const deg = Object.fromEntries(nodes.map((n) => [n.id, { in: 0, out: 0, total: 0 }]));
  for (const l of links) {
    const s = nodeId(l.source), t = nodeId(l.target);
    if (deg[s]) { deg[s].out++; deg[s].total++; }
    if (deg[t]) { deg[t].in++; deg[t].total++; }
  }
  return deg;
}

/** Distance from each node to its own group centroid. { [nodeId]: dist } */
export function nodeToGroupCentroidDist(nodes, precomputedCentroids) {
  const cents = precomputedCentroids ?? groupCentroids(nodes);
  return Object.fromEntries(
    nodes.map((n) => {
      const c = cents[n.group ?? "__default__"];
      return [n.id, c ? dist(n, c) : 0];
    })
  );
}

/** Distance from each node to the global centroid. { [nodeId]: dist } */
export function nodeToGlobalCentroidDist(nodes) {
  const gc = globalCentroid(nodes);
  return Object.fromEntries(nodes.map((n) => [n.id, dist(n, gc)]));
}

/** How many node pairs have overlapping radii. */
export function overlapCount(nodes) {
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const minGap = nodeRadius(nodes[i]) + nodeRadius(nodes[j]);
      if (dist(nodes[i], nodes[j]) < minGap) count++;
    }
  }
  return count;
}

/** Fraction of node pairs that overlap. */
export function overlapRate(nodes) {
  const n = nodes.length;
  if (n < 2) return 0;
  return overlapCount(nodes) / ((n * (n - 1)) / 2);
}

// ---------------------------------------------------------------------------
// Edge crossings
// ---------------------------------------------------------------------------

function cross2d(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a, b, c, d) {
  // Shared endpoint = not a crossing
  if (a.id === c.id || a.id === d.id || b.id === c.id || b.id === d.id) return false;
  const d1 = cross2d(c, d, a), d2 = cross2d(c, d, b);
  const d3 = cross2d(a, b, c), d4 = cross2d(a, b, d);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Number of crossing edge pairs. O(E²). */
export function edgeCrossingCount(nodes, links) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const segs = links
    .map((l) => [byId[nodeId(l.source)], byId[nodeId(l.target)]])
    .filter(([s, t]) => s && t);

  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segmentsIntersect(...segs[i], ...segs[j])) count++;
    }
  }
  return count;
}

/** Fraction of edge pairs that cross. */
export function edgeCrossingRate(nodes, links) {
  const e = links.length;
  if (e < 2) return 0;
  return edgeCrossingCount(nodes, links) / ((e * (e - 1)) / 2);
}

// ---------------------------------------------------------------------------
// Shape analysis
// ---------------------------------------------------------------------------

/**
 * PCA elongation ratio of a set of nodes.
 * 1.0 = circular cluster; >> 1.0 = elongated / pipeline-shaped.
 */
export function elongationRatio(nodes) {
  if (nodes.length < 2) return 1;
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const n of nodes) {
    const dx = n.x - cx, dy = n.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace / 2) ** 2 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;
  return lambda2 < 0.001 ? Infinity : Math.sqrt(Math.abs(lambda1 / lambda2));
}

/**
 * For a given hub node, ratio of its distance from group centroid
 * to the mean member-centroid distance (0 = perfectly centered, 1 = at the edge).
 */
export function hubCentralityError(hubNode, groupNodes, centroid) {
  const c = centroid ?? groupCentroids(groupNodes)[groupNodes[0]?.group ?? "__default__"];
  if (!c) return 1;
  const hubDist = dist(hubNode, c);
  const memberDists = groupNodes.map((n) => dist(n, c));
  const meanDist = memberDists.reduce((a, b) => a + b, 0) / memberDists.length;
  return meanDist < 0.001 ? 0 : hubDist / meanDist;
}

/**
 * Given a sorted list of node IDs representing a chain,
 * compute how much of the total path length is "captured" by the straight-line span
 * from first to last. 1.0 = straight line, < 1 = bent.
 */
export function chainLinearityScore(nodeIds, byId) {
  const ns = nodeIds.map((id) => byId[id]).filter(Boolean);
  if (ns.length < 2) return 1;
  let totalPath = 0;
  for (let i = 1; i < ns.length; i++) totalPath += dist(ns[i - 1], ns[i]);
  const span = dist(ns[0], ns[ns.length - 1]);
  return totalPath < 0.001 ? 1 : span / totalPath;
}

/**
 * Minimum centroid-to-centroid distance between any two groups,
 * normalized by the sum of their radii. > 1 = gap between blobs; < 1 = overlapping.
 */
export function blobSeparationRatio(nodes) {
  const cents = groupCentroids(nodes);
  const radii = groupRadii(nodes, cents);
  const groups = Object.keys(cents);
  if (groups.length < 2) return Infinity;

  let minRatio = Infinity;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const d = dist(cents[groups[i]], cents[groups[j]]);
      const sumR = (radii[groups[i]] ?? 0) + (radii[groups[j]] ?? 0);
      if (sumR > 0) minRatio = Math.min(minRatio, d / sumR);
    }
  }
  return minRatio;
}

/**
 * Gestalt proximity ratio: mean intra-group distance / mean inter-group distance.
 * Lower = groups are tightly packed relative to their separation = more visually distinct.
 */
export function gestaltProximityRatio(nodes) {
  const pairs = pairwiseDistances(nodes);
  const intra = pairs.filter((p) => (p.a.group ?? "__default__") === (p.b.group ?? "__default__"));
  const inter = pairs.filter((p) => (p.a.group ?? "__default__") !== (p.b.group ?? "__default__"));
  if (!intra.length || !inter.length) return 1;
  const avgIntra = intra.reduce((s, p) => s + p.d, 0) / intra.length;
  const avgInter = inter.reduce((s, p) => s + p.d, 0) / inter.length;
  return avgInter < 0.001 ? 0 : avgIntra / avgInter;
}

/**
 * Spatial spread of the whole layout (RMS distance from global centroid).
 */
export function layoutSpread(nodes) {
  const gc = globalCentroid(nodes);
  const dists = nodes.map((n) => dist(n, gc));
  return Math.sqrt(dists.reduce((s, d) => s + d * d, 0) / nodes.length);
}
