from ..judgement import P, Person
from ..z3_compat import And, Implies

# Staff engineer hunting for architectural problems and refactoring opportunities.
# Technically sophisticated — uses the graph to find over-coupled modules,
# assess blast radius, and build the case for structural changes.
# His constraint: tightly coupled systems demand greater visual clarity.

STAFF_ENGINEER = Person(
    name    = "Kenji",
    role    = "Staff Engineer",
    pronoun = "he",
    goal    = "Identify tightly coupled modules, trace cross-boundary dependencies, "
              "and find nodes worth refactoring.",
    formula = And(
        P.blob_integrity          >= 0.92,  # precise module scopes
        P.cross_edge_visibility   >= 0.80,  # can count all cross-module calls
        P.hub_centrality_error    <= 0.35,  # over-connected nodes are visually prominent
        P.layout_stress           <= 1.50,  # spatial distance reflects actual coupling
        P.silhouette_by_module    >= 0.40,  # sklearn confirms modules are spatially cohesive
        # Heavy cross-module coupling → modules must be pushed further apart to read
        Implies(P.cross_edge_count >= 3, P.module_separation >= 50.0),
        # When degree distribution is top-heavy, the dominant node must be visually central
        Implies(P.degree_gini > 0.50, P.hub_centrality_error <= 0.25),
    ),
)
