from ..judgement import P, Person
from ..z3_compat import And

# Senior engineer debugging a production issue or tracing a call chain.
# Needs to follow execution paths, spot bottlenecks, and understand data flow.
# Focuses on specific call sequences; not doing whole-architecture analysis.

SENIOR_ENGINEER = Person(
    name    = "Alex",
    role    = "Senior Engineer",
    pronoun = "he",
    goal    = "Trace a call chain through the system — follow a request, "
              "find the bottleneck, understand how data flows.",
    formula = And(
        P.call_chains_readable,      # sequential calls look sequential
        P.hotspots_identifiable,     # high-degree nodes are visually central
        P.edges_are_visible,         # can see which function calls which
        P.graph_is_navigable,        # can click individual nodes to expand
    ),
)
