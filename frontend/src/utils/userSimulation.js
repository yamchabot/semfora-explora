/**
 * userSimulation.js
 *
 * Constraint-satisfaction system for simulating different user types.
 *
 * Each user archetype is a set of simple predicates over layout facts.
 * The test asks: "given this layout, can this user accomplish their goal?"
 *
 * Usage:
 *   const facts  = computeFacts(nodes, links);
 *   const result = checkUser(USERS.debugTracer, facts);
 *   if (!result.satisfied) console.log(formatFailures(result));
 *
 * Adding a new user type:
 *   1. Define constraints using existing fact paths (or add new facts to layoutMetrics.js)
 *   2. Add the archetype to USERS
 *   3. Any new fact paths needed → add to computeFacts() in layoutMetrics.js
 */

// ── Constraint operators ──────────────────────────────────────────────────────

const OPS = {
  '>':  (a, b) => a >  b,
  '>=': (a, b) => a >= b,
  '<':  (a, b) => a <  b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => Math.abs(a - b) < 1e-9,
  '~0': (a, _) => Math.abs(a)     < 1e-9,   // effectively zero
};

// ── Fact accessor — dot-notation path into the facts object ──────────────────

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ── Core: check a single constraint ──────────────────────────────────────────

/**
 * Check one constraint against the facts.
 * Returns { passed, actual, gap, gapFraction }.
 *
 * gap         = actual - threshold  (negative = below threshold for '>' constraints)
 * gapFraction = gap / |threshold|   (relative severity; -1.0 = completely missing)
 */
function checkConstraint(constraint, facts) {
  const actual    = getPath(facts, constraint.fact);
  const threshold = constraint.threshold ?? 0;
  const op        = OPS[constraint.op];

  if (actual == null || op == null) {
    return { passed: false, actual: null, gap: null, gapFraction: null, missing: true };
  }

  const passed = op(actual, threshold);

  // Gap: signed distance to threshold in the "good" direction
  // For '>' constraints: gap = actual - threshold (positive = passing, negative = failing)
  // For '<' constraints: gap = threshold - actual
  let gap;
  if (constraint.op === '>'  || constraint.op === '>=') gap = actual - threshold;
  else if (constraint.op === '<'  || constraint.op === '<=') gap = threshold - actual;
  else gap = actual - threshold; // '==' and '~0'

  const gapFraction = Math.abs(threshold) > 1e-9 ? gap / Math.abs(threshold) : (passed ? 1 : -1);

  return { passed, actual, gap, gapFraction };
}

// ── Core: check all constraints for a user ───────────────────────────────────

/**
 * Check every constraint in a user archetype against computed layout facts.
 *
 * Returns a rich result object:
 * {
 *   userId, userName, goal,
 *   satisfied     bool    — all constraints pass
 *   score         0–1     — fraction of constraints passing
 *   failures      []      — constraints that failed, sorted by severity
 *   nearMisses    []      — passing constraints within 10% of threshold
 *   passing       []      — comfortably passing constraints
 * }
 *
 * Each entry in failures/nearMisses/passing has:
 * {
 *   constraint    — the original constraint object
 *   actual        — measured value
 *   gap           — signed distance to threshold
 *   gapFraction   — relative gap (-1 = completely failing, 0 = at threshold)
 *   severity      — from constraint definition
 * }
 */
