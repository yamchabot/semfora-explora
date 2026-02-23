// ── Dimension utilities ────────────────────────────────────────────────────────
// Pure functions — no React, no DOM, fully unit-testable.

import {
  BUCKET_MODES,
  DIM_LABELS,
  BUCKET_FIELDS_META,
} from "./exploreConstants.js";

/**
 * Parse a dimension string into its bucketed components.
 * Returns `{ field, mode }` for valid bucketed dims (e.g. "caller_count:quartile"),
 * or `null` for plain dims (e.g. "module") and unrecognised mode strings.
 *
 * @param {string} d
 * @returns {{ field: string, mode: string }|null}
 */
export function parseBucketedDim(d) {
  if (!d.includes(":")) return null;
  const colon = d.indexOf(":");
  const field  = d.slice(0, colon);
  const mode   = d.slice(colon + 1);
  return BUCKET_MODES.includes(mode) ? { field, mode } : null;
}

/**
 * Human-readable label for a dimension string.
 * - Known plain dims → DIM_LABELS lookup
 * - Bucketed dims → "callers (quartile)" etc.
 * - Unknown plain dims → returned as-is
 *
 * @param {string} d
 * @returns {string}
 */
export function dimDisplayLabel(d) {
  if (DIM_LABELS[d]) return DIM_LABELS[d];
  if (d.includes(":")) {
    const colon = d.indexOf(":");
    const field = d.slice(0, colon);
    const mode  = d.slice(colon + 1);
    const base  = BUCKET_FIELDS_META[field] ?? field;
    return `${base} (${mode})`;
  }
  return d;
}

/**
 * Parse the `f=` URL search param (JSON-encoded filter array).
 * Returns an empty array on missing, empty, or malformed input.
 *
 * @param {string|null} raw
 * @returns {Array}
 */
export function parseFiltersParam(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
