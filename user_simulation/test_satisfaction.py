"""
test_satisfaction.py

Tests for the three-layer user satisfaction system.

Uses fixture Perceptions objects — no D3 or frontend dependency.
The instrumentation (layoutMetrics.js) is tested separately in vitest.

Fixture inventory:
  good_layout         well-separated modules, linear chains, clear hotspots,
                      meaningful node sizes — everyone's happy
  merged_modules      blobs touching (separation=5px); module-focused users fail
  hairball            heavy crossings + overlap — nobody can work with this
  clean_single_module one module, excellent chains, no cross-module concerns
"""

import pytest
from .perceptions import Perceptions
from .judgement   import check_person, check_all, P
from .users       import (
    ALL, COMPANY_EXECUTIVE, ENGINEERING_VP, ENGINEERING_MANAGER,
    PEOPLE_MANAGER, STAFF_ENGINEER, PRINCIPAL_ARCHITECT,
    SENIOR_ENGINEER, ENGINEER, JUNIOR_ENGINEER,
)
from .z3_compat import And, Or, Not, Real, Int, Solver, sat, unsat


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def good_layout():
    """Three well-separated modules, readable chains, clear hotspots, varied node sizes."""
    return Perceptions(
        module_count          = 3,
        module_separation     = 80.0,
        blob_integrity        = 0.95,
        gestalt_cohesion      = 0.68,
        cross_edge_visibility = 0.85,
        cross_edge_count      = 4,
        cross_edge_ratio      = 0.20,
        edge_visibility       = 0.90,
        chain_elongation      = 2.10,
        chain_straightness    = 0.72,
        hub_centrality_error  = 0.20,
        node_size_cv          = 0.38,
        node_overlap          = 0.01,
        edge_crossings        = 0.22,
        layout_stress         = 1.05,
    )


@pytest.fixture
def merged_modules():
    """Two modules almost touching — structural users can't tell them apart."""
    return Perceptions(
        module_count          = 2,
        module_separation     = 5.0,    # barely any gap — looks like one blob
        blob_integrity        = 0.62,   # nodes leaking across the boundary
        gestalt_cohesion      = 0.32,
        cross_edge_visibility = 0.52,
        cross_edge_count      = 3,
        cross_edge_ratio      = 0.25,
        edge_visibility       = 0.85,   # individual edges still visible within chains
        chain_elongation      = 2.10,
        chain_straightness    = 0.70,
        hub_centrality_error  = 0.22,
        node_size_cv          = 0.36,
        node_overlap          = 0.01,
        edge_crossings        = 0.28,
        layout_stress         = 1.15,
    )


@pytest.fixture
def hairball():
    """Dense edge crossings and node overlap — nobody can work with this."""
    return Perceptions(
        module_count          = 2,
        module_separation     = 20.0,
        blob_integrity        = 0.80,
        gestalt_cohesion      = 0.35,
        cross_edge_visibility = 0.40,
        cross_edge_count      = 5,
        cross_edge_ratio      = 0.40,
        edge_visibility       = 0.40,
        chain_elongation      = 1.10,
        chain_straightness    = 0.35,
        hub_centrality_error  = 0.60,
        node_size_cv          = 0.30,
        node_overlap          = 0.20,
        edge_crossings        = 0.85,
        layout_stress         = 2.50,
    )


