from ..judgement import P, Person
from ..z3_compat import And

# Engineer (mid-level) understanding the module they're working in.
# Needs to see what their module connects to and understand local call structure.
# More focused than a senior engineer; not doing system-wide architectural analysis.

ENGINEER = Person(
    name    = "Dana",
    role    = "Engineer",
    pronoun = "they",
    goal    = "Understand the module I'm working in — what calls what, "
              "what I depend on, what depends on me.",
    formula = And(
        P.modules_distinguishable,   # can tell my module apart from others
        P.edges_are_visible,         # can see the function-level connections
        P.graph_is_navigable,        # can click into specific functions
        P.not_a_hairball,            # graph doesn't obscure the structure I care about
    ),
)
