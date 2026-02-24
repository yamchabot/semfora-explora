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

def _make_perceptions(**kw) -> Perceptions:
    """
    Construct a Perceptions object with sensible defaults for all 52 fields,
    overriding with any kwargs supplied.  Tier 2/3/4 defaults represent a
    reasonable mid-quality graph so tests can specify only what matters.
    """
    defaults = dict(
        # ── Tier 1: Raw ───────────────────────────────────────────────────────
        module_count=2, module_separation=50.0, blob_integrity=0.90,
        gestalt_cohesion=0.60, cross_edge_visibility=0.82, cross_edge_count=2,
        cross_edge_ratio=0.15, edge_visibility=0.85, chain_elongation=2.00,
        chain_straightness=0.68, hub_centrality_error=0.22, node_size_cv=0.35,
        node_overlap=0.02, edge_crossings=0.20, layout_stress=1.10,
        degree_gini=0.28, hub_degree_ratio=2.50, degree_entropy=0.72,
        edge_angle_entropy=0.75, graph_aspect_ratio=1.80, spatial_compactness=0.68,
        silhouette_by_module=0.55, spatial_cluster_purity=0.72, chain_r2=0.90,
        # ── Tier 2: Composed ─────────────────────────────────────────────────
        chain_quality=0.50, hub_clarity=0.20, module_clarity=0.45,
        readability=0.65, layout_efficiency=0.52, structural_complexity=0.58,
        coupling_tension=0.08, isolation_risk=0.40, visual_entropy=0.74,
        degree_imbalance=0.10, hub_prominence=0.35, chain_hub_conflict=0.10,
        blob_health=0.72, spatial_disorder=0.22, information_density=0.90,
        # ── Tier 3: Z3 Archetypes ────────────────────────────────────────────
        archetype_chain=0.0, archetype_hub=0.0, archetype_modular=1.0,
        archetype_hairball=0.0, archetype_spaghetti=0.0,
        # ── Tier 4: Z3 Solver ────────────────────────────────────────────────
        required_silhouette=0.25, required_chain_r2=0.70,
        module_clarity_ceiling=0.75, chain_quality_ceiling=0.72,
        worst_violation=0.0, violation_count=0.0, violation_score=0.0,
        layout_conformance=0.90,
    )
    defaults.update(kw)
    return Perceptions(**defaults)


@pytest.fixture
def good_layout():
    """Three well-separated modules, readable chains, clear hotspots, varied node sizes."""
    return _make_perceptions(
        # ── Tier 1: Raw ───────────────────────────────────────────────────────
        module_count=3, module_separation=80.0, blob_integrity=0.95,
        gestalt_cohesion=0.68, cross_edge_visibility=0.85, cross_edge_count=4,
        cross_edge_ratio=0.20, edge_visibility=0.90, chain_elongation=2.10,
        chain_straightness=0.72, hub_centrality_error=0.20, node_size_cv=0.38,
        node_overlap=0.01, edge_crossings=0.22, layout_stress=1.05,
        degree_gini=0.28, hub_degree_ratio=2.50, degree_entropy=0.72,
        edge_angle_entropy=0.75, graph_aspect_ratio=1.80, spatial_compactness=0.72,
        silhouette_by_module=0.65, spatial_cluster_purity=0.80, chain_r2=0.92,
        # ── Tier 2: Composed ─────────────────────────────────────────────────
        chain_quality=0.52, hub_clarity=0.22, module_clarity=0.56,
        readability=0.69, layout_efficiency=0.57, structural_complexity=0.74,
        coupling_tension=0.04, isolation_risk=0.32, visual_entropy=0.74,
        degree_imbalance=0.10, hub_prominence=0.36, chain_hub_conflict=0.08,
        blob_health=0.87, spatial_disorder=0.18, information_density=0.76,
        # ── Tier 3: Z3 Archetypes ────────────────────────────────────────────
        archetype_chain=0.0, archetype_hub=0.0, archetype_modular=1.0,
        archetype_hairball=0.0, archetype_spaghetti=0.0,
        # ── Tier 4: Z3 Solver ────────────────────────────────────────────────
        required_silhouette=0.10, required_chain_r2=0.80,
        module_clarity_ceiling=0.60, chain_quality_ceiling=0.73,
        worst_violation=0.0, violation_count=0.0, violation_score=0.0,
        layout_conformance=1.00,
    )


