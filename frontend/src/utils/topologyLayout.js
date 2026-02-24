/**
 * topologyLayout.js — Topology-aware blob placement
 *
 * Computes initial centroid positions for module blobs so that strongly-coupled
 * module pairs start adjacent and corridor-corridor crossings are minimised.
 *
 * Used by:
 *   - GraphRenderer.jsx  — production initial placement before D3 interactive sim
 *   - run_scenarios.js   — test simulation pre-positioning (own JS port kept there
 *                          to avoid ESM/CJS import issues in the Node test runner)
 *   - Vitest unit tests  — algorithm correctness
 *
 * No React, no D3 imports — pure JS so it can run in Node/Vitest without a DOM.
 */

// ── Crossing-optimal circular ordering ───────────────────────────────────────

/**
 * Given n module groups and their pairwise edge weights, find the circular
 * ordering that minimises the WEIGHTED count of corridor-corridor crossings.
 *
 * Two corridors (A,C) and (B,D) cross iff B and D interleave A and C on the
 * circle (going clockwise: A…B…C…D or A…D…C…B). The crossing cost is wA + wB.
 *
 * Algorithm:
 *   n ≤ 8 : exact — enumerate all (n−1)! circular permutations (fix first
 *            element to break rotational symmetry). Max 5040 for n=8.
 *   n > 8 : 2-opt hill-climb — repeatedly swap adjacent pairs until no swap
 *            reduces the total crossing cost.
 *
 * @param {string[]}  groups       - array of module/group identifiers
 * @param {object}    pairWeights  - { "A|B": weight, … } cross-edge counts
 * @returns {string[]} reordered groups in crossing-minimising circular order
 */
export function findOptimalCircularOrder(groups, pairWeights) {
  const n = groups.length;
  if (n <= 2) return [...groups];

  const corridors = Object.entries(pairWeights); // [[key, weight], …]

  function weightedCrossings(order) {
    const pos = new Map(order.map((g, i) => [g, i]));
    let cost = 0;
    for (let i = 0; i < corridors.length; i++) {
      const [kA, wA] = corridors[i];
      const [a1, a2] = kA.split('|');
      const ia1 = pos.get(a1), ia2 = pos.get(a2);
      if (ia1 == null || ia2 == null) continue;
      for (let j = i + 1; j < corridors.length; j++) {
        const [kB, wB] = corridors[j];
        const [b1, b2] = kB.split('|');
        const ib1 = pos.get(b1), ib2 = pos.get(b2);
        if (ib1 == null || ib2 == null) continue;
        // Skip corridors that share a module endpoint
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
        // B and D interleave A and C ↔ exactly one of {b1, b2} is in the arc A→C
        const [lo, hi] = ia1 < ia2 ? [ia1, ia2] : [ia2, ia1];
        const b1In = ib1 > lo && ib1 < hi;
        const b2In = ib2 > lo && ib2 < hi;
        if (b1In !== b2In) cost += wA + wB;
      }
    }
    return cost;
  }

  if (n <= 8) {
    // Exact: enumerate all (n-1)! permutations with first element fixed
    const fixed = groups[0];
    const rest  = groups.slice(1);
    let bestOrder    = [fixed, ...rest];
    let bestCost     = weightedCrossings(bestOrder);

    function permute(arr, cur) {
      if (arr.length === 0) {
        const order = [fixed, ...cur];
        const c = weightedCrossings(order);
        if (c < bestCost) { bestCost = c; bestOrder = [...order]; }
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, arr[i]]);
      }
    }
    permute(rest, []);
    return bestOrder;
  }

  // 2-opt hill-climb for larger n
  let order    = [...groups];
  let cost     = weightedCrossings(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
      const c = weightedCrossings(order);
      if (c < cost) { cost = c; improved = true; }
      else           { [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
    }
  }
  return order;
}

// ── Count pairwise cross-module edge weights ──────────────────────────────────