export function checkUser(user, facts) {
  const failures  = [];
  const nearMisses = [];
  const passing   = [];

  for (const c of user.constraints) {
    const { passed, actual, gap, gapFraction, missing } = checkConstraint(c, facts);
    const entry = { constraint: c, actual, gap, gapFraction, severity: c.severity ?? 'major', missing };

    if (!passed) {
      failures.push(entry);
    } else if (gapFraction < 0.10) {
      nearMisses.push(entry); // passing but within 10% of threshold
    } else {
      passing.push(entry);
    }
  }

  // Sort failures by severity then by how badly they're failing
  const severityOrder = { critical: 0, major: 1, minor: 2 };
  failures.sort((a, b) => {
    const sd = (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1);
    return sd !== 0 ? sd : (a.gapFraction ?? 0) - (b.gapFraction ?? 0);
  });

  return {
    userId:    user.id,
    userName:  user.name,
    goal:      user.goal,
    satisfied: failures.length === 0,
    score:     user.constraints.length
      ? (user.constraints.length - failures.length) / user.constraints.length
      : 1,
    failures,
    nearMisses,
    passing,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Format a satisfaction result as a human-readable string.
 * Used in test output when a simulation fails.
 */
export function formatResult(result) {
  const lines = [
    `User: ${result.userName}`,
    `Goal: ${result.goal}`,
    `Satisfied: ${result.satisfied ? '✅ YES' : '❌ NO'} (${Math.round(result.score * 100)}% of constraints met)`,
  ];

  if (result.failures.length) {
    lines.push('\nFailed constraints:');
    for (const f of result.failures) {
      const actual = f.actual == null ? 'MISSING' : f.actual.toFixed(3);
      const pct    = f.gapFraction != null ? ` (${(f.gapFraction * 100).toFixed(0)}% from threshold)` : '';
      lines.push(
        `  [${f.severity.toUpperCase()}] ${f.constraint.name}` +
        `\n    "${f.constraint.description}"` +
        `\n    need: ${f.constraint.fact} ${f.constraint.op} ${f.constraint.threshold}` +
        `\n    got:  ${actual}${pct}`
      );
    }
  }

  if (result.nearMisses.length) {
    lines.push('\nNear misses (within 10% of threshold):');
    for (const m of result.nearMisses) {
      lines.push(`  ⚠️  ${m.constraint.name}: ${m.actual?.toFixed(3)} (threshold: ${m.constraint.threshold})`);
    }
  }

  return lines.join('\n');
}

/**
 * Run all user types against the same facts and return a summary table.
 * Useful for at-a-glance comparison of which users are satisfied.
 */
export function checkAllUsers(facts, users = Object.values(USERS)) {
  return users.map(u => {
    const r = checkUser(u, facts);
    return {
      userId:    r.userId,
      userName:  r.userName,
      satisfied: r.satisfied,
      score:     r.score,
      failCount: r.failures.length,
      topFailure: r.failures[0]?.constraint?.name ?? null,
    };
  });
}

// ── User archetypes ───────────────────────────────────────────────────────────

export const USERS = {

  quickGlancer: {
    id:   'quick_glancer',
    name: 'Quick Glancer',
    goal: 'Get a fast overview of the codebase structure — modules, rough size, rough shape. Spends < 30 seconds.',
    constraints: [
      {
        name:        'blobs_not_touching',
        description: 'Module blobs are visually separated — user can count distinct modules at a glance',
        fact:        'blobSeparation.minClearance',
        op:          '>',
        threshold:   20,
        severity:    'critical',
      },
      {
        name:        'nodes_dont_obscure_each_other',
        description: 'No two node circles overlap — the graph doesn\'t look like a dense smear',
        fact:        'nodeOverlap.ratio',
        op:          '~0',
        threshold:   0,
        severity:    'critical',
      },
      {
        name:        'blobs_are_cohesive_groups',
        description: 'Nodes within a blob are clearly closer to each other than to nodes in other blobs',
        fact:        'gestaltProximity.cohesion',
        op:          '>',
        threshold:   0.40,
        severity:    'major',
      },
      {
        name:        'nodes_mostly_in_correct_blob',
        description: 'At least 90% of nodes are inside their assigned module boundary',
        fact:        'blobIntegrity.ratio',
        op:          '>',
        threshold:   0.90,
        severity:    'major',
      },
    ],
  },

  architectureReviewer: {
    id:   'architecture_reviewer',
    name: 'Architecture Reviewer',
    goal: 'Understand module dependency structure — what calls what across module boundaries, layering, blast radius of changes.',
    constraints: [
      {
        name:        'module_blobs_clearly_separated',
        description: 'Module blobs have enough clearance to draw clear visual boundaries between them',
        fact:        'blobSeparation.minClearance',
        op:          '>',
        threshold:   50,
        severity:    'critical',
      },
      {
        name:        'cross_module_edges_visible',
        description: 'Edges that cross module boundaries are visible — the inter-module coupling is readable',
        fact:        'crossModuleEdgeVisibility.ratio',
        op:          '>',
        threshold:   0.70,
        severity:    'critical',
      },
      {
        name:        'high_blob_integrity',
        description: 'Nodes are firmly inside their module blob — misplaced nodes cause false coupling reads',
        fact:        'blobIntegrity.ratio',
        op:          '>',
        threshold:   0.95,
        severity:    'major',
      },
      {
        name:        'strong_gestalt_grouping',
        description: 'Modules read as distinct visual units — within-blob distance << between-blob distance',
        fact:        'gestaltProximity.cohesion',
        op:          '>',
        threshold:   0.60,
        severity:    'major',
      },
      {
        name:        'low_edge_crossing_density',
        description: 'Not too many crossing edges — crossing edges make it hard to trace which module calls which',
        fact:        'edgeCrossings.normalised',
        op:          '<',
        threshold:   0.30,
        severity:    'minor',
      },
    ],
  },

  debugTracer: {
    id:   'debug_tracer',
    name: 'Debug Tracer',
    goal: 'Follow call chains through the system — trace how a request flows, identify bottlenecks and hubs.',
    constraints: [
      {
        name:        'edges_are_visible',
        description: 'The gap between node surfaces is large enough to see the edge line clearly',
        fact:        'edgeVisibility.ratio',
        op:          '>',
        threshold:   0.85,
        severity:    'critical',
      },
      {
        name:        'no_node_overlap',
        description: 'Nodes don\'t overlap — tracer needs to click individual nodes for BFS fan-out',
        fact:        'nodeOverlap.ratio',
        op:          '~0',
        threshold:   0,
        severity:    'critical',
      },
      {
        name:        'call_chains_look_like_chains',
        description: 'Linear call sequences (A→B→C→D) are elongated, not collapsed into a ball',
        fact:        'chainLinearity.ratio',
        op:          '>',
        threshold:   1.80,
        severity:    'major',
      },
      {
        name:        'hubs_are_central',
        description: 'High-degree nodes (dispatchers, routers) sit near the centroid of their callee cloud',
        fact:        'hubCentrality.avgNormalised',
        op:          '<',
        threshold:   0.35,
        severity:    'major',
      },
      {
        name:        'edges_distinguishable_at_nodes',
        description: 'Edges meet nodes at wide enough angles that tracer can tell which edge goes where',
        fact:        'angularResolution.minAngle',
        op:          '>',
        threshold:   15,
        severity:    'minor',
      },
    ],
  },

  complexityAuditor: {
    id:   'complexity_auditor',
    name: 'Complexity Auditor',
    goal: 'Find hotspots, dead code, and risky functions — uses node size and color to identify problems.',
    constraints: [
      {
        name:        'no_node_overlap',
        description: 'Every node is individually visible — overlapping nodes hide complexity signals',
        fact:        'nodeOverlap.ratio',
        op:          '~0',
        threshold:   0,
        severity:    'critical',
      },
      {
        name:        'prominent_nodes_unobscured',
        description: 'The largest (highest-complexity) nodes are not hidden behind other nodes',
        fact:        'prominentNodeVisibility.ratio',
        op:          '>',
        threshold:   0.85,
        severity:    'critical',
      },
      {
        name:        'meaningful_size_variation',
        description: 'Node sizes vary enough that size encodes information — not all nodes look the same',
        fact:        'nodeSizeVariation.cv',
        op:          '>',
        threshold:   0.30,
        severity:    'major',
      },
      {
        name:        'edges_partially_visible',
        description: 'Enough edges visible to understand connectivity context around complex nodes',
        fact:        'edgeVisibility.ratio',
        op:          '>',
        threshold:   0.70,
        severity:    'minor',
      },
    ],
  },

  newContributor: {
    id:   'new_contributor',
    name: 'New Contributor',
    goal: 'Orient in an unfamiliar codebase — find the main modules, understand structure, locate entry points.',
    constraints: [
      {
        name:        'modules_visually_distinct',
        description: 'Module blobs are separated and cohesive — contributor can name the modules at a glance',
        fact:        'blobSeparation.minClearance',
        op:          '>',
        threshold:   30,
        severity:    'critical',
      },
      {
        name:        'structure_not_distorted',
        description: 'Layout stress is low — the graph distances roughly match the call-graph distances',
        fact:        'layoutStress.perEdge',
        op:          '<',
        threshold:   1.50,
        severity:    'major',
      },
      {
        name:        'blobs_read_as_groups',
        description: 'Nodes cluster visually by module — contributor can identify groupings without labels',
        fact:        'gestaltProximity.cohesion',
        op:          '>',
        threshold:   0.50,
        severity:    'major',
      },
      {
        name:        'no_node_overlap',
        description: 'All nodes individually visible — overlapping nodes make the graph unreadable to newcomers',
        fact:        'nodeOverlap.ratio',
        op:          '~0',
        threshold:   0,
        severity:    'major',
      },
      {
        name:        'nodes_in_correct_module',
        description: 'Nodes are inside their module blob — misplaced nodes send the contributor to the wrong module',
        fact:        'blobIntegrity.ratio',
        op:          '>',
        threshold:   0.90,
        severity:    'major',
      },
    ],
  },

};