@pytest.fixture
def merged_modules():
    """Two modules almost touching — structural users can't tell them apart."""
    return _make_perceptions(
        # ── Tier 1: Raw ───────────────────────────────────────────────────────
        module_count=2, module_separation=5.0, blob_integrity=0.62,
        gestalt_cohesion=0.32, cross_edge_visibility=0.52, cross_edge_count=3,
        cross_edge_ratio=0.25, edge_visibility=0.85, chain_elongation=2.10,
        chain_straightness=0.70, hub_centrality_error=0.22, node_size_cv=0.36,
        node_overlap=0.01, edge_crossings=0.28, layout_stress=1.15,
        degree_gini=0.25, hub_degree_ratio=2.20, degree_entropy=0.70,
        edge_angle_entropy=0.78, graph_aspect_ratio=1.50, spatial_compactness=0.55,
        silhouette_by_module=0.10, spatial_cluster_purity=0.15, chain_r2=0.91,
        # ── Tier 2: Composed ─────────────────────────────────────────────────
        chain_quality=0.50, hub_clarity=0.19, module_clarity=0.31,
        readability=0.60, layout_efficiency=0.44, structural_complexity=0.46,
        coupling_tension=0.23, isolation_risk=0.68, visual_entropy=0.74,
        degree_imbalance=0.09, hub_prominence=0.27, chain_hub_conflict=0.08,
        blob_health=0.10, spatial_disorder=0.45, information_density=0.52,
        # ── Tier 3: Z3 Archetypes ────────────────────────────────────────────
        archetype_chain=0.0, archetype_hub=0.0, archetype_modular=0.0,
        archetype_hairball=0.0, archetype_spaghetti=1.0,
        # ── Tier 4: Z3 Solver ────────────────────────────────────────────────
        required_silhouette=0.60, required_chain_r2=0.85,
        module_clarity_ceiling=0.35, chain_quality_ceiling=0.73,
        worst_violation=0.12, violation_count=3.0, violation_score=0.35,
        layout_conformance=0.70,
    )


@pytest.fixture
def hairball():
    """Dense edge crossings and node overlap — nobody can work with this."""
    return _make_perceptions(
        # ── Tier 1: Raw ───────────────────────────────────────────────────────
        module_count=2, module_separation=20.0, blob_integrity=0.80,
        gestalt_cohesion=0.35, cross_edge_visibility=0.40, cross_edge_count=5,
        cross_edge_ratio=0.40, edge_visibility=0.40, chain_elongation=1.10,
        chain_straightness=0.35, hub_centrality_error=0.60, node_size_cv=0.30,
        node_overlap=0.20, edge_crossings=0.85, layout_stress=2.50,
        degree_gini=0.45, hub_degree_ratio=4.50, degree_entropy=0.40,
        edge_angle_entropy=0.95, graph_aspect_ratio=1.10, spatial_compactness=0.30,
        silhouette_by_module=-0.10, spatial_cluster_purity=0.05, chain_r2=0.42,
        # ── Tier 2: Composed ─────────────────────────────────────────────────
        chain_quality=0.06, hub_clarity=0.18, module_clarity=0.14,
        readability=0.10, layout_efficiency=0.10, structural_complexity=1.22,
        coupling_tension=0.35, isolation_risk=0.65, visual_entropy=0.68,
        degree_imbalance=0.20, hub_prominence=1.62, chain_hub_conflict=0.12,
        blob_health=0.38, spatial_disorder=0.55, information_density=3.00,
        # ── Tier 3: Z3 Archetypes ────────────────────────────────────────────
        archetype_chain=0.0, archetype_hub=0.0, archetype_modular=0.0,
        archetype_hairball=1.0, archetype_spaghetti=1.0,
        # ── Tier 4: Z3 Solver ────────────────────────────────────────────────
        required_silhouette=0.80, required_chain_r2=float('inf'),
        module_clarity_ceiling=0.36, chain_quality_ceiling=0.13,
        worst_violation=0.55, violation_count=7.0, violation_score=1.20,
        layout_conformance=0.40,
    )


