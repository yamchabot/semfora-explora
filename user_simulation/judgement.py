"""
judgement.py  —  Layer 3: User satisfaction via Z3

A Person is satisfied when their Z3 formula evaluates to `sat` given
the current perceptions.

The formulas are written directly in Z3's expression language over
the perception boolean variables defined in P below. No custom DSL.

Usage:
    from judgement import P, Person, check_person
    from users.senior_engineer import SENIOR_ENGINEER

    result = check_person(SENIOR_ENGINEER, perceptions)
    print(result)
"""

from __future__ import annotations
import dataclasses
from dataclasses import dataclass
from typing import NamedTuple

from .z3_compat import Bool, And, Or, Not, Implies, Solver, sat, unsat, BoolRef
from .perceptions import Perceptions, DESCRIPTIONS


# ── Symbolic perception variables ─────────────────────────────────────────────
#
# These are the Z3 Bool variables that user formulas are written over.
# One variable per field in Perceptions — named identically.

class P:
    """Symbolic boolean variables, one per perception field."""
    modules_distinguishable   = Bool("modules_distinguishable")
    module_boundaries_clear   = Bool("module_boundaries_clear")
    module_membership_correct = Bool("module_membership_correct")

    dependencies_traceable    = Bool("dependencies_traceable")
    coupling_clearly_visible  = Bool("coupling_clearly_visible")

    call_chains_readable      = Bool("call_chains_readable")
    edges_are_visible         = Bool("edges_are_visible")

    hotspots_identifiable     = Bool("hotspots_identifiable")
    node_importance_apparent  = Bool("node_importance_apparent")

    graph_is_navigable        = Bool("graph_is_navigable")
    layout_is_trustworthy     = Bool("layout_is_trustworthy")
    not_a_hairball            = Bool("not_a_hairball")


# ── Person ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Person:
    """
    A person who uses the graph for a specific purpose.
    `formula` is a Z3 boolean expression over P.* variables.
    `pronoun` is the subject pronoun to use in narrative output (he/she/they).
    """
    name:    str
    role:    str
    goal:    str
    formula: BoolRef   # Z3 expression — what must be true for them to be satisfied
    pronoun: str = "they"


# ── Satisfaction check ─────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    person:      Person
    satisfied:   bool
    failed_vars: list[str]   # perception names that are False and appear in the formula
    reasons:     dict        # field → why it's false (from compute_reasons)
    summary:     str

    def __str__(self):
        return self.summary


def check_person(
    person: Person,
    perceptions: Perceptions,
    reasons: dict[str, str] | None = None,
) -> CheckResult:
    """
    Check whether `person` is satisfied by the given perceptions.

    Instantiates each perception variable with its measured boolean value,
    then asks Z3 whether the person's formula is satisfiable (sat).

    Pass `reasons` (from compute_reasons()) to get per-field explanations
    in the failure output.
    """
    assignment = dataclasses.asdict(perceptions)
    reasons = reasons or {}

    s = Solver()

    # Fix every perception variable to its measured value
    for name, val in assignment.items():
        var = getattr(P, name, None)
        if var is not None:
            s.add(var == val)

    # Check whether the person's formula is satisfiable under this assignment
    s.add(person.formula)
    result = s.check()
    satisfied = (result == sat)

    # Perception names that are False AND appear in the person's formula
    sexpr = person.formula.sexpr()
    failed_vars = [
        name for name, val in assignment.items()
        if not val and name in sexpr
    ]

    pro   = person.pronoun                          # he / she / they
    Pro   = pro.capitalize()                        # He / She / They
    his   = "their" if pro == "they" else ("his" if pro == "he" else "her")
    # verb conjugation: "they want / they need" vs "he wants / she needs"
    sv    = "" if pro == "they" else "s"            # plural vs singular suffix

    if satisfied:
        summary = f"✅  {person.name} ({person.role}) — satisfied"
    else:
        goal_lc = person.goal[0].lower() + person.goal[1:]
        intro = (
            f"❌  {person.name} ({person.role}) is unhappy. "
            f"{Pro} want{sv} to {goal_lc}"
        )
        if failed_vars:
            if len(failed_vars) == 1:
                desc   = DESCRIPTIONS.get(failed_vars[0], failed_vars[0])
                detail = reasons.get(failed_vars[0], "")
                body   = f"{Pro} can't do that because {pro} need{sv} {desc}."
                if detail:
                    body += f" ({detail})"
            else:
                need_lines = []
                for field in failed_vars:
                    desc   = DESCRIPTIONS.get(field, field)
                    detail = reasons.get(field, "")
                    line   = f"  • {desc}"
                    if detail:
                        line += f" ({detail})"
                    need_lines.append(line)
                needs_block = "\n".join(need_lines)
                body = f"{Pro} can't do that because {pro} need{sv}:\n{needs_block}"
        else:
            body = f"{Pro} can't do that. (formula unsatisfied — check {his} formula for complex conditions)"
        summary = f"{intro}\n{body}"

    return CheckResult(
        person=person,
        satisfied=satisfied,
        failed_vars=failed_vars,
        reasons=reasons,
        summary=summary,
    )


def check_all(
    people: list[Person],
    perceptions: Perceptions,
    reasons: dict[str, str] | None = None,
) -> list[CheckResult]:
    return [check_person(p, perceptions, reasons) for p in people]
