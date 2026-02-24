"""
perceptions.py  —  Layer 2: What the graph communicates

Translates raw layout measurements (pixels, ratios, distances) into
domain-level observations in the vocabulary of software engineering.

Rules:
  - No pixel values exposed past this layer
  - Every field is a boolean: "can a viewer perceive X?"
  - Thresholds are named constants at the top, not inline magic numbers
  - No imports from the application — only the raw facts dict as input

The facts dict is produced by layoutMetrics.js → computeFacts(), serialised
to JSON, and passed here. Field paths match the JS output exactly.
"""

from __future__ import annotations
from dataclasses import dataclass

# ── Thresholds (tune here, nowhere else) ─────────────────────────────────────

# Module structure
_MODULE_SEPARATION_WEAK   = 20    # px: can at least count the modules
_MODULE_SEPARATION_STRONG = 40    # px: clear visual boundary between modules
_BLOB_INTEGRITY_WEAK      = 0.85  # fraction of nodes inside their module
_BLOB_INTEGRITY_STRONG    = 0.92
_GESTALT_COHESION_MIN     = 0.50  # within-blob << between-blob distances

# Dependencies & coupling
_CROSS_EDGE_VISIBILITY    = 0.70  # fraction of cross-module edges that are visible
_CROSS_EDGE_STRONG        = 0.80  # stricter: needed for counting all coupling

# Call chains & flow
_CHAIN_LINEARITY          = 1.80  # elongation ratio: chain looks like a chain
_EDGE_VISIBILITY          = 0.80  # fraction of edges with a visible gap

# Hotspots & importance
_HUB_CENTRALITY_MAX       = 0.35  # normalised error: hub near centre of its callee cloud
_SIZE_VARIATION_MIN       = 0.25  # CV: node sizes encode meaning

# Cognitive load
_OVERLAP_NONE             = 0.02  # near-zero overlap: nodes are individually clickable
_CROSSING_DENSITY_MAX     = 0.40  # normalised crossings: graph doesn't look like a hairball
_LAYOUT_STRESS_MAX        = 1.50  # per-edge stress: spatial distance ≈ code coupling


# ── Perceptions dataclass ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class Perceptions:
    """
    What a viewer can observe about the graph.

    Each field answers a yes/no question a software professional would ask
    while looking at the graph. No pixels, no ratios — only observations.
    """

    # "Can I tell the modules apart?"
    modules_distinguishable: bool       # separate enough to count at a glance
    module_boundaries_clear: bool       # confident about where each module begins and ends
    module_membership_correct: bool     # nodes are visibly inside their own module

    # "Can I understand the dependencies?"
    dependencies_traceable: bool        # cross-module calls are visible and followable
    coupling_clearly_visible: bool      # all cross-boundary edges visible (for counting)

    # "Can I follow execution paths?"
    call_chains_readable: bool          # sequential call sequences look sequential
    edges_are_visible: bool             # edges between nodes are not hidden by overlap

    # "Can I spot what's important?"
    hotspots_identifiable: bool         # high-degree nodes are visually central and prominent
    node_importance_apparent: bool      # node size encodes something meaningful

    # "How hard is this to look at?"
    graph_is_navigable: bool            # no node overlap; I can click individual nodes
    layout_is_trustworthy: bool         # spatial proximity reflects actual code coupling
    not_a_hairball: bool                # edge crossings don't make tracing impossible


# ── Human-readable descriptions (used in failure explanations) ───────────────

DESCRIPTIONS: dict[str, str] = {
    # Phrased as infinitives so they read naturally after "he/she/they need(s) ..."
    "modules_distinguishable":   "modules to be visually distinct and countable at a glance",
    "module_boundaries_clear":   "module boundaries to be sharp — clearly where each one starts and ends",
    "module_membership_correct": "nodes to appear inside their own module's region",
    "dependencies_traceable":    "cross-module calls to be visible and followable",
    "coupling_clearly_visible":  "all cross-boundary edges to be visible for coupling analysis",
    "call_chains_readable":      "sequential call sequences to look like a linear chain",
    "edges_are_visible":         "edges between nodes to not be hidden by overlap",
    "hotspots_identifiable":     "high-degree nodes to be visually central and prominent",
    "node_importance_apparent":  "node sizes to encode meaningful importance",
    "graph_is_navigable":        "nodes to not overlap so individual ones can be clicked",
    "layout_is_trustworthy":     "spatial proximity to reflect actual code coupling",
    "not_a_hairball":            "edge crossings to be sparse enough to trace paths",
}


