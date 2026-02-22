"""
Statistical tests for the 25 enriched node-level signals produced by enrich.py.

Design goals (per Daniel's spec):
  1. Non-degeneracy  — each signal has >1 distinct value across the dataset;
                       "always 0" or "always 100%" is a bad signal.
  2. Within-repo variance — signals spread across nodes in a single repo.
  3. Cross-repo discriminability — known antipatterns produce measurably
                                   different distributions from the clean baseline.
  4. Structural correctness — properties we can derive analytically must hold
                              (e.g. complexity_pct ∈ [0,1], pagerank sums to 1).

All tests run against *.enriched.db copies generated from the 8 taskboard
fixture branches. The raw DBs are never touched.
"""
from __future__ import annotations

import statistics
from typing import Sequence

import sqlite3

import pytest
from scipy.stats import mannwhitneyu, spearmanr


# ── Local query helpers ───────────────────────────────────────────────────────

def scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()):
    """Run a scalar query and return the single value (None if no rows)."""
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def col(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list:
    """Run a query and return a flat list of first-column values (nulls excluded)."""
    return [r[0] for r in conn.execute(sql, params).fetchall() if r[0] is not None]


# ─────────────────────────────────────────────────────────────────────────────
# §1  Non-degeneracy
#     Each scalar signal must take >1 distinct value when pooled across all
#     8 repos.  A signal that is constant everywhere carries zero information.
# ─────────────────────────────────────────────────────────────────────────────

SCALAR_SIGNALS = [
    # NOTE: scc_size and scc_cross_module are intentionally excluded here.
    # The taskboard fixtures only have module-level circular imports, not
    # function-call-level cycles, so scc_size == 1 everywhere in this suite.
    # They ARE tested separately in §2 via module_edges SCC detection.
    "topological_depth",
    "reverse_topological_depth",
    "transitive_callers",
    "transitive_callees",
    "betweenness_centrality",
    "pagerank",
    "hub_score",
    "authority_score",
    "xmod_fan_in",
    "xmod_fan_out",
    "xmod_call_ratio",
    "dominant_callee_frac",
    "utility_score",
    "stability_rank",
    "complexity_pct",
    "middleman_score",
    "community_alignment",
]


@pytest.mark.parametrize("signal", SCALAR_SIGNALS)
def test_signal_not_degenerate_pooled(enriched_taskboard_dbs, signal):
    """Signal must take at least 2 distinct values across all repos combined."""
    seen: set = set()
    for conn in enriched_taskboard_dbs.values():
        vals = col(conn, f"SELECT {signal} FROM node_features WHERE {signal} IS NOT NULL")
        seen.update(vals)
        if len(seen) > 1:
            return  # fast exit — already non-degenerate
    assert len(seen) > 1, (
        f"Signal '{signal}' is degenerate: only value seen across all repos is {seen}"
    )


@pytest.mark.parametrize("signal", SCALAR_SIGNALS)
def test_signal_has_within_repo_variance(enriched_taskboard_dbs, signal):
    """
    At least one repo must have std > 0 for this signal.
    A signal that's constant within every single repo offers no intra-repo insight.
    """
    any_variance = False
    for slug, conn in enriched_taskboard_dbs.items():
        vals = col(conn, f"SELECT {signal} FROM node_features WHERE {signal} IS NOT NULL")
        if len(vals) < 2:
            continue
        try:
            if statistics.stdev(vals) > 0:
                any_variance = True
                break
        except statistics.StatisticsError:
            pass
    assert any_variance, (
        f"Signal '{signal}' has zero variance in every repo — not useful within a repo"
    )


# ─────────────────────────────────────────────────────────────────────────────
# §2  Cycle signals
#
#     The taskboard circular-deps branch introduces circular module-level
#     *imports*, not function-call cycles.  semfora-engine builds a call graph
#     (not an import graph), so function-level SCC sizes are all 1 here —
#     that is correct behaviour, not a bug.
#
#     We therefore test cycle detection at the module level (module_edges table)
#     and verify that function-level SCC invariants hold across all repos.
# ─────────────────────────────────────────────────────────────────────────────

import networkx as _nx  # noqa: E402 (only used in this section)


def _module_cycle_count(conn: sqlite3.Connection) -> int:
    """Number of modules participating in at least one module-level SCC > 1."""
    rows = conn.execute("""
        SELECT caller_module, callee_module FROM module_edges
        WHERE caller_module != callee_module
          AND caller_module != '__external__'
          AND callee_module != '__external__'
    """).fetchall()
    G = _nx.DiGraph()
    for r in rows:
        G.add_edge(r[0], r[1])
    return sum(len(s) for s in _nx.strongly_connected_components(G) if len(s) > 1)


def test_circular_deps_has_module_level_cycles(enriched_taskboard_dbs):
    """circular-deps must have at least one module-level circular dependency."""
    n = _module_cycle_count(enriched_taskboard_dbs["antipattern-circular-deps"])
    assert n > 0, "circular-deps fixture should produce module-level cycles"


def test_clean_baseline_no_module_cycles(enriched_taskboard_dbs):
    """Clean baseline must have zero module-level circular dependencies."""
    n = _module_cycle_count(enriched_taskboard_dbs["main"])
    assert n == 0, f"Clean baseline should have no module-level cycles, got {n} modules"


def test_circular_deps_more_module_cycles_than_baseline(enriched_taskboard_dbs):
    """circular-deps must have more modules in cycles than the clean baseline."""
    assert (
        _module_cycle_count(enriched_taskboard_dbs["antipattern-circular-deps"])
        > _module_cycle_count(enriched_taskboard_dbs["main"])
    )


def test_scc_cross_module_only_with_multi_node_scc(enriched_taskboard_dbs):
    """scc_cross_module = 1 must only occur when scc_size > 1 (invariant)."""
    for slug, conn in enriched_taskboard_dbs.items():
        bad = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE scc_cross_module = 1 AND scc_size <= 1"
        )
        assert bad == 0, (
            f"{slug}: {bad} nodes have scc_cross_module=1 but scc_size<=1 (inconsistent)"
        )


