from ..judgement import Person
from usersim.judgement.z3_compat import Implies

# A CTO reviewing the graph to get a structural read on the codebase.
# Doesn't trace individual functions. Cares about whether the overall shape
# makes sense: how many components, is it visibly messy, can she count things?
# If a graph is so heavily cross-coupled that clean routing is impossible
# (cross_edge_ratio > 40%), she accepts that it will look tangled — that
# IS the signal she needs.

class CompanyExecutive(Person):
    name    = "Sarah"
    role    = "Company Executive (CTO)"
    pronoun = "she"
    goal    = ("Understand the scale and health of the codebase at a glance — "
               "how many components, are there obvious structural problems.")

    def constraints(self, P):
        return [
            P.node_overlap    <= 0.02,   # shouldn't look like a dense smear
            # Crossing budget only applies when the graph isn't inherently tangled
            Implies(P.cross_edge_ratio <= 0.40, P.edge_crossings <= 0.40),
            # Multi-module codebases must show at least some visual separation
            Implies(P.module_count >= 2, P.module_separation >= 15.0),
        ]


COMPANY_EXECUTIVE = CompanyExecutive()
