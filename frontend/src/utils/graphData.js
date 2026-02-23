/**
 * Pure functions for building ForceGraph2D-compatible graph data from an
 * Explore API response.  Extracted from GraphRenderer so they can be tested
 * without any DOM / canvas / React dependency.
 *
 * Key exports
 * ───────────
 * buildGraphData(data, opts)         Main entry point.  Returns { nodes, links, isBlobMode }.
 * flattenLeafRows(rows, numDims)     Recursively flatten N-level pivot tree to leaf rows.
 * getGroupKey(node, level)           Stable group key at a given nesting level.
 *
 * Nested-blob model (N ≥ 2 dims)
 * ───────────────────────────────
 * Each graph node is a leaf-dim value.  Its ancestors in the pivot tree are
 * encoded as `node.groupPath`: an array of [dim0val, dim1val, ..., dim[N-2]val].
 * The canvas painter loops over blob levels 0..N-2 and groups nodes by
 * getGroupKey(node, L) to draw increasingly-nested amorphous blobs.
 *
 * Backward compat
 * ───────────────
 * node.group === node.groupPath[0]  (always set for existing 2-dim callers)
 * 1-dim and 2-dim behaviour is identical to before.
 *
 * @param {object}  data
 * @param {object}  opts
 * @param {number}  opts.minWeight
 * @param {number}  opts.topK
 * @param {string|null} opts.colorKey
 * @param {{min:number,max:number}} opts.colorStats
 * @param {string|null} opts.sizeKey
 * @param {boolean} opts.hideIsolated
 * @param {function|null} opts.colorFn  - (vals) => cssColor; bypasses gradient
 * @returns {{ nodes: object[], links: object[], isBlobMode: boolean }}
 */

import { filterEdgesToNodes } from "./filterUtils.js";
import { lerpColor } from "./colorUtils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively flatten an N-level pivot tree, returning all leaf rows.
 * A leaf row has depth === numDims-1 OR has no children.
 * The returned row objects have their original shape (key, depth, values, children)
 * with `key` already containing all ancestor dim values (as built by the backend).
 *
 * @param {object[]} rows     - top-level rows from API response
 * @param {number}   numDims  - total number of active dimensions
 * @returns {object[]}        - leaf rows (depth = numDims-1)
 */
export function flattenLeafRows(rows, numDims) {
  const result = [];
  function traverse(nodes) {
    for (const row of nodes) {
      const keyLen = Object.keys(row.key ?? {}).length;
      if (keyLen >= numDims) {
        // Key carries all N dim values → this is a leaf row
        result.push(row);
      } else if (row.children?.length) {
        // Intermediate row — recurse into children
        traverse(row.children);
      }
      // keyLen < numDims AND no children → empty group, skip
    }
  }
  traverse(rows ?? []);
  return result;
}

/**
 * Return a stable group key for a node at a given nesting level.
 * Joins the first `level+1` entries of groupPath with '::' so that sibling
 * groups at the same level share a distinct key.
 *
 * Examples (groupPath = ["core", "Parser"]):
 *   getGroupKey(node, 0)  → "core"           (outer blob)
 *   getGroupKey(node, 1)  → "core::Parser"   (inner blob)
 *
 * Falls back to node.group when groupPath is absent (1-dim nodes).
 *
 * @param {object} node
 * @param {number} level  0-indexed blob level
 * @returns {string}
 */
export function getGroupKey(node, level) {
  if (node.groupPath?.length > level) {
    return node.groupPath.slice(0, level + 1).join("::");
  }
  return node.group ?? "";
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildGraphData(data, {
  minWeight    = 1,
  topK         = 0,
  colorKey     = null,
  colorStats   = { min: 0, max: 1 },
  sizeKey      = null,
  hideIsolated = false,
  colorFn      = null,   // optional (vals) => cssColor override; bypasses gradient
} = {}) {
  if (!data?.rows) return { nodes: [], links: [], isBlobMode: false };

  const dims     = data?.dimensions ?? [];
  const N        = dims.length;
  const dim0     = dims[0];
  const isBlobMode = N >= 2;

  // ── Edge filtering ────────────────────────────────────────────────────────
  function filterEdges(raw, validIds) {
    let edges = [...(raw || [])];

    if (minWeight > 1) edges = edges.filter(e => e.weight >= minWeight);

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
    return filterEdgesToNodes(mapped, validIds);
  }

  // ── Colour ────────────────────────────────────────────────────────────────
  function makeColor(vals) {
    if (colorFn) return colorFn(vals);
    const t = colorKey
      ? Math.max(0, Math.min(1,
          (vals[colorKey] - colorStats.min) / (colorStats.max - colorStats.min)))
      : 0.5;
    return lerpColor("#3fb950", "#f85149", t);
  }

  // ── Blob mode (N ≥ 2 dims) ────────────────────────────────────────────────
  if (isBlobMode) {
    const leafDim  = dims[N - 1];    // innermost dim → node identity
    const leafRows = flattenLeafRows(data.rows, N);
    const maxSize  = Math.max(1, ...leafRows.map(r => r.values?.[sizeKey] || 0));

    // Deduplicate: same leaf-dim value may appear under multiple outer groups.
    // Keep the row whose sizeKey measure is highest.
    const byLeaf = new Map();
    for (const r of leafRows) {
      const leafVal = r.key[leafDim];
      const existing = byLeaf.get(leafVal);
      if (!existing || (r.values?.[sizeKey] || 0) > (existing.values?.[sizeKey] || 0))
        byLeaf.set(leafVal, r);
    }

    const nodes = [...byLeaf.values()].map(r => {
      const id        = r.key[leafDim];
      const vals      = r.values ?? {};
      const sz        = Math.sqrt((vals[sizeKey] || 1) / maxSize) * 18 + 4;
      // groupPath: one entry per non-leaf dim, in dim order.
      // e.g. dims=[module,class,symbol] → groupPath=[moduleVal, classVal]
      const groupPath = dims.slice(0, N - 1).map(d => r.key[d] ?? null);
      return {
        id,
        name:      id,
        values:    vals,
        groupPath,           // full ancestry for nested blob rendering
        group:     groupPath[0] ?? null,  // backward compat: outermost group
        val:       sz,
        color:     makeColor(vals),
      };
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
  const maxSize = Math.max(1, ...data.rows.map(r => r.values?.[sizeKey] || 0));
  const nodes   = data.rows.map(r => {
    const id   = r.key[dim0];
    const vals = r.values ?? {};
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