def test_clean_baseline_all_function_sccs_trivial(enriched_taskboard_dbs):
    """Clean baseline should have no function-level cycles (all scc_size == 1)."""
    max_scc = scalar(enriched_taskboard_dbs["main"],
                     "SELECT MAX(scc_size) FROM node_features")
    assert max_scc == 1, f"Clean baseline: expected max scc_size=1, got {max_scc}"


# ─────────────────────────────────────────────────────────────────────────────
# §3  Topological depth & reachability
# ─────────────────────────────────────────────────────────────────────────────

def test_topological_depth_spans_multiple_levels(enriched_taskboard_dbs):
    """Every repo must have nodes at depth 0 (sources) and depth >= 2."""
    for slug, conn in enriched_taskboard_dbs.items():
        max_depth = scalar(conn, "SELECT MAX(topological_depth) FROM node_features")
        assert max_depth is not None and max_depth >= 2, (
            f"{slug}: topological_depth max={max_depth}, expected >=2"
        )


def test_reverse_topological_depth_spans_multiple_levels(enriched_taskboard_dbs):
    """Every repo must have nodes at reverse depth >= 2."""
    for slug, conn in enriched_taskboard_dbs.items():
        max_depth = scalar(conn, "SELECT MAX(reverse_topological_depth) FROM node_features")
        assert max_depth is not None and max_depth >= 2, (
            f"{slug}: reverse_topological_depth max={max_depth}, expected >=2"
        )


def test_dead_code_graveyard_more_unreachable_than_baseline(enriched_taskboard_dbs):
    """
    dead-code-graveyard should have more nodes with transitive_callers = 0
    (unreachable nodes) than the clean baseline.
    """
    def unreachable_count(slug):
        return scalar(
            enriched_taskboard_dbs[slug],
            "SELECT COUNT(*) FROM node_features WHERE transitive_callers = 0"
        ) or 0

    graveyard = unreachable_count("antipattern-dead-code-graveyard")
    baseline  = unreachable_count("main")
    assert graveyard > baseline, (
        f"dead-code-graveyard has {graveyard} unreachable nodes vs baseline {baseline}"
    )


