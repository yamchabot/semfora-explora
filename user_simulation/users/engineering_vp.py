from ..judgement import P, Person
from ..z3_compat import And, Implies

# Engineering VP responsible for org-level architecture decisions.
# Uses the graph to assess team ownership boundaries, blast radius,
# and cross-team coupling. Needs to count and attribute dependencies.

ENGINEERING_VP = Person(
    name    = "Marcus",
    role    = "Engineering VP",
    pronoun = "he",
    goal    = "Assess module ownership, cross-team coupling, and whether the "
              "architecture supports the team structure.",
    formula = And(
        P.module_count            >= 2,     # must see distinct teams' scopes
        P.blob_integrity          >= 0.92,  # nodes visibly inside their team's region
        P.module_separation       >= 40.0,  # can draw ownership lines with confidence
        P.cross_edge_visibility   >= 0.80,  # can count all cross-team dependencies
        P.silhouette_by_module    >= 0.40,  # sklearn confirms teams are spatially distinct
    ),
)
