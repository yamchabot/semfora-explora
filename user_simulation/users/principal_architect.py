from ..judgement import P, Person
from ..z3_compat import And, Implies

# Principal software architect verifying the implementation matches the design.
# Looks for layer violations, unexpected coupling, and module drift.
# Highest standards — she audits the graph, not just browses it.
# Her constraint: if spatial layout is untrustworthy, edge visibility must compensate.

PRINCIPAL_ARCHITECT = Person(
    name    = "Fatima",
    role    = "Principal Software Architect",
    pronoun = "she",
    goal    = "Verify the code structure matches the intended architecture — "
              "check for layer violations, unexpected coupling, and module drift.",
    formula = And(
        P.blob_integrity          >= 0.92,  # symbols are inside their correct module
        P.cross_edge_visibility   >= 0.80,  # all cross-module dependencies are countable
        P.layout_stress           <= 1.50,  # spatial proximity reflects actual coupling
        P.hub_centrality_error    <= 0.35,  # high-connectivity nodes stand out
        P.silhouette_by_module    >= 0.50,  # sklearn: module blobs are genuinely well-separated
        P.spatial_cluster_purity  >= 0.60,  # KMeans on positions recovers the module structure
        # Multi-module systems must have clear visual boundaries
        Implies(P.module_count >= 2, P.module_separation >= 40.0),
        # When layout stress is elevated, edge visibility must compensate
        Implies(P.layout_stress > 1.20, P.cross_edge_visibility >= 0.90),
        # When degree distribution is highly skewed, the hub must be visually central
        Implies(P.degree_gini > 0.50, P.hub_centrality_error <= 0.25),
    ),
)
