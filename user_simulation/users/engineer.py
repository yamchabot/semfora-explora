from ..judgement import Person
from usersim.judgement.z3_compat import Implies

# Engineer (mid-level) understanding the module they're currently working in.
# Needs to see what their module connects to and understand local call structure.
# More focused than a senior engineer; not doing system-wide architectural analysis.
# Heavily cross-coupled graphs (spaghetti) will be tangled regardless of layout —
# the high crossing rate is itself the signal that the module needs refactoring.

class Engineer(Person):
    name    = "Dana"
    role    = "Engineer"
    pronoun = "they"
    goal    = ("Understand the module I'm working in — what calls what, "
               "what I depend on, what depends on me.")

    def constraints(self, P):
        return [
            P.edge_visibility  >= 0.80,  # can see the function-level connections
            P.node_overlap     <= 0.02,  # can click into specific functions
            # Crossing budget only applies when routing is actually controllable
            Implies(P.cross_edge_ratio <= 0.40, P.edge_crossings <= 0.40),
        ]


ENGINEER = Engineer()
