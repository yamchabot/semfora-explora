from ..judgement import P, Person
from ..z3_compat import And

# Engineer (mid-level) understanding the module they're currently working in.
# Needs to see what their module connects to and understand local call structure.
# More focused than a senior engineer; not doing system-wide architectural analysis.

ENGINEER = Person(
    name    = "Dana",
    role    = "Engineer",
    pronoun = "they",
    goal    = "Understand the module I'm working in — what calls what, "
              "what I depend on, what depends on me.",
    formula = And(
        P.edge_visibility  >= 0.80,  # can see the function-level connections
        P.node_overlap     <= 0.02,  # can click into specific functions
        P.edge_crossings   <= 0.40,  # graph doesn't obscure the structure I care about
    ),
)