@pytest.fixture
def clean_single_module():
    """One module, clear linear chains, excellent navigability."""
    return Perceptions(
        module_count          = 1,
        module_separation     = 0.0,    # single module — no separation to measure
        blob_integrity        = 1.0,
        gestalt_cohesion      = 0.72,
        cross_edge_visibility = 1.0,    # no cross-module edges — trivially satisfied
        cross_edge_count      = 0,
        cross_edge_ratio      = 0.0,
        edge_visibility       = 0.90,
        chain_elongation      = 2.20,
        chain_straightness    = 0.75,
        hub_centrality_error  = 0.15,
        node_size_cv          = 0.38,
        node_overlap          = 0.01,
        edge_crossings        = 0.10,
        layout_stress         = 0.80,
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


# ── Merged modules: structural users fail; chain-tracers and navigators survive ─

class TestMergedModules:
    def test_executive_fails(self, merged_modules):
        """Sarah can't see module separation — Implies fires and fails."""
        assert not check_person(COMPANY_EXECUTIVE, merged_modules).satisfied

    def test_vp_fails(self, merged_modules):
        """Marcus needs blob_integrity >= 0.92 and module_separation >= 40."""
        assert not check_person(ENGINEERING_VP, merged_modules).satisfied

    def test_engineering_manager_fails(self, merged_modules):
        """Priya needs blob_integrity >= 0.85 to identify her team's region."""
        assert not check_person(ENGINEERING_MANAGER, merged_modules).satisfied

    def test_staff_engineer_fails(self, merged_modules):
        """Kenji needs blob_integrity >= 0.92 to do his analysis."""
        assert not check_person(STAFF_ENGINEER, merged_modules).satisfied

    def test_principal_architect_fails(self, merged_modules):
        """Fatima needs both high blob_integrity and clear module separation."""
        assert not check_person(PRINCIPAL_ARCHITECT, merged_modules).satisfied

    def test_senior_engineer_survives(self, merged_modules):
        """Alex can still trace chains — elongation and edge_visibility are fine."""
        assert check_person(SENIOR_ENGINEER, merged_modules).satisfied

    def test_engineer_survives(self, merged_modules):
        """Dana just needs visible edges and low overlap — unaffected by blob merging."""
        assert check_person(ENGINEER, merged_modules).satisfied

    def test_junior_engineer_fails(self, merged_modules):
        """Taylor needs module_separation >= 10px when there are 2+ modules."""
        assert not check_person(JUNIOR_ENGINEER, merged_modules).satisfied


# ── Hairball: everyone fails ──────────────────────────────────────────────────

class TestHairball:
    def test_nobody_satisfied(self, hairball):
        results   = check_all(ALL, hairball)
        satisfied = [r for r in results if r.satisfied]
        assert satisfied == [], f"Expected all to fail: {[r.person.name for r in satisfied]}"


# ── Single module: most users satisfied; Marcus needs multi-module systems ────

class TestCleanSingleModule:
    def test_senior_engineer_satisfied(self, clean_single_module):
        assert check_person(SENIOR_ENGINEER, clean_single_module).satisfied

    def test_junior_engineer_satisfied(self, clean_single_module):
        assert check_person(JUNIOR_ENGINEER, clean_single_module).satisfied

    def test_executive_satisfied(self, clean_single_module):
        """Sarah's multi-module constraint doesn't fire when module_count=1."""
        assert check_person(COMPANY_EXECUTIVE, clean_single_module).satisfied

    def test_vp_fails_no_multi_module(self, clean_single_module):
        """Marcus explicitly needs module_count >= 2 — single-module doesn't work for him."""
        assert not check_person(ENGINEERING_VP, clean_single_module).satisfied

    def test_people_manager_satisfied(self, clean_single_module):
        """Jordan only needs node sizes to vary — doesn't require multiple modules."""
        assert check_person(PEOPLE_MANAGER, clean_single_module).satisfied


# ── check_all returns one result per person ───────────────────────────────────

def test_check_all_covers_all_people(good_layout):
    results = check_all(ALL, good_layout)
    assert len(results) == len(ALL)
    names = {r.person.name for r in results}
    assert len(names) == len(ALL)


# ── Z3 arithmetic constraint sanity ──────────────────────────────────────────

class TestZ3ArithLayer:
    def test_real_ge_satisfied(self):
        x = Real("x")
        s = Solver()
        s.add(x == 1.80)
        s.add(x >= 1.80)
        assert s.check() == sat

    def test_real_ge_violated(self):
        x = Real("x")
        s = Solver()
        s.add(x == 1.71)
        s.add(x >= 1.80)
        assert s.check() == unsat

    def test_int_ge_satisfied(self):
        n = Int("n")
        s = Solver()
        s.add(n == 3)
        s.add(n >= 2)
        assert s.check() == sat

    def test_int_ge_violated(self):
        n = Int("n")
        s = Solver()
        s.add(n == 1)
        s.add(n >= 2)
        assert s.check() == unsat

    def test_implies_antecedent_false(self):
        """Implies is trivially satisfied when the antecedent is false."""
        from .z3_compat import Implies
        n = Int("n")
        x = Real("x")
        s = Solver()
        s.add(n == 1)
        s.add(x == 0.10)
        s.add(Implies(n > 3, x <= 0.20))   # n=1, not >3 → trivially sat
        assert s.check() == sat

    def test_implies_antecedent_true_consequent_fails(self):
        """Implies fails when antecedent holds but consequent does not."""
        from .z3_compat import Implies
        n = Int("n")
        x = Real("x")
        s = Solver()
        s.add(n == 5)
        s.add(x == 0.35)
        s.add(Implies(n > 3, x <= 0.20))   # n=5 >3 → need x<=0.20, but x=0.35
        assert s.check() == unsat

    def test_and_all_must_hold(self):
        x = Real("x")
        y = Real("y")
        s = Solver()
        s.add(x == 0.85)
        s.add(y == 0.25)
        s.add(And(x >= 0.80, y >= 0.30))   # y fails
        assert s.check() == unsat

    def test_failed_descriptions_populated(self, good_layout=None):
        """Unsatisfied check populates failed_descriptions with readable strings."""
        p = Perceptions(
            module_count=3, module_separation=80.0, blob_integrity=0.95,
            gestalt_cohesion=0.68, cross_edge_visibility=0.85,
            cross_edge_count=4, cross_edge_ratio=0.20, edge_visibility=0.90,
            chain_elongation=1.50,   # ← below threshold
            chain_straightness=0.72, hub_centrality_error=0.20,
            node_size_cv=0.38, node_overlap=0.01, edge_crossings=0.22,
            layout_stress=1.05,
        )
        result = check_person(SENIOR_ENGINEER, p)
        assert not result.satisfied
        assert len(result.failed_descriptions) >= 1
        # Description should mention the variable name
        assert any("chain_elongation" in d for d in result.failed_descriptions)

    def test_implies_description_mentions_antecedent(self):
        """Implies failure description explains the conditional."""
        p = Perceptions(
            module_count=2, module_separation=30.0,  # triggers Implies but fails
            blob_integrity=0.95, gestalt_cohesion=0.68,
            cross_edge_visibility=0.85, cross_edge_count=4,
            cross_edge_ratio=0.20, edge_visibility=0.90,
            chain_elongation=2.10, chain_straightness=0.72,
            hub_centrality_error=0.20, node_size_cv=0.38,
            node_overlap=0.01, edge_crossings=0.22, layout_stress=1.05,
        )
        result = check_person(PRINCIPAL_ARCHITECT, p)
        assert not result.satisfied
        # Should explain the Implies condition
        assert any("module_count" in d or "module_separation" in d
                   for d in result.failed_descriptions)
