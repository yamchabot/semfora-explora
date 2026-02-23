/**
 * Pure function that builds ForceGraph2D-compatible {nodes, links} from an
 * Explore API response.  Extracted from GraphRenderer so it can be tested
 * without any DOM / canvas / React dependency.
 *
 * @param {object}  data        - Explore API response
 * @param {object}  opts
 * @param {number}  opts.minWeight   - Drop edges whose weight < minWeight (default 1)
 * @param {number}  opts.topK        - Keep only top-K edges per source (0 = all)
 * @param {string|null} opts.colorKey - Measure key used for colour gradient
 * @param {{min:number,max:number}} opts.colorStats
 * @param {string|null} opts.sizeKey  - Measure key used for node size
 * @param {boolean} opts.hideIsolated - Remove nodes with no edges
 * @returns {{ nodes: object[], links: object[], isBlobMode: boolean }}
 */

import { filterEdgesToNodes } from "./filterUtils.js";
import { lerpColor } from "./colorUtils.js";

export function buildGraphData(data, {
  minWeight   = 1,
  topK        = 0,
  colorKey    = null,
  colorStats  = { min: 0, max: 1 },
  sizeKey     = null,
  hideIsolated = false,
} = {}) {
  if (!data?.rows) return { nodes: [], links: [], isBlobMode: false };

  const isBlobMode = (data?.dimensions?.length ?? 0) >= 2;
  const dim0 = data?.dimensions?.[0];
  const dim1 = data?.dimensions?.[1];

  // ── Edge filtering ────────────────────────────────────────────────────────
  function filterEdges(raw, validIds) {
    let edges = [...(raw || [])];

    // Weight threshold
    if (minWeight > 1) edges = edges.filter(e => e.weight >= minWeight);

    // Top-K per source
    if (topK > 0) {
      const bySource = new Map();
      for (const e of edges) {
        if (!bySource.has(e.source)) bySource.set(e.source, []);
        bySource.get(e.source).push(e);
      }
      edges = [];
      for (const arr of bySource.values()) {
        arr.sort((a, b) => b.weight - a.weight);
        edges.push(...arr.slice(0, topK));
      }
    }

    const mapped = edges.map(e => ({ source: e.source, target: e.target, value: e.weight }));
    // Also drops edges whose source/target is not in the visible node set.
    return filterEdgesToNodes(mapped, validIds);
  }

  // ── Colour ────────────────────────────────────────────────────────────────
  function makeColor(vals) {
    const t = colorKey
      ? Math.max(0, Math.min(1,
          (vals[colorKey] - colorStats.min) / (colorStats.max - colorStats.min)))
      : 0.5;
    return lerpColor("#3fb950", "#f85149", t);
  }

  // ── Blob mode (2+ dims) ───────────────────────────────────────────────────
  if (isBlobMode) {
    const leafRows = data.rows.flatMap(pr =>
      (pr.children || []).map(c => ({ ...c, _group: pr.key[dim0] }))
    );
    const maxSize = Math.max(1, ...leafRows.map(r => r.values[sizeKey] || 0));

    // Deduplicate: same inner-dim value may appear under multiple outer rows.
    // Keep the row whose sizeKey measure is highest.
    const byInner = new Map();
    for (const r of leafRows) {
      const innerVal = r.key[dim1];
      const existing = byInner.get(innerVal);
      if (!existing || (r.values[sizeKey] || 0) > (existing.values[sizeKey] || 0))
        byInner.set(innerVal, r);
    }

    const nodes = [...byInner.values()].map(r => {
      const id   = r.key[dim1];
      const vals = r.values;
      const sz   = Math.sqrt((vals[sizeKey] || 1) / maxSize) * 18 + 4;
      return { id, name: id, values: vals, group: r._group, val: sz, color: makeColor(vals) };
    });

    const validIds = new Set(nodes.map(n => n.id));
    const links    = filterEdges(data.leaf_graph_edges, validIds);

    if (hideIsolated) {
      const connected = new Set();
      links.forEach(l => { connected.add(l.source); connected.add(l.target); });
      return { nodes: nodes.filter(n => connected.has(n.id)), links, isBlobMode: true };
    }
    return { nodes, links, isBlobMode: true };
  }

  // ── Single-dim mode ───────────────────────────────────────────────────────
  const maxSize = Math.max(1, ...data.rows.map(r => r.values[sizeKey] || 0));
  const nodes   = data.rows.map(r => {
    const id   = r.key[dim0];
    const vals = r.values;
    const sz   = Math.sqrt((vals[sizeKey] || 1) / maxSize) * 18 + 4;
    return { id, name: id, values: vals, val: sz, color: makeColor(vals) };
  });

  const validIds = new Set(nodes.map(n => n.id));
  const links    = filterEdges(data.graph_edges, validIds);

  if (hideIsolated) {
    const connected = new Set();
    links.forEach(l => { connected.add(l.source); connected.add(l.target); });
    return { nodes: nodes.filter(n => connected.has(n.id)), links, isBlobMode: false };
  }
  return { nodes, links, isBlobMode: false };
}
