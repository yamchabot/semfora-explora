// ── Shared constants for the Explore page ─────────────────────────────────────
// Centralised here so utils modules (measureUtils, dimUtils, …) and the page
// component can import from a single source without circular dependencies.

export const SPECIAL_LABELS = {
  symbol_count:    "symbol count",
  dead_ratio:      "dead ratio",
  high_risk_ratio: "high-risk %",
  in_cycle_ratio:  "in-cycle %",
};

export const FIELD_META = {
  caller_count: { label: "callers",     enriched: false },
  callee_count: { label: "callees",     enriched: false },
  complexity:   { label: "complexity",  enriched: false },
  utility:      { label: "utility",     enriched: true  },
  pagerank:     { label: "pagerank",    enriched: true  },
  xmod_fan_in:  { label: "xmod_fan_in", enriched: true  },
  topo_depth:   { label: "topo_depth",  enriched: true  },
  betweenness:  { label: "betweenness", enriched: true  },
};

export const AGGS = ["avg", "min", "max", "sum", "stddev", "count"];

export const BUCKET_MODES = ["median", "quartile", "decile"];

export const DIM_LABELS = {
  module:    "module",
  risk:      "risk",
  kind:      "kind",
  symbol:    "symbol",
  dead:      "dead/alive",
  high_risk: "high-risk",
  in_cycle:  "in-cycle ✦",
  community: "community ✦",
};

export const BUCKET_FIELDS_META = {
  caller_count:    "callers",
  callee_count:    "callees",
  complexity:      "complexity",
  dead_ratio:      "dead ratio",
  high_risk_ratio: "high-risk ratio",
  in_cycle_ratio:  "in-cycle ratio ✦",
  pagerank:        "pagerank ✦",
  utility:         "utility ✦",
  xmod_fan_in:     "xmod_fan_in ✦",
  betweenness:     "betweenness ✦",
};

export const DEFAULT_DIMS = ["module"];

export const DEFAULT_MEASURES = [
  { special: "symbol_count" },
  { special: "dead_ratio"   },
  { field: "caller_count", agg: "avg" },
];
