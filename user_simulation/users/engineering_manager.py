from ..judgement import P, Person
from ..z3_compat import And

# Engineering manager responsible for a specific team and module.
# Needs to understand their team's code and how it fits into the larger system.
# Uses the graph to explain scope to stakeholders and plan work.

ENGINEERING_MANAGER = Person(
    name    = "Priya",
    role    = "Engineering Manager",
    pronoun = "she",
    goal    = "Understand their team's module clearly and see what it depends "
              "on and what depends on it.",
    formula = And(
        P.module_boundaries_clear,   # can clearly identify their team's module
        P.dependencies_traceable,    # can see what calls in and out
        P.graph_is_navigable,        # can navigate without getting lost
    ),
)
