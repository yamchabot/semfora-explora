from ..judgement import P, Person
from ..z3_compat import And, Not

# Junior engineer orienting in an unfamiliar codebase.
# Easily overwhelmed. Needs to find the major components, understand
# the high-level structure, and identify where to start.
# Does NOT need to trace individual call chains yet.

JUNIOR_ENGINEER = Person(
    name    = "Taylor",
    role    = "Junior Engineer",
    pronoun = "they",
    goal    = "Orient in an unfamiliar codebase — find the major modules, "
              "understand the overall structure, know where to start.",
    formula = And(
        P.modules_distinguishable,   # can count and name the modules
        P.graph_is_navigable,        # can explore without getting lost
        P.not_a_hairball,            # not so overwhelming that exploration feels impossible
    ),
)
