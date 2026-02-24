from ..judgement import P, Person
from ..z3_compat import And, Implies

# Senior engineer debugging a production issue or tracing a call chain.
# Focuses on execution paths, not whole-architecture analysis.
# His constraint: if chain elongation barely makes the threshold,
# straightness must pick up the slack.

SENIOR_ENGINEER = Person(
    name    = "Alex",
    role    = "Senior Engineer",
    pronoun = "he",
    goal    = "Trace a call chain through the system — follow a request, "
              "find the bottleneck, understand how data flows.",
    formula = And(
        P.chain_elongation   >= 1.80,  # sequential calls look sequential, not circular
        P.edge_visibility    >= 0.80,  # can see which function calls which
        P.node_overlap       <= 0.02,  # can click into specific nodes
        P.chain_r2           >= 0.85,  # sklearn PCA confirms chain positions are geometrically linear
        # Marginal elongation must be compensated by straighter paths
        Implies(P.chain_elongation < 2.20, P.chain_straightness >= 0.55),
    ),
)
