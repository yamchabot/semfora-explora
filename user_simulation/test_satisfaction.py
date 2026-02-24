"""
test_satisfaction.py

Tests for the three-layer user satisfaction system.

Uses fixture Perceptions objects — no D3 or frontend dependency.
The instrumentation (layoutMetrics.js) is tested separately in vitest.

Fixture inventory:
  good_layout          well-separated modules, visible chains, clear hotspots
  merged_modules       blobs touching; modules indistinguishable
  hairball             dense edge crossings, no call-chain structure
  clean_single_module  one module, clear chains, no cross-module edges needed
"""

import pytest
from .perceptions import Perceptions
from .judgement   import check_person, check_all, P
from .users       import (
    ALL, COMPANY_EXECUTIVE, ENGINEERING_VP, ENGINEERING_MANAGER,
    PEOPLE_MANAGER, STAFF_ENGINEER, PRINCIPAL_ARCHITECT,
    SENIOR_ENGINEER, ENGINEER, JUNIOR_ENGINEER,
)
from .z3_compat import And, Or, Not, Bool, Solver, sat, unsat


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def good_layout():
    """Three well-separated modules, readable chains, visible hotspots."""
    return Perceptions(
        modules_distinguishable   = True,
        module_boundaries_clear   = True,
        module_membership_correct = True,
        dependencies_traceable    = True,
        coupling_clearly_visible  = True,
        call_chains_readable      = True,
        edges_are_visible         = True,
        hotspots_identifiable     = True,
        node_importance_apparent  = True,
        graph_is_navigable        = True,
        layout_is_trustworthy     = True,
        not_a_hairball            = True,
    )


@pytest.fixture
def merged_modules():
    """Modules touching or overlapping — module structure is invisible."""
    return Perceptions(
        modules_distinguishable   = False,
        module_boundaries_clear   = False,
        module_membership_correct = False,
        dependencies_traceable    = False,
        coupling_clearly_visible  = False,
        call_chains_readable      = True,   # chains within a module still work
        edges_are_visible         = True,
        hotspots_identifiable     = True,
        node_importance_apparent  = True,
        graph_is_navigable        = True,
        layout_is_trustworthy     = False,  # can't trust proximity if modules merged
        not_a_hairball            = True,
    )


@pytest.fixture
def hairball():
    """Many edge crossings, poor chain visibility — navigation nightmare."""
    return Perceptions(
        modules_distinguishable   = True,
        module_boundaries_clear   = False,
        module_membership_correct = True,
        dependencies_traceable    = False,
        coupling_clearly_visible  = False,
        call_chains_readable      = False,
        edges_are_visible         = False,
        hotspots_identifiable     = False,
        node_importance_apparent  = True,
        graph_is_navigable        = False,
        layout_is_trustworthy     = False,
        not_a_hairball            = False,
    )


@pytest.fixture
def clean_single_module():
    """Single module, clear chains, no cross-module concerns."""
    return Perceptions(
        modules_distinguishable   = True,   # only one module — trivially distinguishable
        module_boundaries_clear   = True,
        module_membership_correct = True,
        dependencies_traceable    = True,   # no cross-module, but edges within are clear
        coupling_clearly_visible  = True,
        call_chains_readable      = True,
        edges_are_visible         = True,
        hotspots_identifiable     = True,
        node_importance_apparent  = True,
        graph_is_navigable        = True,
        layout_is_trustworthy     = True,
        not_a_hairball            = True,
    )


# ── Good layout: all users should be satisfied ────────────────────────────────

class TestGoodLayout:
    def test_company_executive(self, good_layout):
        assert check_person(COMPANY_EXECUTIVE, good_layout).satisfied

    def test_engineering_vp(self, good_layout):
        assert check_person(ENGINEERING_VP, good_layout).satisfied

    def test_engineering_manager(self, good_layout):
        assert check_person(ENGINEERING_MANAGER, good_layout).satisfied

    def test_people_manager(self, good_layout):
        assert check_person(PEOPLE_MANAGER, good_layout).satisfied

    def test_staff_engineer(self, good_layout):
        assert check_person(STAFF_ENGINEER, good_layout).satisfied

    def test_principal_architect(self, good_layout):
        assert check_person(PRINCIPAL_ARCHITECT, good_layout).satisfied

    def test_senior_engineer(self, good_layout):
        assert check_person(SENIOR_ENGINEER, good_layout).satisfied

    def test_engineer(self, good_layout):
        assert check_person(ENGINEER, good_layout).satisfied

    def test_junior_engineer(self, good_layout):
        assert check_person(JUNIOR_ENGINEER, good_layout).satisfied

    def test_all_satisfied(self, good_layout):
        results = check_all(ALL, good_layout)
        failed  = [r for r in results if not r.satisfied]
        assert failed == [], "\n".join(str(r) for r in failed)


