/**
 * Layer 3: Satisfaction (Ego Layer)
 *
 * Models the user's judgement — separate from what they perceive.
 * You can perceive that a graph is crowded and be fine with it.
 * You can perceive clean clusters and still be unhappy (if you wanted a pipeline).
 *
 * Satisfaction is contextual and intentional. It asks:
 *   "Given what I was trying to do, am I happy with this?"
 *
 * This is implemented as a lightweight constraint satisfaction problem:
 *   - Variables: satisfaction dimensions (each can be satisfied/unsatisfied/unknown)
 *   - Constraints: rules that link perceptions + intent to satisfaction dimensions
 *   - Solve: forward-chain constraints, detect contradictions, report violations
 *
 * Usage:
 *   const result = satisfy(perceptions, INTENTS.TRACE_PIPELINE);
 *   result.satisfied   → boolean
 *   result.violations  → [{ constraint, reason, repair }]
 *   result.diagnosis   → string[]
 *   result.dimensions  → { readable: "satisfied", structural_fidelity: "unsatisfied", ... }
 */

// ---------------------------------------------------------------------------
// Intents — what is the user trying to accomplish?
// ---------------------------------------------------------------------------

export const INTENTS = {
  EXPLORE_ARCHITECTURE: "explore_architecture",  // understand module structure
  TRACE_PIPELINE:       "trace_pipeline",         // follow a specific call chain
  SPOT_HOTSPOTS:        "spot_hotspots",          // find high-connectivity / risky nodes
  COMPARE_VERSIONS:     "compare_versions",       // understand what changed between commits
  OVERVIEW:             "overview",               // general orientation, no specific goal
  DEBUG_FLOW:           "debug_flow",             // trace data/call flow to find a bug
  REVIEW_BOUNDARIES:    "review_boundaries",      // check cross-module coupling
};

// ---------------------------------------------------------------------------
// Satisfaction dimensions — what the user judges
// ---------------------------------------------------------------------------

export const DIMS = {
  READABLE:             "readable",               // can I read this at all?
  STRUCTURAL_FIDELITY:  "structural_fidelity",    // does layout reflect real code structure?
  VISUAL_COMFORT:       "visual_comfort",         // does it look good / not overwhelming?
  GOAL_ACHIEVABLE:      "goal_achievable",        // can I do what I came to do?
  TRUSTWORTHY:          "trustworthy",            // does the graph feel accurate / not misleading?
};

const SATISFIED   = "satisfied";
const UNSATISFIED = "unsatisfied";
const UNKNOWN     = "unknown";

// ---------------------------------------------------------------------------
// Constraint definitions
//
// Each constraint:
//   id       — unique name for debugging
//   when     — (perceptions, intent) => boolean — fires if true
//   implies  — { dimensionName: "satisfied" | "unsatisfied" }
//   reason   — human-readable diagnosis message
//   repair   — what perception(s) need to change to avoid this violation
// ---------------------------------------------------------------------------