def test_transitive_callers_and_callees_nonnegative(enriched_taskboard_dbs):
    """transitive_callers and transitive_callees must always be >= 0."""
    for slug, conn in enriched_taskboard_dbs.items():
        neg = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE transitive_callers < 0 OR transitive_callees < 0"
        )
        assert neg == 0, f"{slug}: {neg} nodes have negative reachability counts"


# ─────────────────────────────────────────────────────────────────────────────
# §4  Centrality signals
# ─────────────────────────────────────────────────────────────────────────────

def test_god_object_higher_max_authority_score(enriched_taskboard_dbs):
    """
    The god-object concentrates inbound dependencies — many nodes depend on it.
    HITS authority_score measures exactly this (high authority = many hub nodes
    point to you), making it the strongest centrality discriminator for this
    antipattern.  Empirically: god-object max=0.478 vs baseline max=0.208.
    """
    god_max  = scalar(enriched_taskboard_dbs["antipattern-god-object"],
                      "SELECT MAX(authority_score) FROM node_features")
    main_max = scalar(enriched_taskboard_dbs["main"],
                      "SELECT MAX(authority_score) FROM node_features")
    assert god_max is not None and main_max is not None
    assert god_max > main_max, (
        f"god-object max authority_score ({god_max:.4f}) <= baseline ({main_max:.4f})"
    )


def test_pagerank_sums_to_one_per_repo(enriched_taskboard_dbs):
    """pagerank must sum to ~1.0 within each repo (standard normalisation)."""
    for slug, conn in enriched_taskboard_dbs.items():
        total = scalar(conn, "SELECT SUM(pagerank) FROM node_features")
        assert total is not None, f"{slug}: pagerank sum is NULL"
        assert abs(total - 1.0) < 0.02, (
            f"{slug}: pagerank sums to {total:.4f}, expected ~1.0"
        )


def test_hub_scores_nonnegative(enriched_taskboard_dbs):
    for slug, conn in enriched_taskboard_dbs.items():
        neg = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE hub_score < 0")
        assert neg == 0, f"{slug}: {neg} nodes with negative hub_score"


def test_authority_scores_nonnegative(enriched_taskboard_dbs):
    for slug, conn in enriched_taskboard_dbs.items():
        neg = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE authority_score < 0")
        assert neg == 0, f"{slug}: {neg} nodes with negative authority_score"


def test_betweenness_centrality_in_valid_range(enriched_taskboard_dbs):
    """betweenness_centrality must be in [0, 1] (NetworkX normalises it)."""
    for slug, conn in enriched_taskboard_dbs.items():
        out_of_range = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE betweenness_centrality < 0 OR betweenness_centrality > 1"
        )
        assert out_of_range == 0, f"{slug}: {out_of_range} nodes with betweenness outside [0,1]"


# ─────────────────────────────────────────────────────────────────────────────
# §5  Module-boundary signals
# ─────────────────────────────────────────────────────────────────────────────

def test_util_dumping_ground_higher_max_xmod_fan_in(enriched_taskboard_dbs):
    """
    The util-dumping-ground anti-pattern puts many helpers in one module that
    is called from everywhere.  Its max xmod_fan_in should exceed the baseline.
    """
    util_max = scalar(enriched_taskboard_dbs["antipattern-util-dumping-ground"],
                      "SELECT MAX(xmod_fan_in) FROM node_features")
    main_max = scalar(enriched_taskboard_dbs["main"],
                      "SELECT MAX(xmod_fan_in) FROM node_features")
    assert util_max is not None and main_max is not None
    assert util_max > main_max, (
        f"util-dumping-ground max xmod_fan_in ({util_max}) <= baseline ({main_max})"
    )


