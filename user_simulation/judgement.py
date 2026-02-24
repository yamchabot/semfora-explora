"""
judgement.py  —  Layer 3: User satisfaction via Z3

A Person is satisfied when their Z3 formula evaluates to `sat` given
the current perceptions.

Formulas are written directly in Z3's expression language over the
numeric perception variables defined in P below. No custom DSL.

Users express real constraints:
  P.module_count >= 3
  P.blob_integrity >= 0.92
  Implies(P.cross_edge_count >= 3, P.module_separation >= 50.0)
  Implies(P.layout_stress > 1.20, P.cross_edge_visibility >= 0.90)

Usage:
    from judgement import P, Person, check_person
    from users.senior_engineer import SENIOR_ENGINEER

    result = check_person(SENIOR_ENGINEER, perceptions)
    print(result)
"""

from __future__ import annotations
import dataclasses
from dataclasses import dataclass, field

from .z3_compat import Real, Int, And, Or, Not, Implies, If, Solver, sat, unsat, BoolRef, ArithRef
from .perceptions import Perceptions


# ── Symbolic perception variables ─────────────────────────────────────────────
#
# One Z3 variable per field in Perceptions — named identically.
# User formulas are written over these variables.

class P:
    """Symbolic numeric variables, one per perception field."""

    # Module structure
    module_count          = Int("module_count")
    module_separation     = Real("module_separation")
    blob_integrity        = Real("blob_integrity")
    gestalt_cohesion      = Real("gestalt_cohesion")

    # Dependencies
    cross_edge_visibility = Real("cross_edge_visibility")
    cross_edge_count      = Int("cross_edge_count")
    cross_edge_ratio      = Real("cross_edge_ratio")
    edge_visibility       = Real("edge_visibility")

    # Call chains
    chain_elongation      = Real("chain_elongation")
    chain_straightness    = Real("chain_straightness")

    # Node prominence
    hub_centrality_error  = Real("hub_centrality_error")
    node_size_cv          = Real("node_size_cv")

    # Cognitive load
    node_overlap          = Real("node_overlap")
    edge_crossings        = Real("edge_crossings")
    layout_stress         = Real("layout_stress")

    # Statistical: degree distribution
    degree_gini            = Real("degree_gini")
    hub_degree_ratio       = Real("hub_degree_ratio")
    degree_entropy         = Real("degree_entropy")

    # Statistical: edge geometry
    edge_angle_entropy     = Real("edge_angle_entropy")

    # Geometric
    graph_aspect_ratio     = Real("graph_aspect_ratio")
    spatial_compactness    = Real("spatial_compactness")

    # sklearn cluster quality
    silhouette_by_module   = Real("silhouette_by_module")
    spatial_cluster_purity = Real("spatial_cluster_purity")

    # sklearn regression
    chain_r2               = Real("chain_r2")

    # ── Tier 2: Composed ─────────────────────────────────────────────────────
    chain_quality          = Real("chain_quality")
    hub_clarity            = Real("hub_clarity")
    module_clarity         = Real("module_clarity")
    readability            = Real("readability")
    layout_efficiency      = Real("layout_efficiency")
    structural_complexity  = Real("structural_complexity")
    coupling_tension       = Real("coupling_tension")
    isolation_risk         = Real("isolation_risk")
    visual_entropy         = Real("visual_entropy")
    degree_imbalance       = Real("degree_imbalance")
    hub_prominence         = Real("hub_prominence")
    chain_hub_conflict     = Real("chain_hub_conflict")
    blob_health            = Real("blob_health")
    spatial_disorder       = Real("spatial_disorder")
    information_density    = Real("information_density")

    # ── Tier 3: Z3 Archetype ─────────────────────────────────────────────────
    archetype_chain        = Real("archetype_chain")
    archetype_hub          = Real("archetype_hub")
    archetype_modular      = Real("archetype_modular")
    archetype_hairball     = Real("archetype_hairball")
    archetype_spaghetti    = Real("archetype_spaghetti")

    # ── Tier 4: Z3 Solver ────────────────────────────────────────────────────
    required_silhouette    = Real("required_silhouette")
    required_chain_r2      = Real("required_chain_r2")
    module_clarity_ceiling = Real("module_clarity_ceiling")
    chain_quality_ceiling  = Real("chain_quality_ceiling")
    worst_violation        = Real("worst_violation")
    violation_count        = Real("violation_count")
    violation_score        = Real("violation_score")
    layout_conformance     = Real("layout_conformance")


