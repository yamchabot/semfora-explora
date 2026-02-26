"""
judgement.py  —  Layer 3: User satisfaction via Z3

Evaluates user constraints against computed perceptions using the usersim
judgement engine.  The usersim library handles constraint evaluation;
this module provides the semfora-specific Person base class and the
thin bridge between Perceptions (dataclass) and usersim's flat facts dict.

Usage:
    from user_simulation.judgement import Person, check_person, check_all
    from user_simulation.users.senior_engineer import SENIOR_ENGINEER

    result = check_person(SENIOR_ENGINEER, perceptions)
    # result is a dict: {person, satisfied, score, violations}
"""

from __future__ import annotations
import dataclasses

from usersim.judgement.person import Person as _UsersimPerson
from usersim.judgement.engine import evaluate_person

from .perceptions import Perceptions


# ── Person base class ──────────────────────────────────────────────────────────
#
# Extends usersim's Person with semfora-specific metadata (role, goal, pronoun).
# User files subclass this and implement constraints(self, P).

class Person(_UsersimPerson):
    """
    Semfora user persona.  Subclass this and implement constraints(self, P).

    Extends usersim.Person with:
      role    — job title for narrative output
      goal    — what this person wants to accomplish
      pronoun — for grammatical agreement in failure messages (he/she/they)
    """
    role:    str = ""
    goal:    str = ""
    pronoun: str = "they"

    def constraints(self, P) -> list:
        raise NotImplementedError(
            f"{self.__class__.__name__} must implement constraints(self, P)."
        )


# ── Satisfaction check ─────────────────────────────────────────────────────────

def check_person(person: Person, perceptions: Perceptions) -> dict:
    """
    Check whether `person` is satisfied by the given perceptions.

    Converts the Perceptions dataclass to a flat facts dict and delegates
    to usersim's evaluate_person() engine.

    Returns:
        {
            "person":     str,
            "satisfied":  bool,
            "score":      float,
            "violations": [str],
        }
    """
    facts = dataclasses.asdict(perceptions)
    return evaluate_person(person, facts)


def check_all(people: list, perceptions: Perceptions) -> list:
    """Run check_person for every person.  Returns a list of result dicts."""
    return [check_person(p, perceptions) for p in people]
