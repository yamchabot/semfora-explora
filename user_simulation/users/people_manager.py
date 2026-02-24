from ..judgement import P, Person
from ..z3_compat import And, Implies

# People manager (lightly technical) planning a hire or team restructure.
# Uses the graph to understand the shape of the codebase: how many distinct
# areas, where the complexity is concentrated, what skills are likely needed.
# Does not trace call chains. Cares about structure and relative complexity.

PEOPLE_MANAGER = Person(
    name    = "Jordan",
    role    = "People Manager",
    pronoun = "they",
    goal    = "Understand the structure and complexity distribution of the "
              "codebase to make informed hiring decisions.",
    formula = And(
        P.node_size_cv   >= 0.25,   # node sizes encode complexity — all same = useless
        P.node_overlap   <= 0.02,   # not so overwhelming that nothing can be parsed
        # Multi-module systems must show where the teams start and end
        Implies(P.module_count >= 2, P.module_separation >= 15.0),
    ),
)