/**
 * Build a { "A|B": count } map from a nodes + links array.
 * Keys are always sorted (smaller group first) for lookup consistency.
 *
 * @param {object[]} nodes  - nodes with .id and .group
 * @param {object[]} links  - links with .source / .target (id strings OR node objects)
 * @returns {object} pairWeights
 */
export function buildPairWeights(nodes, links) {
  const nodeGroup = new Map(nodes.map(n => [n.id, n.group]));
  const pairWeights = {};
  for (const link of links) {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    const sg = nodeGroup.get(srcId), tg = nodeGroup.get(tgtId);
    if (!sg || !tg || sg === tg) continue;
    const key = sg < tg ? `${sg}|${tg}` : `${tg}|${sg}`;
    pairWeights[key] = (pairWeights[key] || 0) + 1;
  }
  return pairWeights;
}

// ── Topology-aware group centroid placement ───────────────────────────────────

/**
 * Compute crossing-minimal initial centroid positions for each module group.
 *
 * Steps:
 *   1. Build cross-module edge-count map (pairWeights)
 *   2. Find crossing-optimal circular ordering via findOptimalCircularOrder()
 *   3. Place group centroids on a circle using that ordering
 *   4. (Optional) scale so the strongest-coupled pair starts closer together
 *
 * For ≤ 2 groups falls back to the standard even-spaced circle.
 *
 * @param {object[]} nodes        - nodes with .id and .group
 * @param {object[]} links        - links
 * @param {string[]} outerGroups  - the ordered list of groups to position
 * @param {number}   spread       - target radius for the outer circle
 * @returns {Map<string, {x:number, y:number}>}
 */
export function computeTopologyAwareGroupPos(nodes, links, outerGroups, spread) {
  const n = outerGroups.length;

  if (n <= 2) {
    // Standard circle — no topology needed for 1 or 2 blobs
    return new Map(outerGroups.map((g, i) => {
      const angle = (2 * Math.PI * i) / Math.max(n, 1);
      return [g, { x: Math.cos(angle) * spread, y: Math.sin(angle) * spread }];
    }));
  }

  const pairWeights = buildPairWeights(nodes, links);
  const optOrder    = findOptimalCircularOrder(outerGroups, pairWeights);
  const maxWeight   = Math.max(1, ...Object.values(pairWeights));

  // Place each group on the circle at the crossing-optimal position.
  // Slightly contract the circle radius for strongly-coupled pairs so they
  // start a bit closer — the D3 interactive sim will refine further.
  const positions = new Map();
  optOrder.forEach((g, i) => {
    const angle = (2 * Math.PI * i) / n;
    positions.set(g, {
      x: Math.cos(angle) * spread,
      y: Math.sin(angle) * spread,
    });
  });
  return positions;
}

// ── Count corridor-corridor crossings (for testing) ───────────────────────────

/**
 * Given a Map of group positions and a pairWeights dict, count how many pairs
 * of corridors geometrically intersect.
 *
 * Returns { crossingPairs, totalPairs, weightedRatio }
 */
export function countCorridorCrossings(groupPositions, pairWeights) {
  const corridors = Object.entries(pairWeights);
  let crossingPairs = 0, totalPairs = 0, crossingWeight = 0, totalWeight = 0;

  for (let i = 0; i < corridors.length; i++) {
    const [kA, wA] = corridors[i];
    const [a1, a2] = kA.split('|');
    const pA1 = groupPositions.get(a1), pA2 = groupPositions.get(a2);
    if (!pA1 || !pA2) continue;

    for (let j = i + 1; j < corridors.length; j++) {
      const [kB, wB] = corridors[j];
      const [b1, b2] = kB.split('|');
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      const pB1 = groupPositions.get(b1), pB2 = groupPositions.get(b2);
      if (!pB1 || !pB2) continue;

      totalPairs++;
      totalWeight += wA + wB;

      if (_segCross(pA1, pA2, pB1, pB2)) {
        crossingPairs++;
        crossingWeight += wA + wB;
      }
    }
  }

  return {
    crossingPairs,
    totalPairs,
    weightedRatio: totalWeight > 0 ? crossingWeight / totalWeight : 0,
  };
}

function _segCross(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}
