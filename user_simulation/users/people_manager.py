from ..judgement import P, Person
from ..z3_compat import And

# People manager (non-technical or lightly technical) planning a hire.
# Uses the graph to understand the shape of the codebase: how many areas,
# where the complexity is concentrated, what skills seem needed.
# Does not trace call chains. Cares about structure and relative complexity.

PEOPLE_MANAGER = Person(
    name    = "Jordan",
    role    = "People Manager",
    pronoun = "they",
    goal    = "Understand the structure and complexity distribution of the "
              "codebase to make informed hiring decisions.",
    formula = And(
        P.modules_distinguishable,   # can count and name the distinct areas
        P.node_importance_apparent,  # bigger = more complex; can spot heavyweight areas
        P.graph_is_navigable,        # not too overwhelming to make sense of
    ),
)
