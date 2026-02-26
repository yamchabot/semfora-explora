from ..judgement import Person

# Engineering manager responsible for a specific team and module.
# Needs to understand their team's code and see what it connects to.
# Uses the graph to explain scope to stakeholders and plan work.

class EngineeringManager(Person):
    name    = "Priya"
    role    = "Engineering Manager"
    pronoun = "she"
    goal    = ("Understand her team's module clearly and see what it depends "
               "on and what depends on it.")

    def constraints(self, P):
        return [
            P.blob_integrity         >= 0.85,  # can confidently identify her team's region
            P.cross_edge_visibility  >= 0.70,  # can see calls in and out of the module
            P.node_overlap           <= 0.02,  # can navigate to individual functions
        ]


ENGINEERING_MANAGER = EngineeringManager()