const CONSTRAINTS = [

  // ── Readability ───────────────────────────────────────────────────────────

  {
    id: "crowding_kills_readability",
    when: (p) => p.graph_crowded,
    implies: { [DIMS.READABLE]: UNSATISFIED },
    reason: "Graph is too crowded — hard to find or follow individual nodes",
    repair: ["Reduce graph_crowded (increase node spacing, filter less important nodes)"],
  },
  {
    id: "invisible_edges_kill_readability",
    when: (p) => !p.edges_legible,
    implies: { [DIMS.READABLE]: UNSATISFIED },
    reason: "Edges are too short or crossed to be legible",
    repair: ["Improve edges_legible (increase link distance, reduce edge crossings)"],
  },
  {
    id: "hairball_kills_readability",
    when: (p) => p.edge_hairball,
    implies: { [DIMS.READABLE]: UNSATISFIED },
    reason: "Too many edge crossings — graph looks like a hairball",
    repair: ["Reduce edge_hairball (use hierarchical layout, filter edges by weight)"],
  },
  {
    id: "unbalanced_layout_hurts_readability",
    when: (p) => !p.layout_balanced,
    implies: { [DIMS.READABLE]: UNSATISFIED },
    reason: "Layout is spatially unbalanced — everything is collapsed to one area",
    repair: ["Improve layout_balanced (increase charge repulsion, spread initial positions)"],
  },
  {
    id: "readable_graph_satisfies_readability",
    when: (p) => p.graph_readable,
    implies: { [DIMS.READABLE]: SATISFIED },
    reason: null,
    repair: [],
  },

  // ── Visual comfort ────────────────────────────────────────────────────────

  {
    id: "non_crowded_is_comfortable",
    when: (p) => !p.graph_crowded && p.layout_balanced && !p.edge_hairball,
    implies: { [DIMS.VISUAL_COMFORT]: SATISFIED },
    reason: null,
    repair: [],
  },
  {
    id: "crowded_is_uncomfortable",
    when: (p) => p.graph_crowded && p.crowding_score > 0.7,
    implies: { [DIMS.VISUAL_COMFORT]: UNSATISFIED },
    reason: "Graph is severely crowded — visually exhausting to look at",
    repair: ["Reduce crowding_score below 0.7"],
  },
  {
    id: "hairball_is_uncomfortable",
    when: (p) => p.edge_hairball && p.hairball_score > 0.8,
    implies: { [DIMS.VISUAL_COMFORT]: UNSATISFIED },
    reason: "Extreme edge crossing density is visually overwhelming",
    repair: ["Reduce hairball_score below 0.8"],
  },

  // ── Structural fidelity ───────────────────────────────────────────────────

  {
    id: "clusters_visible_satisfies_fidelity",
    when: (p) => p.clusters_distinct && p.intra_group_cohesive,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: SATISFIED },
    reason: null,
    repair: [],
  },
  {
    id: "merged_clusters_kill_fidelity",
    when: (p) => p.clusters_merged,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: UNSATISFIED },
    reason: "Blob clusters are visually merged — module boundaries are not visible",
    repair: ["Fix clusters_merged (increase inter-group separation, check centripetal force strength)"],
  },
  {
    id: "incoherent_groups_kill_fidelity",
    when: (p) => !p.intra_group_cohesive,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: UNSATISFIED },
    reason: "Nodes don't stay in their groups — hard to tell where one module ends and another begins",
    repair: ["Fix intra_group_cohesive (strengthen blob containment force)"],
  },
  {
    id: "pipeline_not_visible_kills_fidelity",
    when: (p, intent) => intent === INTENTS.TRACE_PIPELINE && !p.pipeline_visible,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: UNSATISFIED },
    reason: "Pipeline nodes don't form a visible chain — call flow cannot be traced",
    repair: ["Increase pipeline_visible (stronger link force relative to centripetal, use pre-positioning)"],
  },
  {
    id: "hub_not_central_kills_fidelity",
    when: (p, intent) =>
      [INTENTS.SPOT_HOTSPOTS, INTENTS.DEBUG_FLOW].includes(intent) &&
      p.hub_degree_dominant === true &&
      !p.hub_central,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: UNSATISFIED },
    reason: "High-degree hub node is not visually central — it looks like a peripheral node",
    repair: ["Increase hub_central (reduce attractStrength so link force pulls hub to center)"],
  },
  {
    id: "direction_readable_helps_fidelity",
    when: (p, intent) =>
      [INTENTS.TRACE_PIPELINE, INTENTS.DEBUG_FLOW].includes(intent) &&
      p.direction_readable,
    implies: { [DIMS.STRUCTURAL_FIDELITY]: SATISFIED },
    reason: null,
    repair: [],
  },

  // ── Goal achievability ────────────────────────────────────────────────────

  {
    id: "unreadable_blocks_any_goal",
    when: (p) => !p.graph_readable,
    implies: { [DIMS.GOAL_ACHIEVABLE]: UNSATISFIED },
    reason: "Graph is not readable at all — no goal can be achieved",
    repair: ["Fix graph_readable first"],
  },
  {
    id: "pipeline_goal_requires_pipeline_visible",
    when: (p, intent) => intent === INTENTS.TRACE_PIPELINE && !p.pipeline_visible,
    implies: { [DIMS.GOAL_ACHIEVABLE]: UNSATISFIED },
    reason: "Cannot trace a pipeline when pipeline shape is not visible",
    repair: ["Increase pipeline_visible"],
  },
  {
    id: "architecture_goal_requires_distinct_clusters",
    when: (p, intent) => intent === INTENTS.EXPLORE_ARCHITECTURE && !p.clusters_distinct,
    implies: { [DIMS.GOAL_ACHIEVABLE]: UNSATISFIED },
    reason: "Cannot explore architecture when module clusters are not visually distinct",
    repair: ["Increase clusters_distinct"],
  },
  {
    id: "architecture_goal_satisfied_with_distinct_clusters",
    when: (p, intent) =>
      intent === INTENTS.EXPLORE_ARCHITECTURE &&
      p.clusters_distinct &&
      p.graph_readable,
    implies: { [DIMS.GOAL_ACHIEVABLE]: SATISFIED },
    reason: null,
    repair: [],
  },
  {
    id: "pipeline_goal_satisfied",
    when: (p, intent) => intent === INTENTS.TRACE_PIPELINE && p.pipeline_visible && p.edges_legible,
    implies: { [DIMS.GOAL_ACHIEVABLE]: SATISFIED },
    reason: null,
    repair: [],
  },
  {
    id: "hotspot_goal_requires_hub_visible",
    when: (p, intent) =>
      intent === INTENTS.SPOT_HOTSPOTS && p.hub_degree_dominant === true && !p.hub_central,
    implies: { [DIMS.GOAL_ACHIEVABLE]: UNSATISFIED },
    reason: "Cannot spot hotspot hub — it is not visually prominent",
    repair: ["Increase hub_central"],
  },
  {
    id: "boundary_review_requires_cross_edges_visible",
    when: (p, intent) =>
      intent === INTENTS.REVIEW_BOUNDARIES &&
      p.cross_boundary_count > 0 &&
      !p.cross_boundary_edges_visible,
    implies: { [DIMS.GOAL_ACHIEVABLE]: UNSATISFIED },
    reason: "Cross-module edges are buried inside group blobs — coupling cannot be reviewed",
    repair: ["Fix cross_boundary_edges_visible (increase inter-group separation)"],
  },
  {
    id: "overview_goal_satisfied",
    when: (p, intent) => intent === INTENTS.OVERVIEW && p.graph_readable && p.layout_balanced,
    implies: { [DIMS.GOAL_ACHIEVABLE]: SATISFIED },
    reason: null,
    repair: [],
  },

  // ── Trustworthiness ───────────────────────────────────────────────────────

  {
    id: "merged_clusters_make_graph_untrustworthy",
    when: (p) => p.clusters_merged,
    implies: { [DIMS.TRUSTWORTHY]: UNSATISFIED },
    reason: "Merged clusters make the graph look like it has different structure than the code",
    repair: ["Fix clusters_merged"],
  },
  {
    id: "pipeline_not_visible_makes_graph_untrustworthy",
    when: (p, intent) => intent === INTENTS.TRACE_PIPELINE && !p.pipeline_visible,
    implies: { [DIMS.TRUSTWORTHY]: UNSATISFIED },
    reason: "A pipeline that doesn't look like a pipeline feels like a wrong layout",
    repair: ["Increase pipeline_visible"],
  },
  {
    id: "balanced_readable_graph_is_trustworthy",
    when: (p) => p.graph_readable && !p.clusters_merged,
    implies: { [DIMS.TRUSTWORTHY]: SATISFIED },
    reason: null,
    repair: [],
  },
];

