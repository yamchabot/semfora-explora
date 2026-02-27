from usersim import Person
from usersim.judgement.z3_compat import Implies

# Engineering VP responsible for org-level architecture decisions.
# Uses the graph to assess team ownership boundaries, blast radius,
# and cross-team coupling. Needs to count and attribute dependencies.
#
# Single-module graphs: one team owns everything — trivially readable,
# no cross-team coupling to worry about. Marcus is satisfied because
# the question answers itself. Only multi-module graphs need the full
# ownership-boundaries treatment.

class EngineeringVP(Person):
    name    = "Marcus"
    role    = "Engineering VP"
    pronoun = "he"
    goal    = ("Assess module ownership, cross-team coupling, and whether the "
               "architecture supports the team structure.")

    def constraints(self, P):
        return [
            # Multi-module: must see distinct, well-separated team scopes
            Implies(P.module_count >= 2, P.blob_integrity        >= 0.92),
            Implies(P.module_count >= 2, P.module_separation     >= 40.0),
            Implies(P.module_count >= 2, P.cross_edge_visibility >= 0.80),
            Implies(P.module_count >= 2, P.silhouette_by_module  >= 0.40),
            # Cross-module routing: connections shouldn't visually thread through foreign blobs
            Implies(P.module_count >= 3, P.blob_edge_routing     >= 0.75),
            # Module corridors should not geometrically cross each other.
            # Threshold 0.50 allows K4 theoretical minimum (~0.33) plus some slack
            # for nearly-fully-connected architectures.
            Implies(P.module_count >= 3, P.inter_module_crossings <= 0.50),
            # Single-module: at least the graph must be legible
            P.node_overlap    <= 0.02,
            P.edge_visibility >= 0.70,
        ]


ENGINEERING_VP = EngineeringVP()