# ── Person ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Person:
    """
    A person who uses the graph for a specific purpose.
    `formula` is a Z3 expression over P.* variables.
    `pronoun` is used in narrative output (he/she/they).
    """
    name:    str
    role:    str
    goal:    str
    formula: object    # Z3 boolean expression
    pronoun: str = "they"


# ── Satisfaction check ─────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    person:               Person
    satisfied:            bool
    # List of (constraint_key, human_description) — key is the constraint sexpr,
    # description includes the measured value. Used for cross-scenario deduplication.
    failed_constraints:   list   # list of (sexpr_key: str, description: str)
    summary:              str

    @property
    def failed_descriptions(self) -> list:
        return [desc for _, desc in self.failed_constraints]

    def __str__(self):
        return self.summary


def _conjuncts(formula):
    """Yield atomic conjuncts from a (possibly nested) And expression."""
    # Works with both real Z3 and the shim
    op = getattr(formula, '_op', None)
    if op == "and":
        for arg in formula._args:
            yield from _conjuncts(arg)
    else:
        yield formula


def _eval_conjunct(conjunct, assignment: dict) -> bool:
    """Evaluate a single conjunct against a fixed assignment."""
    s = Solver()
    for name, val in assignment.items():
        var = getattr(P, name, None)
        if var is not None:
            s.add(var == val)
    s.add(conjunct)
    return s.check() == sat


def check_person(person: Person, perceptions: Perceptions) -> CheckResult:
    """
    Check whether `person` is satisfied by the given perceptions.

    Fixes each perception variable to its measured value, then asks Z3
    whether the person's formula is satisfiable.

    For unsatisfied results, each top-level conjunct of the formula is
    evaluated individually to produce human-readable failure descriptions.
    """
    assignment = dataclasses.asdict(perceptions)

    # Fix every perception variable to its measured value
    s = Solver()
    for name, val in assignment.items():
        var = getattr(P, name, None)
        if var is not None:
            s.add(var == val)

    s.add(person.formula)
    satisfied = (s.check() == sat)

    # Build narrative
    pro  = person.pronoun
    Pro  = pro.capitalize()
    sv   = "" if pro == "they" else "s"

    failed_constraints = []   # list of (sexpr_key, description)

    if not satisfied:
        for conjunct in _conjuncts(person.formula):
            if not _eval_conjunct(conjunct, assignment):
                key  = conjunct.sexpr() if hasattr(conjunct, 'sexpr') else str(conjunct)
                desc = conjunct.describe(assignment) if hasattr(conjunct, 'describe') else key
                failed_constraints.append((key, desc))

    descs = [desc for _, desc in failed_constraints]

    if satisfied:
        summary = f"✅  {person.name} ({person.role}) — satisfied"
    else:
        goal_lc = person.goal[0].lower() + person.goal[1:]
        lines = [
            f"❌  {person.name} ({person.role}) is unhappy. "
            f"{Pro} want{sv} to {goal_lc}",
        ]
        if descs:
            if len(descs) == 1:
                lines.append(
                    f"    {Pro} can't do that because {pro} need{sv} {descs[0]}."
                )
            else:
                lines.append(
                    f"    {Pro} can't do that because {pro} need{sv}:"
                )
                for desc in descs:
                    lines.append(f"      • {desc}")
        else:
            lines.append(
                f"    {Pro} can't do that. "
                f"(formula unsatisfied — check {pro} formula for complex conditions)"
            )
        summary = "\n".join(lines)

    return CheckResult(
        person=person,
        satisfied=satisfied,
        failed_constraints=failed_constraints,
        summary=summary,
    )


def check_all(people: list, perceptions: Perceptions) -> list:
    return [check_person(p, perceptions) for p in people]