@pytest.fixture
def clean_single_module():
    """One module, clear linear chains, excellent navigability."""
    return _make_perceptions(
        # ── Tier 1: Raw ───────────────────────────────────────────────────────
        module_count=1, module_separation=0.0, blob_integrity=1.0,
        gestalt_cohesion=0.72, cross_edge_visibility=1.0, cross_edge_count=0,
        cross_edge_ratio=0.0, edge_visibility=0.90, chain_elongation=2.20,
        chain_straightness=0.75, hub_centrality_error=0.15, node_size_cv=0.38,
        node_overlap=0.01, edge_crossings=0.10, layout_stress=0.80,
        degree_gini=0.22, hub_degree_ratio=2.00, degree_entropy=0.78,
        edge_angle_entropy=0.35, graph_aspect_ratio=3.50, spatial_compactness=0.68,
        silhouette_by_module=1.0, spatial_cluster_purity=1.0, chain_r2=0.96,
        # ── Tier 2: Composed ─────────────────────────────────────────────────
        chain_quality=0.66, hub_clarity=0.19, module_clarity=0.90,
        readability=0.78, layout_efficiency=0.60, structural_complexity=0.0,
        coupling_tension=0.0, isolation_risk=0.28, visual_entropy=0.57,
        degree_imbalance=0.07, hub_prominence=0.33, chain_hub_conflict=0.22,
        blob_health=1.0, spatial_disorder=0.0, information_density=0.0,
        # ── Tier 3: Z3 Archetypes ────────────────────────────────────────────
        archetype_chain=1.0, archetype_hub=0.0, archetype_modular=0.0,
        archetype_hairball=0.0, archetype_spaghetti=0.0,
        # ── Tier 4: Z3 Solver ────────────────────────────────────────────────
        required_silhouette=float('inf'), required_chain_r2=0.60,
        module_clarity_ceiling=1.0, chain_quality_ceiling=0.74,
        worst_violation=0.0, violation_count=0.0, violation_score=0.0,
        layout_conformance=1.00,
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

    def test_vp_satisfied_single_module(self, clean_single_module):
        """Marcus's module requirements are conditional on module_count >= 2.
        Single-module graphs trivially satisfy him — one team owns everything,
        no cross-team coupling to worry about."""
        assert check_person(ENGINEERING_VP, clean_single_module).satisfied

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

    def _base_perceptions(self, **overrides):
        """Good-layout baseline with specific fields overridden."""
        base = dict(
            module_count=3, module_separation=80.0, blob_integrity=0.95,
            gestalt_cohesion=0.68, cross_edge_visibility=0.85,
            cross_edge_count=4, cross_edge_ratio=0.20, edge_visibility=0.90,
            chain_elongation=2.10, chain_straightness=0.72,
            hub_centrality_error=0.20, node_size_cv=0.38,
            node_overlap=0.01, edge_crossings=0.22, layout_stress=1.05,
            degree_gini=0.28, hub_degree_ratio=2.50, degree_entropy=0.72,
            edge_angle_entropy=0.75, graph_aspect_ratio=1.80,
            spatial_compactness=0.72, silhouette_by_module=0.65,
            spatial_cluster_purity=0.80, chain_r2=0.92,
        )
        base.update(overrides)
        return _make_perceptions(**base)

    def test_failed_descriptions_populated(self, good_layout=None):
        """Unsatisfied check populates failed_descriptions with readable strings."""
        p = self._base_perceptions(chain_elongation=1.50, chain_r2=0.60)
        result = check_person(SENIOR_ENGINEER, p)
        assert not result.satisfied
        assert len(result.failed_descriptions) >= 1
        assert any("chain_elongation" in d or "chain_r2" in d
                   for d in result.failed_descriptions)

    def test_implies_description_mentions_antecedent(self):
        """Implies failure description explains the conditional."""
        p = self._base_perceptions(
            module_count=2,
            module_separation=30.0,    # triggers Implies(module_count>=2, sep>=40) but fails
            silhouette_by_module=0.10, # fails Fatima's silhouette threshold
            spatial_cluster_purity=0.10,
        )
        result = check_person(PRINCIPAL_ARCHITECT, p)
        assert not result.satisfied
        assert any("module_count" in d or "module_separation" in d
                   for d in result.failed_descriptions)
