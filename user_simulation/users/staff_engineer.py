from ..judgement import P, Person
from ..z3_compat import And

# Staff engineer looking for architectural problems and refactoring opportunities.
# Technically sophisticated; uses the graph to find over-coupled modules,
# identify blast radius, and build the case for structural changes.

STAFF_ENGINEER = Person(
    name    = "Kenji",
    role    = "Staff Engineer",
    pronoun = "he",
    goal    = "Identify tightly coupled modules, trace cross-boundary dependencies, "
              "and find nodes worth refactoring.",
    formula = And(
        P.module_boundaries_clear,   # can identify module scope precisely
        P.coupling_clearly_visible,  # can count and classify all cross-module calls
        P.hotspots_identifiable,     # over-connected nodes are visually prominent
        P.layout_is_trustworthy,     # spatial proximity reflects actual coupling
    ),
)
