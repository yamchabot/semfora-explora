// ── Colour utilities ───────────────────────────────────────────────────────────
// Pure functions — no React, no DOM, fully unit-testable.

/**
 * Clamp `n` to [0, 255] and return it as a zero-padded 2-char hex string.
 *
 * @param {number} n
 * @returns {string}  e.g. "0a", "ff"
 */
export function hex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/**
 * Linear interpolation between two hex colours.
 *
 * @param {string} a   - "#rrggbb" start colour
 * @param {string} b   - "#rrggbb" end colour
 * @param {number} t   - interpolation factor in [0, 1]
 * @returns {string}   - "#rrggbb" result
 */
export function lerpColor(a, b, t) {
  const parse = c => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  const ca = parse(a), cb = parse(b);
  return "#" + ca.map((v, i) => hex(v + (cb[i] - v) * t)).join("");
}

/**
 * Generate an N-step colour gradient from bright orange (#ff9500) to faint
 * cream (#fff4cc) — used for BFS fan-out edge highlighting.
 *
 * @param {number} n  - number of steps (depth levels)
 * @returns {string[]} - array of "rgb(...)" strings, length n
 */
export function makeStepColors(n) {
  const a = [255, 149,   0]; // #ff9500 (step 0 = direct neighbour)
  const b = [255, 244, 204]; // #fff4cc (step n-1 = farthest)
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  });
}

/**
 * Generate N edge widths, tapering from 2.8px (direct) to 0.65px (farthest).
 *
 * @param {number} n
 * @returns {number[]}
 */
export function makeStepWidths(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return 2.8 + (0.65 - 2.8) * t;
  });
}

/**
 * Generate N arrow sizes, tapering from 8px (direct) to 4px (farthest).
 *
 * @param {number} n
 * @returns {number[]}
 */
export function makeStepArrows(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n < 2 ? 0 : i / (n - 1);
    return Math.round(8 + (4 - 8) * t);
  });
}