# ── Derivation from raw facts ─────────────────────────────────────────────────

def compute_perceptions(facts: dict) -> Perceptions:
    """
    Derive domain perceptions from the raw facts dict produced by
    layoutMetrics.js → computeFacts().

    This is the ONLY place that reads pixel values and ratios.
    Everything above this function sees only boolean observations.
    """
    sep      = facts["blobSeparation"]["minClearance"]   # None when only one module
    integr   = facts["blobIntegrity"]["ratio"]
    cohesion = facts["gestaltProximity"]["cohesion"]
    cross    = facts["crossModuleEdgeVisibility"]["ratio"]
    edge_vis = facts["edgeVisibility"]["ratio"]
    chain    = facts["chainLinearity"]["ratio"]
    hub      = facts["hubCentrality"]["avgNormalised"]
    overlap  = facts["nodeOverlap"]["ratio"]
    stress   = facts["layoutStress"]["perEdge"]
    crossings = facts["edgeCrossings"]["normalised"]
    size_cv  = facts["nodeSizeVariation"]["cv"]

    # Single-module layouts have no separation to measure — treat as trivially satisfied.
    single_module = sep is None

    return Perceptions(
        modules_distinguishable   = single_module or (
                                    sep     >  _MODULE_SEPARATION_WEAK
                                 and integr >= _BLOB_INTEGRITY_WEAK),
        module_boundaries_clear   = single_module or (
                                    sep     >= _MODULE_SEPARATION_STRONG
                                 and integr >= _BLOB_INTEGRITY_STRONG
                                 and cohesion >= _GESTALT_COHESION_MIN),
        module_membership_correct = integr  >= _BLOB_INTEGRITY_STRONG,

        dependencies_traceable    = single_module or (
                                    cross   >= _CROSS_EDGE_VISIBILITY
                                 and sep    >  _MODULE_SEPARATION_WEAK),
        coupling_clearly_visible  = single_module or (
                                    cross   >= _CROSS_EDGE_STRONG
                                 and sep    >= _MODULE_SEPARATION_STRONG),

        call_chains_readable      = chain   >= _CHAIN_LINEARITY
                                 and edge_vis >= _EDGE_VISIBILITY,
        edges_are_visible         = edge_vis >= _EDGE_VISIBILITY,

        hotspots_identifiable     = hub     <= _HUB_CENTRALITY_MAX
                                 and overlap <= _OVERLAP_NONE,
        node_importance_apparent  = size_cv >= _SIZE_VARIATION_MIN
                                 and overlap <= _OVERLAP_NONE,

        graph_is_navigable        = overlap <= _OVERLAP_NONE,
        layout_is_trustworthy     = stress  <= _LAYOUT_STRESS_MAX
                                 and overlap <= _OVERLAP_NONE,
        not_a_hairball            = crossings <= _CROSSING_DENSITY_MAX,
    )


