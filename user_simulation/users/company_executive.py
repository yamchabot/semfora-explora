from ..judgement import P, Person
from ..z3_compat import And, Not

# A CTO or VP-level executive reviewing a tech health dashboard.
# Needs to answer: "How many teams' worth of code is this, and is it a mess?"
# Does not trace individual functions. Cares about size, shape, and risk signals.

COMPANY_EXECUTIVE = Person(
    name    = "Sarah",
    role    = "Company Executive (CTO)",
    goal    = "Understand the scale and health of the codebase at a glance — "
              "how many components, are there obvious structural problems.",
    pronoun = "she",
    formula = And(
        P.modules_distinguishable,   # can count the distinct components
        P.graph_is_navigable,        # it doesn't look like a dense smear
        P.not_a_hairball,            # not visually overwhelming
    ),
)
