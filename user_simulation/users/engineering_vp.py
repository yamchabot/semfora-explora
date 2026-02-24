from ..judgement import P, Person
from ..z3_compat import And, Implies

# Engineering VP responsible for org-level architecture decisions.
# Uses the graph to assess team ownership boundaries, blast radius,
# and cross-team coupling. Needs to count and attribute dependencies.
#
# Single-module graphs: one team owns everything — trivially readable,
# no cross-team coupling to worry about. Marcus is satisfied because
# the question answers itself. Only multi-module graphs need the full
# ownership-boundaries treatment.

ENGINEERING_VP = Person(
    name    = "Marcus",
    role    = "Engineering VP",
    pronoun = "he",
    goal    = "Assess module ownership, cross-team coupling, and whether the "
              "architecture supports the team structure.",
    formula = And(
        # Multi-module: must see distinct, well-separated team scopes
        Implies(P.module_count >= 2, P.blob_integrity        >= 0.92),
        Implies(P.module_count >= 2, P.module_separation     >= 40.0),
        Implies(P.module_count >= 2, P.cross_edge_visibility >= 0.80),
        Implies(P.module_count >= 2, P.silhouette_by_module  >= 0.40),
        # Single-module: at least the graph must be legible
        P.node_overlap  <= 0.02,
        P.edge_visibility >= 0.70,
    ),
)