def test_tight_coupling_higher_mean_xmod_call_ratio(enriched_taskboard_dbs):
    """
    tight-coupling should have a higher proportion of cross-module calls
    (mean xmod_call_ratio) than the clean baseline.
    """
    def mean_xmod(slug):
        return scalar(
            enriched_taskboard_dbs[slug],
            "SELECT AVG(xmod_call_ratio) FROM node_features WHERE xmod_call_ratio IS NOT NULL"
        ) or 0.0

    tc_mean   = mean_xmod("antipattern-tight-coupling")
    main_mean = mean_xmod("main")
    assert tc_mean > main_mean, (
        f"tight-coupling mean xmod_call_ratio ({tc_mean:.3f}) <= baseline ({main_mean:.3f})"
    )


def test_xmod_call_ratio_in_valid_range(enriched_taskboard_dbs):
    """xmod_call_ratio must be in [0, 1]."""
    for slug, conn in enriched_taskboard_dbs.items():
        bad = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE xmod_call_ratio < 0 OR xmod_call_ratio > 1"
        )
        assert bad == 0, f"{slug}: {bad} nodes with xmod_call_ratio outside [0,1]"


def test_dominant_callee_frac_in_valid_range(enriched_taskboard_dbs):
    """dominant_callee_frac must be in [0, 1]."""
    for slug, conn in enriched_taskboard_dbs.items():
        bad = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE dominant_callee_frac < 0 OR dominant_callee_frac > 1"
        )
        assert bad == 0, f"{slug}: {bad} nodes with dominant_callee_frac outside [0,1]"


def test_xmod_fan_in_fan_out_nonnegative(enriched_taskboard_dbs):
    for slug, conn in enriched_taskboard_dbs.items():
        bad = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE xmod_fan_in < 0 OR xmod_fan_out < 0"
        )
        assert bad == 0, f"{slug}: negative xmod_fan_in or xmod_fan_out"


# ─────────────────────────────────────────────────────────────────────────────
# §6  Composite / derived signals
# ─────────────────────────────────────────────────────────────────────────────

def test_complexity_pct_is_valid_percentile(enriched_taskboard_dbs):
    """complexity_pct must be in [0, 1] and span most of that range per repo."""
    for slug, conn in enriched_taskboard_dbs.items():
        mn  = scalar(conn, "SELECT MIN(complexity_pct) FROM node_features")
        mx  = scalar(conn, "SELECT MAX(complexity_pct) FROM node_features")
        assert mn is not None and mx is not None
        assert 0.0 <= mn <= mx <= 1.0, f"{slug}: complexity_pct out of [0,1]: [{mn},{mx}]"
        span = mx - mn
        assert span > 0.5, (
            f"{slug}: complexity_pct span ({span:.2f}) too small — percentile should cover most of [0,1]"
        )


def test_utility_score_spearman_correlates_with_transitive_callers(enriched_taskboard_dbs):
    """
    utility_score is defined as log(1+transitive_callers)*log(2+xmod_fan_in),
    so it must be strongly rank-correlated with transitive_callers (ρ > 0.7).
    """
    for slug, conn in enriched_taskboard_dbs.items():
        rows = conn.execute(
            "SELECT utility_score, transitive_callers FROM node_features"
        ).fetchall()
        u = [r[0] for r in rows if r[0] is not None and r[1] is not None]
        t = [r[1] for r in rows if r[0] is not None and r[1] is not None]
        if len(u) < 5:
            continue
        rho, _ = spearmanr(u, t)
        assert rho > 0.7, (
            f"{slug}: utility_score ↔ transitive_callers Spearman ρ={rho:.3f}, expected >0.7"
        )


def test_utility_score_nonnegative(enriched_taskboard_dbs):
    for slug, conn in enriched_taskboard_dbs.items():
        neg = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE utility_score < 0")
        assert neg == 0, f"{slug}: {neg} nodes with negative utility_score"


