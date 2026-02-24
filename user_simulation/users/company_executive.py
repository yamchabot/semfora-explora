from ..judgement import P, Person
from ..z3_compat import And, Implies

# A CTO reviewing the graph to get a structural read on the codebase.
# Doesn't trace individual functions. Cares about whether the overall shape
# makes sense: how many components, is it visibly messy, can she count things?

COMPANY_EXECUTIVE = Person(
    name    = "Sarah",
    role    = "Company Executive (CTO)",
    pronoun = "she",
    goal    = "Understand the scale and health of the codebase at a glance — "
              "how many components, are there obvious structural problems.",
    formula = And(
        P.node_overlap    <= 0.02,   # shouldn't look like a dense smear
        P.edge_crossings  <= 0.40,   # not so tangled she can't get a gestalt read
        # Multi-module codebases must show at least some visual separation
        Implies(P.module_count >= 2, P.module_separation >= 15.0),
    ),
)
