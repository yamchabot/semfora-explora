"""
user_simulation — three-layer user satisfaction system

  Layer 1: Instrumentation  (frontend/src/utils/layoutMetrics.js)
           Raw layout measurements: pixel distances, ratios, angles.
           Produces a facts dict (JSON-serialisable).

  Layer 2: Perceptions      (perceptions.py)
           Domain-level boolean observations derived from measurements.
           "Can a viewer perceive X?" — no pixels past this layer.

  Layer 3: Judgement        (judgement.py + users/)
           Z3 formulas over perception variables.
           Each person is satisfied iff their formula evaluates to sat.

Usage:
    from user_simulation.perceptions import compute_perceptions
    from user_simulation.judgement   import check_person, check_all
    from user_simulation.users       import ALL, SENIOR_ENGINEER

    facts       = ...  # from layoutMetrics.js via JSON
    perceptions = compute_perceptions(facts)
    results     = check_all(ALL, perceptions)
    for r in results:
        print(r)
"""

from .perceptions import Perceptions, compute_perceptions
from .judgement   import P, Person, CheckResult, check_person, check_all
from .users       import ALL
