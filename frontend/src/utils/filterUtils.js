/**
 * filterUtils.js — client-side row filtering + graph edge validation for the Explore page.
 *
 * Filter types:
 *   { kind: "dim",     field, mode: "exclude"|"include"|"regex", values: [], pattern: "" }
 *   { kind: "measure", mkey, expr }
 *
 * matchExpr patterns  (all case-insensitive for the numeric comparison):
 *   > N   >= N   < N   <= N   = N   == N   != N   ! N
 *   N..M      (inclusive range)
 *   !N..M     (outside range)
 */

/**
 * Test a single numeric value against an expression string.
 * Returns true (pass) when:
 *   - expr is empty / whitespace
 *   - val is null or undefined
 *   - expression matches
 * Returns false when expression is set, val is a number, and the expression fails.
 */
export function matchExpr(val, expr) {
  const s = expr?.trim();
  if (!s) return true;          // no filter → pass
  if (val == null) return true; // null/undefined → pass (don't filter unknowns)

  try {
    let m;

    // N..M  (inclusive range)
    m = s.match(/^([\d.]+)\.\.([\d.]+)$/);
    if (m) return +val >= +m[1] && +val <= +m[2];

    // !N..M  (outside range)
    m = s.match(/^!([\d.]+)\.\.([\d.]+)$/);
    if (m) return +val < +m[1] || +val > +m[2];

    // Comparison operators: > >= < <= = == != !
    // [><=!] matches the first char; =? optionally grabs a second =
    m = s.match(/^([><=!]=?)\s*([\d.]+)$/);
    if (m) {
      const [, op, n] = m;
      const v = +n;
      const x = +val;
      if (op === ">")           return x > v;
      if (op === ">=")          return x >= v;
      if (op === "<")           return x < v;
      if (op === "<=")          return x <= v;
      if (op === "=" || op === "==") return x === v;
      if (op === "!" || op === "!=") return x !== v;
    }
  } catch (_) {
    // Malformed expression → pass
  }

  // Unknown pattern → pass (safe default: don't filter on unrecognised syntax)
  return true;
}

/**
 * Apply an array of filters to a flat or nested row list.
 *
 * Rows are top-level pivot rows:  { key: {dim: value, ...}, values: {mkey: num, ...}, children: [] }
 *
 * Dim filters operate on row.key[field].
 * Measure filters operate on row.values[mkey].
 *
 * Children are filtered separately and kept in the returned row only if they
 * pass all child-applicable filters. A parent row is retained whenever it has
 * at least one surviving child OR it passes the filters itself.
 */
export function applyFilters(rows, filters) {
  if (!filters || !filters.length) return rows;

  /** Test a single row against a single filter (without recursing). */
  function testRow(row, f) {
    if (f.kind === "dim") {
      const val = String(row.key?.[f.field] ?? "");

      if (f.mode === "exclude") {
        if (f.values.length > 0 && f.values.includes(val)) return false;
        return true;
      }

      if (f.mode === "include") {
        // If the dim is not in this row's key, we can't filter — let it pass.
        if (!(f.field in (row.key ?? {}))) return true;
        if (f.values.length > 0 && !f.values.includes(val)) return false;
        return true;
      }

      if (f.mode === "regex") {
        if (!f.pattern) return true; // empty pattern → pass
        // If the dim is not present in this row's key at all, we have no data
        // to filter on — let the row pass rather than silently removing it.
        if (!(f.field in (row.key ?? {}))) return true;
        try {
          return new RegExp(f.pattern, "i").test(val);
        } catch {
          return true; // invalid regex → pass
        }
      }

      return true; // unknown mode → pass
    }

    if (f.kind === "measure") {
      return matchExpr(row.values?.[f.mkey], f.expr);
    }

    return true; // unknown filter kind → pass
  }

  /** Test a row against ALL filters. */
  function rowPasses(row) {
    return filters.every(f => testRow(row, f));
  }

  return rows
    .map(row => {
      // Filter children first (if present)
      if (row.children && row.children.length > 0) {
        const filteredChildren = row.children.filter(child => rowPasses(child));
        const parentPasses     = rowPasses(row);
        // Keep parent only when it passes AND at least one child survives.
        if (!parentPasses || filteredChildren.length === 0) return null;
        return { ...row, children: filteredChildren };
      }
      // Leaf row
      return rowPasses(row) ? row : null;
    })
    .filter(Boolean);
}

/**
 * filterEdgesToNodes — drop any edge whose source or target is not in validNodeIds.
 *
 * react-force-graph-2d / d3 throws "node not found" when a link references a
 * node ID that isn't in the nodes array. This must be called after the node
 * list is filtered so that edges stay consistent with the visible node set.
 *
 * @param {Array<{source: string, target: string, value?: number}>} edges
 * @param {Set<string>|Array<string>} validNodeIds  — the IDs of nodes that will be rendered
 * @returns {Array}  edges where both endpoints are present
 */
export function filterEdgesToNodes(edges, validNodeIds) {
  if (!edges || edges.length === 0) return [];
  const valid = validNodeIds instanceof Set ? validNodeIds : new Set(validNodeIds);
  return edges.filter(e => {
    // d3 mutates source/target from string → node object after first tick.
    // Normalise both cases so filtering is safe regardless of call timing.
    const src = typeof e.source === "object" ? e.source?.id : e.source;
    const tgt = typeof e.target === "object" ? e.target?.id : e.target;
    return valid.has(src) && valid.has(tgt);
  });
}