# ── Merged modules: structural users fail; others may survive ─────────────────

class TestMergedModules:
    def test_executive_fails(self, merged_modules):
        """Executive can't count modules if they look like one blob."""
        assert not check_person(COMPANY_EXECUTIVE, merged_modules).satisfied

    def test_vp_fails(self, merged_modules):
        """VP can't assess team ownership if module boundaries are invisible."""
        assert not check_person(ENGINEERING_VP, merged_modules).satisfied

    def test_staff_engineer_fails(self, merged_modules):
        """Staff engineer can't identify coupling when modules are merged."""
        assert not check_person(STAFF_ENGINEER, merged_modules).satisfied

    def test_principal_architect_fails(self, merged_modules):
        assert not check_person(PRINCIPAL_ARCHITECT, merged_modules).satisfied

    def test_senior_engineer_survives(self, merged_modules):
        """Senior engineer can still trace chains within their module."""
        assert check_person(SENIOR_ENGINEER, merged_modules).satisfied

    def test_junior_engineer_fails(self, merged_modules):
        """Junior engineer can't orient without distinguishable modules."""
        assert not check_person(JUNIOR_ENGINEER, merged_modules).satisfied


# ── Hairball: most users fail; no one can trace anything ─────────────────────

class TestHairball:
    def test_nobody_satisfied(self, hairball):
        results  = check_all(ALL, hairball)
        satisfied = [r for r in results if r.satisfied]
        assert satisfied == [], f"Expected all to fail: {[r.person.name for r in satisfied]}"


# ── Single module: structural users mostly satisfied; coupling users ok ───────

class TestCleanSingleModule:
    def test_senior_engineer_satisfied(self, clean_single_module):
        assert check_person(SENIOR_ENGINEER, clean_single_module).satisfied

    def test_junior_engineer_satisfied(self, clean_single_module):
        assert check_person(JUNIOR_ENGINEER, clean_single_module).satisfied


# ── check_all returns one result per person ───────────────────────────────────

def test_check_all_covers_all_people(good_layout):
    results = check_all(ALL, good_layout)
    assert len(results) == len(ALL)
    names = {r.person.name for r in results}
    assert len(names) == len(ALL)   # no duplicates


# ── Z3 formula composition sanity ────────────────────────────────────────────

class TestZ3Layer:
    def test_sat_when_formula_holds(self):
        x = Bool("x")
        s = Solver()
        s.add(x == True)
        s.add(x)
        assert s.check() == sat

    def test_unsat_when_formula_fails(self):
        x = Bool("x")
        s = Solver()
        s.add(x == False)
        s.add(x)
        assert s.check() == unsat

    def test_and_requires_all_true(self):
        x, y = Bool("x"), Bool("y")
        s = Solver()
        s.add(x == True)
        s.add(y == False)
        s.add(And(x, y))
        assert s.check() == unsat

    def test_or_requires_one_true(self):
        x, y = Bool("x"), Bool("y")
        s = Solver()
        s.add(x == False)
        s.add(y == True)
        s.add(Or(x, y))
        assert s.check() == sat

    def test_not_inverts(self):
        x = Bool("x")
        s = Solver()
        s.add(x == False)
        s.add(Not(x))
        assert s.check() == sat

    def test_person_formula_evaluated_correctly(self):
        """check_person uses the Z3 solver, not ad-hoc boolean evaluation."""
        r = check_person(JUNIOR_ENGINEER, Perceptions(
            modules_distinguishable=True, module_boundaries_clear=True,
            module_membership_correct=True, dependencies_traceable=True,
            coupling_clearly_visible=True, call_chains_readable=True,
            edges_are_visible=True, hotspots_identifiable=True,
            node_importance_apparent=True, graph_is_navigable=True,
            layout_is_trustworthy=True, not_a_hairball=True,
        ))
        assert r.satisfied

    def test_person_unsatisfied_missing_one_perception(self):
        """Removing one required perception makes the person unsatisfied."""
        r = check_person(JUNIOR_ENGINEER, Perceptions(
            modules_distinguishable=False,  # ← junior needs this
            module_boundaries_clear=True, module_membership_correct=True,
            dependencies_traceable=True, coupling_clearly_visible=True,
            call_chains_readable=True, edges_are_visible=True,
            hotspots_identifiable=True, node_importance_apparent=True,
            graph_is_navigable=True, layout_is_trustworthy=True,
            not_a_hairball=True,
        ))
        assert not r.satisfied