def compute_reasons(facts: dict, perceptions: Perceptions) -> dict[str, str]:
    """
    For each perception that is False, explain which specific measurement fell short.
    Returns only entries for False perceptions. Values are plain English.
    """
    sep       = facts["blobSeparation"]["minClearance"]
    integr    = facts["blobIntegrity"]["ratio"]
    cohesion  = facts["gestaltProximity"]["cohesion"]
    cross     = facts["crossModuleEdgeVisibility"]["ratio"]
    edge_vis  = facts["edgeVisibility"]["ratio"]
    chain     = facts["chainLinearity"]["ratio"]
    hub       = facts["hubCentrality"]["avgNormalised"]
    overlap   = facts["nodeOverlap"]["ratio"]
    stress    = facts["layoutStress"]["perEdge"]
    crossings = facts["edgeCrossings"]["normalised"]
    size_cv   = facts["nodeSizeVariation"]["cv"]
    single    = sep is None

    reasons: dict[str, str] = {}

    def _parts(field, *checks):
        """Collect failing sub-checks and store as a joined reason."""
        parts = [msg for ok, msg in checks if not ok]
        if parts:
            reasons[field] = "; ".join(parts)

    if not single:
        if not perceptions.modules_distinguishable:
            _parts("modules_distinguishable",
                (sep > _MODULE_SEPARATION_WEAK,
                 f"module gap {sep:.0f}px < {_MODULE_SEPARATION_WEAK}px min"),
                (integr >= _BLOB_INTEGRITY_WEAK,
                 f"blob integrity {integr:.2f} < {_BLOB_INTEGRITY_WEAK} (nodes leaking between modules)"),
            )

        if not perceptions.module_boundaries_clear:
            _parts("module_boundaries_clear",
                (sep >= _MODULE_SEPARATION_STRONG,
                 f"module gap {sep:.0f}px < {_MODULE_SEPARATION_STRONG}px for clear boundary"),
                (integr >= _BLOB_INTEGRITY_STRONG,
                 f"blob integrity {integr:.2f} < {_BLOB_INTEGRITY_STRONG}"),
                (cohesion >= _GESTALT_COHESION_MIN,
                 f"gestalt cohesion {cohesion:.2f} < {_GESTALT_COHESION_MIN} (group feels loose)"),
            )

        if not perceptions.dependencies_traceable:
            _parts("dependencies_traceable",
                (cross >= _CROSS_EDGE_VISIBILITY,
                 f"only {cross:.0%} of cross-module edges visible (need {_CROSS_EDGE_VISIBILITY:.0%})"),
                (sep > _MODULE_SEPARATION_WEAK,
                 f"modules too close ({sep:.0f}px) to trace edges between them"),
            )

        if not perceptions.coupling_clearly_visible:
            _parts("coupling_clearly_visible",
                (cross >= _CROSS_EDGE_STRONG,
                 f"only {cross:.0%} of cross-module edges visible (need {_CROSS_EDGE_STRONG:.0%})"),
                (sep >= _MODULE_SEPARATION_STRONG,
                 f"module gap {sep:.0f}px < {_MODULE_SEPARATION_STRONG}px needed for edge clarity"),
            )

    if not perceptions.module_membership_correct:
        reasons["module_membership_correct"] = (
            f"blob integrity {integr:.2f} < {_BLOB_INTEGRITY_STRONG} "
            f"({(1-integr)*100:.0f}% of nodes outside their module's region)"
        )

    if not perceptions.call_chains_readable:
        _parts("call_chains_readable",
            (chain >= _CHAIN_LINEARITY,
             f"chain elongation {chain:.2f} < {_CHAIN_LINEARITY} (chain looks round, not linear)"),
            (edge_vis >= _EDGE_VISIBILITY,
             f"edge visibility {edge_vis:.0%} < {_EDGE_VISIBILITY:.0%} (edges obscured)"),
        )

    if not perceptions.edges_are_visible:
        reasons["edges_are_visible"] = (
            f"only {edge_vis:.0%} of edges have a visible gap (need {_EDGE_VISIBILITY:.0%})"
        )

    if not perceptions.hotspots_identifiable:
        _parts("hotspots_identifiable",
            (hub <= _HUB_CENTRALITY_MAX,
             f"hub centrality error {hub:.2f} > {_HUB_CENTRALITY_MAX} (hubs not near center of callee cloud)"),
            (overlap <= _OVERLAP_NONE,
             f"node overlap {overlap:.0%} > {_OVERLAP_NONE:.0%} (nodes obscuring each other)"),
        )

    if not perceptions.node_importance_apparent:
        _parts("node_importance_apparent",
            (size_cv >= _SIZE_VARIATION_MIN,
             f"node size variation CV {size_cv:.2f} < {_SIZE_VARIATION_MIN} (all nodes look the same size)"),
            (overlap <= _OVERLAP_NONE,
             f"node overlap {overlap:.0%} hides size differences"),
        )

    if not perceptions.graph_is_navigable:
        reasons["graph_is_navigable"] = (
            f"node overlap {overlap:.0%} > {_OVERLAP_NONE:.0%} (nodes stacked, can't click individually)"
        )

    if not perceptions.layout_is_trustworthy:
        _parts("layout_is_trustworthy",
            (stress <= _LAYOUT_STRESS_MAX,
             f"layout stress {stress:.2f} > {_LAYOUT_STRESS_MAX} (distances don't match coupling)"),
            (overlap <= _OVERLAP_NONE,
             f"node overlap {overlap:.0%} distorts spatial meaning"),
        )

    if not perceptions.not_a_hairball:
        reasons["not_a_hairball"] = (
            f"normalised edge crossings {crossings:.2f} > {_CROSSING_DENSITY_MAX} "
            f"(too many crossing edges to trace paths)"
        )

    return reasons
