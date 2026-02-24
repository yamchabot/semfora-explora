from ..judgement import P, Person
from ..z3_compat import And

# Engineering VP responsible for org-level architecture decisions.
# Cares about team ownership boundaries and cross-team coupling.
# Uses the graph to assess blast radius and make resource decisions.

ENGINEERING_VP = Person(
    name    = "Marcus",
    role    = "Engineering VP",
    pronoun = "he",
    goal    = "Assess module ownership, cross-team coupling, and whether the "
              "architecture supports the team structure.",
    formula = And(
        P.module_boundaries_clear,   # can draw team ownership lines
        P.dependencies_traceable,    # cross-team calls are visible
        P.modules_distinguishable,   # can identify each team's scope
        P.graph_is_navigable,        # can use it in a meeting without confusion
    ),
)
