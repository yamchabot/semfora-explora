from ..judgement import P, Person
from ..z3_compat import And, Implies

# Junior engineer orienting in an unfamiliar codebase.
# Easily overwhelmed — needs the graph to be calm and navigable.
# Does NOT need to trace individual call chains yet.
# Their constraint: more modules = stricter crossing budget, because
# getting lost across many components is disorienting.
# Inherently tangled codebases (high cross_edge_ratio) will always look tangled —
# that's an architecture problem, not a rendering problem.

class JuniorEngineer(Person):
    name    = "Taylor"
    role    = "Junior Engineer"
    pronoun = "they"
    goal    = ("Orient in an unfamiliar codebase — find the major modules, "
               "understand the overall structure, know where to start.")

    def constraints(self, P):
        return [
            P.node_overlap    <= 0.02,   # can explore without nodes blocking each other
            # Crossing budget only applies when routing is controllable
            Implies(P.cross_edge_ratio <= 0.40, P.edge_crossings <= 0.40),
            # More modules = tighter crossing budget (easy to get lost)
            Implies(P.module_count > 3,
                Implies(P.cross_edge_ratio <= 0.40, P.edge_crossings <= 0.20)),
            # Multi-module systems must show at least some separation to orient by
            Implies(P.module_count >= 2, P.module_separation >= 10.0),
        ]


JUNIOR_ENGINEER = JuniorEngineer()
