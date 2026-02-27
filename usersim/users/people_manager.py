from judgement import Person
from usersim.judgement.z3_compat import Implies

# People manager (lightly technical) planning a hire or team restructure.
# Uses the graph to understand the shape of the codebase: how many distinct
# areas, where the complexity is concentrated, what skills are likely needed.
# Does not trace call chains. Cares about structure and relative complexity.
# Size variation only matters when there's a real degree hierarchy to communicate —
# chains and evenly-connected graphs don't have one.

class PeopleManager(Person):
    name    = "Jordan"
    role    = "People Manager"
    pronoun = "they"
    goal    = ("Understand the structure and complexity distribution of the "
               "codebase to make informed hiring decisions.")

    def constraints(self, P):
        return [
            P.node_overlap   <= 0.02,   # not so overwhelming that nothing can be parsed
            # Size variation only needed when there's a real degree hierarchy
            Implies(P.degree_gini >= 0.30, P.node_size_cv >= 0.25),
            # Multi-module systems must show where the teams start and end
            Implies(P.module_count >= 2, P.module_separation >= 15.0),
        ]


PEOPLE_MANAGER = PeopleManager()
