// ── Measure descriptor utilities ───────────────────────────────────────────────
// Pure functions — no React, no DOM, fully unit-testable.

import {
  SPECIAL_LABELS,
  FIELD_META,
  DEFAULT_MEASURES,
} from "./exploreConstants.js";

/**
 * Canonical key for a measure — used as Map/object keys and React keys.
 * Special measures  → their special string  (e.g. "dead_ratio")
 * Field+agg measures → "field_agg"           (e.g. "caller_count_avg")
 */
export function measureKey(m) {
  return m.special ?? `${m.field}_${m.agg}`;
}

/**
 * URL-safe string for a measure — used in the `m=` search param.
 * Special measures  → their special string  (e.g. "dead_ratio")
 * Field+agg measures → "field:agg"           (e.g. "caller_count:avg")
 */
export function measureStr(m) {
  return m.special ?? `${m.field}:${m.agg}`;
}

/**
 * Human-readable label for a measure (column header, legend, etc.).
 */
export function measureLabel(m) {
  if (m.special) return SPECIAL_LABELS[m.special] ?? m.special;
  return FIELD_META[m.field]?.label ?? m.field;
}

/**
 * Format a numeric value for display given its measure type.
 * Returns a string (or number for integer types) — never JSX.
 * Callers that need a styled null placeholder should check for null themselves.
 *
 * Types:
 *   "ratio" → "42.1%"
 *   "float" → "0.034" or "3.40e-3" for very small values
 *   anything else → integer (Math.round)
 *
 * @param {number|null|undefined} value
 * @param {string} [type]
 * @returns {string|number|null}
 */
export function fmtValue(value, type) {
  if (value == null) return null;
  if (type === "ratio") return `${((value || 0) * 100).toFixed(1)}%`;
  if (type === "float") {
    const v = value || 0;
    return v !== 0 && v < 0.01 ? v.toExponential(2) : v.toFixed(3);
  }
  return Math.round(value);
}

/**
 * Parse the `m=` URL search param into an array of measure descriptor objects.
 * Falls back to DEFAULT_MEASURES when the param is absent or empty.
 * Silently drops unrecognised specials and unknown fields.
 *
 * @param {string|null} raw  - e.g. "dead_ratio,caller_count:avg,complexity:max"
 * @returns {Array<{special: string}|{field: string, agg: string}>}
 */
export function parseMeasuresParam(raw) {
  if (!raw) return DEFAULT_MEASURES;
  return raw
    .split(",")
    .filter(Boolean)
    .map(s => {
      if (SPECIAL_LABELS[s] !== undefined) return { special: s };
      if (s.includes(":")) {
        const colon = s.indexOf(":");
        return { field: s.slice(0, colon), agg: s.slice(colon + 1) };
      }
      return { special: s }; // will be filtered below
    })
    .filter(m =>
      m.special
        ? SPECIAL_LABELS[m.special] !== undefined
        : FIELD_META[m.field] !== undefined
    );
}
