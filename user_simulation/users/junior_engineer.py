from ..judgement import P, Person
from ..z3_compat import And, Implies

# Junior engineer orienting in an unfamiliar codebase.
# Easily overwhelmed — needs the graph to be calm and navigable.
# Does NOT need to trace individual call chains yet.
# Their constraint: more modules = stricter crossing budget, because
# getting lost across many components is disorienting.

JUNIOR_ENGINEER = Person(
    name    = "Taylor",
    role    = "Junior Engineer",
    pronoun = "they",
    goal    = "Orient in an unfamiliar codebase — find the major modules, "
              "understand the overall structure, know where to start.",
    formula = And(
        P.node_overlap    <= 0.02,   # can explore without nodes blocking each other
        P.edge_crossings  <= 0.40,   # not so tangled that exploration feels impossible
        # More modules = tighter crossing budget (easy to get lost)
        Implies(P.module_count > 3,  P.edge_crossings <= 0.20),
        # Multi-module systems must show at least some separation to orient by
        Implies(P.module_count >= 2, P.module_separation >= 10.0),
    ),
)