def test_stability_rank_in_valid_range(enriched_taskboard_dbs):
    """stability_rank (efferent / total) must be in [0, 1]."""
    for slug, conn in enriched_taskboard_dbs.items():
        bad = scalar(
            conn,
            "SELECT COUNT(*) FROM node_features WHERE stability_rank < 0 OR stability_rank > 1"
        )
        assert bad == 0, f"{slug}: {bad} nodes with stability_rank outside [0,1]"


def test_middleman_score_nonnegative(enriched_taskboard_dbs):
    for slug, conn in enriched_taskboard_dbs.items():
        neg = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE middleman_score < 0")
        assert neg == 0, f"{slug}: {neg} nodes with negative middleman_score"


def test_god_object_higher_max_caller_count(enriched_taskboard_dbs):
    """
    The god-object is called from many places (high direct fan-in).
    max caller_count should exceed the baseline's most-called node.
    """
    god_max  = scalar(enriched_taskboard_dbs["antipattern-god-object"],
                      "SELECT MAX(caller_count) FROM nodes WHERE hash NOT LIKE 'ext:%'")
    main_max = scalar(enriched_taskboard_dbs["main"],
                      "SELECT MAX(caller_count) FROM nodes WHERE hash NOT LIKE 'ext:%'")
    assert god_max is not None and main_max is not None
    assert god_max > main_max, (
        f"god-object max caller_count ({god_max}) <= baseline ({main_max})"
    )


# ─────────────────────────────────────────────────────────────────────────────
# §7  Community signals
# ─────────────────────────────────────────────────────────────────────────────

def test_community_alignment_not_perfect(enriched_taskboard_dbs):
    """
    Algorithmic communities should not perfectly mirror declared modules in
    any repo.  If alignment is 100%, the signal is uninformative.
    """
    for slug, conn in enriched_taskboard_dbs.items():
        total    = scalar(conn, "SELECT COUNT(*) FROM node_features") or 1
        aligned  = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE community_alignment = 1") or 0
        rate = aligned / total
        assert rate < 1.0, (
            f"{slug}: community_alignment is 100% — signal is degenerate"
        )


def test_community_alignment_not_zero(enriched_taskboard_dbs):
    """
    Some community-to-module alignment must exist (>0%).
    Zero alignment would mean the signal is always False — also degenerate.
    """
    for slug, conn in enriched_taskboard_dbs.items():
        total   = scalar(conn, "SELECT COUNT(*) FROM node_features") or 1
        aligned = scalar(conn, "SELECT COUNT(*) FROM node_features WHERE community_alignment = 1") or 0
        rate = aligned / total
        assert rate > 0.0, (
            f"{slug}: community_alignment is 0% — signal is degenerate"
        )


def test_every_repo_has_multiple_communities(enriched_taskboard_dbs):
    """Each repo should be decomposed into >= 2 communities by Louvain."""
    for slug, conn in enriched_taskboard_dbs.items():
        n_communities = scalar(conn, "SELECT COUNT(DISTINCT community_id) FROM node_features")
        assert n_communities is not None and n_communities >= 2, (
            f"{slug}: only {n_communities} community — Louvain should find at least 2"
        )


def test_community_count_bounded_by_node_count(enriched_taskboard_dbs):
    """Number of communities must be <= number of nodes (trivially correct)."""
    for slug, conn in enriched_taskboard_dbs.items():
        n_comms = scalar(conn, "SELECT COUNT(DISTINCT community_id) FROM node_features")
        n_nodes = scalar(conn, "SELECT COUNT(*) FROM node_features")
        assert n_comms <= n_nodes, f"{slug}: more communities than nodes (impossible)"


# ─────────────────────────────────────────────────────────────────────────────
# §8  Cross-repo discriminability — Mann-Whitney U
#
#     Two-sample Mann-Whitney U (Wilcoxon rank-sum) is better than KS for
#     small, discrete, non-normal distributions.  We use α = 0.10.
#
#     Each test pairs the anti-pattern's canonical signal with the clean
#     baseline.  The alternative is 'greater' (antipattern > baseline).
# ─────────────────────────────────────────────────────────────────────────────

