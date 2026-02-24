from ..judgement import P, Person
from ..z3_compat import And, Implies

# Senior engineer debugging a production issue or tracing a call chain.
# Focuses on execution paths, not whole-architecture analysis.
#
# Chain constraint semantics:
# - No chains detected (elo=1.0) → nothing to check, fine
# - Stub chains elo=1.0–1.5 (short paths inside multi-module blobs) → not
#   full call chains, don't fire strict requirements
# - Proper chains elo≥1.5 → must reach elo≥1.8 (no curling)
# - Geometric linearity (r2, straightness): only enforced for single-module
#   graphs, because multi-module chains follow blob layout and naturally curve

SENIOR_ENGINEER = Person(
    name    = "Alex",
    role    = "Senior Engineer",
    pronoun = "he",
    goal    = "Trace a call chain through the system — follow a request, "
              "find the bottleneck, understand how data flows.",
    formula = And(
        P.edge_visibility    >= 0.80,   # can see which function calls which
        P.node_overlap       <= 0.02,   # can click into specific nodes
        # Only fire chain requirements when chains are meaningfully present
        Implies(P.chain_elongation >= 1.50, P.chain_elongation >= 1.80),
        # Geometric linearity only required for single-module graphs —
        # multi-module chains follow the blob layout and naturally have lower r2
        Implies(P.chain_elongation >= 1.80,
            Implies(P.module_count <= 1, P.chain_r2 >= 0.85)),
        Implies(P.chain_elongation >= 1.80,
            Implies(P.module_count <= 1,
                Implies(P.chain_elongation < 2.20, P.chain_straightness >= 0.55))),
    ),
)
