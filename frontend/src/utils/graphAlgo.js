// ── Graph algorithm utilities ──────────────────────────────────────────────────
// Pure functions — no React, no DOM, fully unit-testable.

/**
 * Build forward + backward adjacency maps from a list of links.
 * Handles both raw-string and d3-mutated-object source/target.
 *
 * @param {Array} links
 * @returns {{ fwdAdj: Map<string, string[]>, bwdAdj: Map<string, string[]> }}
 */
export function buildAdjacencyMaps(links) {
  const fwd = new Map(), bwd = new Map();
  for (const link of links) {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    if (!fwd.has(src)) fwd.set(src, []);
    fwd.get(src).push(tgt);
    if (!bwd.has(tgt)) bwd.set(tgt, []);
    bwd.get(tgt).push(src);
  }
  return { fwdAdj: fwd, bwdAdj: bwd };
}

/**
 * BFS from `start` node following `adj` adjacency map, up to `maxD` hops.
 * Returns Map<nodeId, hops>. The start node is always at distance 0.
 *
 * @param {string} start
 * @param {Map<string, string[]>} adj
 * @param {number} maxD
 * @returns {Map<string, number>}
 */
export function bfsFromNode(start, adj, maxD) {
  const dist  = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const d   = dist.get(cur);
    if (d >= maxD) continue;
    for (const nb of (adj.get(cur) || [])) {
      if (!dist.has(nb)) { dist.set(nb, d + 1); queue.push(nb); }
    }
  }
  return dist;
}

/**
 * Find connecting chain edges between all pairs of selected nodes.
 *
 * Returns a Map<"u|v", minChainLen> of edges that lie on valid connecting
 * paths between any pair of selected nodes.
 *
 * Algorithm (per ordered pair S→T):
 *  1. Build "progress subgraph": edges (u→v) where both monotone BFS guards
 *     hold — i.e. u is closer to S than v is (forward guard), and v is closer
 *     to T than u is (backward guard). This ensures edges only make progress.
 *  2. BFS forward from S in the progress subgraph → forwardReachable
 *  3. BFS backward from T in the progress subgraph → backwardReachable
 *  4. Keep only edges where source ∈ forwardReachable AND target ∈
 *     backwardReachable. This intersection guarantees a connected subgraph.
 *
 * @param {string[]} selectedIds   - selected node IDs (length >= 2)
 * @param {Map}      fwdAdj        - forward adjacency map
 * @param {Map}      bwdAdj        - backward adjacency map
 * @param {Array}    links         - raw links (source/target: string or d3 obj)
 * @param {number}   maxHops       - maximum path length
 * @returns {Map<string, number>}  chainEdgeMap
 */
export function findChainEdges(selectedIds, fwdAdj, bwdAdj, links, maxHops) {
  if (selectedIds.length < 2) return new Map();

  const fwd = selectedIds.map(s => bfsFromNode(s, fwdAdj, maxHops));
  const bwd = selectedIds.map(t => bfsFromNode(t, bwdAdj, maxHops));

  const result = new Map();

  for (let i = 0; i < selectedIds.length; i++) {
    for (let j = 0; j < selectedIds.length; j++) {
      if (i === j) continue;
      const S = selectedIds[i], T = selectedIds[j];

      // ── Step 1: build the progress subgraph for this (S, T) pair ──────────
      const progressOut  = new Map();  // u → [v, ...]
      const progressIn   = new Map();  // v → [u, ...]
      const pairEdgeLens = new Map();  // "u|v" → chain length

      for (const link of links) {
        const u = typeof link.source === "object" ? link.source.id : link.source;
        const v = typeof link.target === "object" ? link.target.id : link.target;

        const du  = fwd[i].get(u);  if (du  == null) continue;
        const dvu = fwd[i].get(v);  if (dvu == null || dvu <= du) continue; // fwd guard
        const dv  = bwd[j].get(v);  if (dv  == null) continue;
        const duT = bwd[j].get(u);  if (duT == null || duT <= dv) continue; // bwd guard
        const len = du + 1 + dv;    if (len  > maxHops)           continue;

        pairEdgeLens.set(`${u}|${v}`, len);
        if (!progressOut.has(u)) progressOut.set(u, []);
        progressOut.get(u).push(v);
        if (!progressIn.has(v)) progressIn.set(v, []);
        progressIn.get(v).push(u);
      }

      if (!pairEdgeLens.size) continue;

      // ── Step 2: BFS forward from S in the progress subgraph ───────────────
      const forwardReachable = new Set([S]);
      const fq = [S];
      while (fq.length) {
        const u = fq.shift();
        for (const v of (progressOut.get(u) || [])) {
          if (!forwardReachable.has(v)) { forwardReachable.add(v); fq.push(v); }
        }
      }
      if (!forwardReachable.has(T)) continue; // T unreachable from S → skip pair

      // ── Step 3: BFS backward from T in the progress subgraph ─────────────
      const backwardReachable = new Set([T]);
      const bq = [T];
      while (bq.length) {
        const v = bq.shift();
        for (const u of (progressIn.get(v) || [])) {
          if (!backwardReachable.has(u)) { backwardReachable.add(u); bq.push(u); }
        }
      }

      // ── Step 4: keep edges in forward ∩ backward intersection ────────────
      for (const [key, len] of pairEdgeLens) {
        const bar = key.indexOf("|");
        const u = key.slice(0, bar), v = key.slice(bar + 1);
        if (forwardReachable.has(u) && backwardReachable.has(v)) {
          const prev = result.get(key);
          if (prev == null || len < prev) result.set(key, len);
        }
      }
    }
  }

  return result;
}

/**
 * Collect all node IDs that appear in any chain edge, plus the selected nodes.
 *
 * @param {Map<string, number>} chainEdgeMap
 * @param {string[]}            selectedIds
 * @returns {Set<string>}
 */
export function collectChainNodeIds(chainEdgeMap, selectedIds) {
  const ids = new Set(selectedIds);
  for (const key of chainEdgeMap.keys()) {
    const bar = key.indexOf("|");
    ids.add(key.slice(0, bar));
    ids.add(key.slice(bar + 1));
  }
  return ids;
}

/**
 * Andrew's monotone chain convex hull.
 * Returns hull points as [x, y] pairs. Handles degenerate cases (< 3 points).
 *
 * @param {Array<[number, number]>} pts
 * @returns {Array<[number, number]>}
 */
export function convexHull(pts) {
  if (pts.length < 3) return pts.map(p => [...p]);
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O, A, B) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lower = [], upper = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}
