from ..judgement import P, Person
from ..z3_compat import And

# Principal software architect verifying that the implemented architecture
# matches the intended design. Looks for layer violations, unexpected coupling,
# and patterns that drift from the architectural blueprint.

PRINCIPAL_ARCHITECT = Person(
    name    = "Fatima",
    role    = "Principal Software Architect",
    pronoun = "she",
    goal    = "Verify the code structure matches the intended architecture — "
              "check for layer violations, unexpected coupling, and module drift.",
    formula = And(
        P.module_boundaries_clear,   # modules are where they should be
        P.module_membership_correct, # symbols are inside their correct module
        P.coupling_clearly_visible,  # all cross-module dependencies are countable
        P.layout_is_trustworthy,     # visual distances reflect actual coupling
        P.hotspots_identifiable,     # can spot nodes with unexpectedly high connectivity
    ),
)