// ---------------------------------------------------------------------------
// CSP solver (forward-chaining inference)
// ---------------------------------------------------------------------------

/**
 * @param {object} perceptions  — output of perceive()
 * @param {string} intent       — one of INTENTS.*
 * @param {object} opts
 *   opts.extraConstraints  — additional constraint objects to include
 *   opts.requiredDims      — subset of DIMS to require SATISFIED (default: all)
 * @returns {{
 *   satisfied: boolean,
 *   dimensions: { [dim]: "satisfied"|"unsatisfied"|"unknown" },
 *   violations: Array<{ constraint, reason, repair }>,
 *   diagnosis: string[],
 *   summary: string,
 *   scores: { [dim]: number }
 * }}
 */
export function satisfy(perceptions, intent, opts = {}) {
  const { extraConstraints = [], requiredDims = Object.values(DIMS) } = opts;
  const allConstraints = [...CONSTRAINTS, ...extraConstraints];

  // Initialize all dimensions as unknown
  const dimensions = Object.fromEntries(Object.values(DIMS).map((d) => [d, UNKNOWN]));
  const violations = [];
  const firedConstraints = [];

  // Forward-chain: fire each constraint whose `when` is true
  for (const c of allConstraints) {
    if (!c.when(perceptions, intent)) continue;

    firedConstraints.push(c);
    const [[dim, val]] = Object.entries(c.implies);

    if (dimensions[dim] === UNKNOWN) {
      dimensions[dim] = val;
    } else if (dimensions[dim] !== val) {
      // Contradiction: two constraints disagree on this dimension
      violations.push({
        constraintId: c.id,
        reason: `CONTRADICTION on '${dim}': constraint '${c.id}' implies ${val} but prior constraints set ${dimensions[dim]}. ${c.reason ?? ""}`,
        repair: c.repair ?? [],
        dim,
        impliedValue: val,
        existingValue: dimensions[dim],
      });
    }
  }

  // Any dimension that was set UNSATISFIED counts as a violation
  for (const dim of requiredDims) {
    if (dimensions[dim] === UNSATISFIED) {
      // Find the constraint(s) that set it unsatisfied
      const causes = firedConstraints.filter(
        (c) => c.implies[dim] === UNSATISFIED && c.reason
      );
      for (const c of causes) {
        // Avoid duplicating violations already captured from contradictions
        if (!violations.find((v) => v.constraintId === c.id)) {
          violations.push({
            constraintId: c.id,
            reason: c.reason,
            repair: c.repair ?? [],
            dim,
          });
        }
      }
    }
  }

  // Unknown dimensions in requiredDims: treat as soft failure (doesn't block satisfied)
  // but report as a warning
  const unknownDims = requiredDims.filter((d) => dimensions[d] === UNKNOWN);

  const satisfied = violations.length === 0 &&
    requiredDims.every((d) => dimensions[d] !== UNSATISFIED) &&
    requiredDims.some((d) => dimensions[d] === SATISFIED);

  const diagnosis = violations.map((v) => v.reason);

  // Numeric scores for each dimension (for trend tracking)
  const dimValues = { [SATISFIED]: 1, [UNKNOWN]: 0.5, [UNSATISFIED]: 0 };
  const scores = Object.fromEntries(
    Object.entries(dimensions).map(([d, v]) => [d, dimValues[v] ?? 0.5])
  );
  const overallScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;

  const summary = satisfied
    ? `✅ Satisfied for intent '${intent}' (score: ${(overallScore * 100).toFixed(0)}/100)`
    : `❌ Unsatisfied for intent '${intent}': ${violations.length} violation(s) — ${diagnosis.slice(0, 2).join("; ")}`;

  return {
    satisfied,
    dimensions,
    violations,
    diagnosis,
    unknownDims,
    scores,
    overallScore,
    summary,
    firedConstraints: firedConstraints.map((c) => c.id),
  };
}

/**
 * Run satisfaction check against multiple intents and return per-intent results.
 * Useful for understanding which use-cases are broken by the current layout.
 */
export function satisfyAll(perceptions, intents = Object.values(INTENTS), opts = {}) {
  return Object.fromEntries(
    intents.map((intent) => [intent, satisfy(perceptions, intent, opts)])
  );
}

/**
 * Given a set of violations, return the minimal set of perceptions that need to change.
 * Groups repairs by perception name and deduplicates.
 */
export function repairPlan(violations) {
  const repairs = new Set();
  for (const v of violations) {
    for (const r of v.repair ?? []) repairs.add(r);
  }
  return [...repairs];
}