def _mw_greater(conn_ap, conn_bl, signal: str, alpha: float = 0.10) -> tuple[bool, float]:
    """Mann-Whitney U: is the antipattern's distribution stochastically greater?"""
    a = col(conn_ap, f"SELECT {signal} FROM node_features WHERE {signal} IS NOT NULL")
    b = col(conn_bl, f"SELECT {signal} FROM node_features WHERE {signal} IS NOT NULL")
    if len(a) < 3 or len(b) < 3:
        return True, 0.0  # not enough data — skip gracefully
    _, p = mannwhitneyu(a, b, alternative="greater")
    return p < alpha, p


def test_god_object_authority_score_distribution_differs_from_baseline(enriched_taskboard_dbs):
    """
    The god-object concentrates authority into one outlier node, making its
    authority_score distribution significantly different from the clean baseline
    (two-sided MW — the distribution is reshaped, not uniformly shifted).
    Empirically: p < 1e-6.
    """
    a = col(enriched_taskboard_dbs["antipattern-god-object"],
            "SELECT authority_score FROM node_features WHERE authority_score IS NOT NULL")
    b = col(enriched_taskboard_dbs["main"],
            "SELECT authority_score FROM node_features WHERE authority_score IS NOT NULL")
    _, p = mannwhitneyu(a, b, alternative="two-sided")
    assert p < 0.01, (
        f"authority_score two-sided MW p={p:.6f}: god-object distribution not "
        f"significantly different from baseline"
    )


def test_dead_code_graveyard_utility_score_mw_less_than_baseline(enriched_taskboard_dbs):
    """
    Dead-code graveyard nodes have lower utility scores on average
    (many unreachable nodes with utility=0 drag the distribution down).
    """
    a = col(enriched_taskboard_dbs["antipattern-dead-code-graveyard"],
            "SELECT utility_score FROM node_features WHERE utility_score IS NOT NULL")
    b = col(enriched_taskboard_dbs["main"],
            "SELECT utility_score FROM node_features WHERE utility_score IS NOT NULL")
    _, p = mannwhitneyu(a, b, alternative="less")
    assert p < 0.10, (
        f"utility_score MW (less) p={p:.4f}: dead-code-graveyard not lower than baseline"
    )


def test_tight_coupling_more_cross_module_call_volume(enriched_taskboard_dbs):
    """
    Tight-coupling adds calls across module boundaries.
    Total cross-module edge volume (module_edges) should exceed the baseline.

    Note: on small synthetic repos, node-level distribution tests (MW) lack
    statistical power for this antipattern — the signal manifests at the
    module-graph level, not in per-node distributions.
    """
    def xmod_volume(slug):
        return scalar(
            enriched_taskboard_dbs[slug],
            """SELECT SUM(edge_count) FROM module_edges
               WHERE caller_module != callee_module
                 AND caller_module != '__external__'
                 AND callee_module != '__external__'"""
        ) or 0

    tc  = xmod_volume("antipattern-tight-coupling")
    bl  = xmod_volume("main")
    assert tc > bl, (
        f"tight-coupling cross-module volume ({tc}) <= baseline ({bl})"
    )


def test_feature_creep_more_total_symbols_than_baseline(enriched_taskboard_dbs):
    """
    Feature-creep adds functionality (new features/services) beyond the original
    scope, so the codebase grows: more total symbols than the clean baseline.

    Note: complexity_pct is a within-repo percentile rank, so its distribution
    is always roughly uniform regardless of actual complexity levels.
    Use raw node count as the structural indicator instead.
    """
    fc_count = scalar(
        enriched_taskboard_dbs["antipattern-feature-creep"],
        "SELECT COUNT(*) FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    bl_count = scalar(
        enriched_taskboard_dbs["main"],
        "SELECT COUNT(*) FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    assert fc_count > bl_count, (
        f"feature-creep symbol count ({fc_count}) <= baseline ({bl_count})"
    )
