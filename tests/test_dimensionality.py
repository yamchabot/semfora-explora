"""
Tests for the ML dimensionality-reduction tools in analytics/dimensionality.py.

Validates that each tool produces well-formed, meaningful output —
not that specific numerical values are frozen (those belong in golden-value
tests once the pipeline is stable).

All tests use the 11-fixture enriched_taskboard_dbs session fixture.
"""
from __future__ import annotations

import math
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from analytics.dimensionality import (
    FEATURE_COLS,
    build_feature_matrix,
    build_pooled_dataset,
    compute_correlation_matrix,
    compute_2d_projection,
    compute_discriminability,
    compute_feature_importance,
    compute_subset_comparison,
    run_pca,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_rows(conn: sqlite3.Connection) -> list[dict]:
    """Load node + node_features rows from an enriched DB."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            n.hash, n.name, n.module,
            n.caller_count, n.callee_count, n.complexity,
            nf.*
        FROM nodes n
        JOIN node_features nf ON n.hash = nf.hash
        WHERE n.hash NOT LIKE 'ext:%'
    """).fetchall()
    return [dict(r) for r in rows]


@pytest.fixture(scope="module")
def slug_to_rows(enriched_taskboard_dbs) -> dict[str, list[dict]]:
    """Load node rows for all enriched repos."""
    return {slug: _load_rows(conn) for slug, conn in enriched_taskboard_dbs.items()}


@pytest.fixture(scope="module")
def all_rows(slug_to_rows) -> list[dict]:
    """All rows pooled across repos."""
    return [r for rows in slug_to_rows.values() for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# §1  Feature matrix construction
# ─────────────────────────────────────────────────────────────────────────────

def test_build_feature_matrix_shape(all_rows):
    X, cols = build_feature_matrix(all_rows)
    assert X.shape[0] == len(all_rows)
    assert X.shape[1] == len(cols)
    assert len(cols) > 0


def test_build_feature_matrix_no_nans(all_rows):
    X, _ = build_feature_matrix(all_rows)
    import numpy as np
    assert not np.isnan(X).any(), "Feature matrix contains NaN values"


def test_build_feature_matrix_no_infs(all_rows):
    X, _ = build_feature_matrix(all_rows)
    import numpy as np
    assert not np.isinf(X).any(), "Feature matrix contains Inf values"


def test_build_feature_matrix_custom_cols(all_rows):
    cols = ["pagerank", "betweenness_centrality", "xmod_fan_in"]
    X, returned_cols = build_feature_matrix(all_rows, cols)
    assert returned_cols == cols
    assert X.shape[1] == 3


# ─────────────────────────────────────────────────────────────────────────────
# §2  PCA
# ─────────────────────────────────────────────────────────────────────────────

def test_pca_returns_expected_keys(slug_to_rows):
    rows = slug_to_rows["main"]
    result = run_pca(rows, n_components=5)
    for key in ("n_components", "n_nodes", "explained_variance_ratio",
                "cumulative_variance", "components", "loadings", "node_scores"):
        assert key in result, f"PCA result missing key: {key}"


def test_pca_explained_variance_sums_to_cumulative(slug_to_rows):
    import numpy as np
    rows = slug_to_rows["main"]
    result = run_pca(rows, n_components=5)
    evr = result["explained_variance_ratio"]
    cum = result["cumulative_variance"]
    expected_last = round(sum(evr), 4)
    assert abs(cum[-1] - expected_last) < 0.01


def test_pca_node_scores_count_matches_input(slug_to_rows):
    rows = slug_to_rows["main"]
    result = run_pca(rows, n_components=3)
    assert len(result["node_scores"]) == len(rows)


def test_pca_each_component_has_top_features(slug_to_rows):
    rows = slug_to_rows["main"]
    result = run_pca(rows, n_components=5)
    for comp in result["components"]:
        assert len(comp["top_features"]) > 0
        assert "feature" in comp["top_features"][0]
        assert "loading" in comp["top_features"][0]


def test_pca_all_repos(slug_to_rows):
    """PCA should succeed on all repos without error."""
    for slug, rows in slug_to_rows.items():
        result = run_pca(rows, n_components=3)
        assert "error" not in result, f"{slug}: PCA error: {result.get('error')}"


# ─────────────────────────────────────────────────────────────────────────────
# §3  Pooled dataset construction
# ─────────────────────────────────────────────────────────────────────────────

def test_pooled_dataset_shape(slug_to_rows):
    X, y, cols, slug_labels = build_pooled_dataset(slug_to_rows)
    total = sum(len(v) for v in slug_to_rows.values())
    assert X.shape[0] == total
    assert len(y) == total
    assert len(slug_labels) == total


def test_pooled_dataset_has_both_labels(slug_to_rows):
    _, y, _, _ = build_pooled_dataset(slug_to_rows, clean_slug="main")
    assert 0 in set(y), "No clean (label=0) samples"
    assert 1 in set(y), "No antipattern (label=1) samples"


def test_pooled_dataset_clean_label_matches_main(slug_to_rows):
    _, y, _, slug_labels = build_pooled_dataset(slug_to_rows, clean_slug="main")
    for label, slug in zip(y, slug_labels):
        if slug == "main":
            assert label == 0
        else:
            assert label == 1


def test_pooled_dataset_subset_callers_only(slug_to_rows):
    X_all, y_all, _, _ = build_pooled_dataset(slug_to_rows, subset_strategy="all")
    X_sub, y_sub, _, _ = build_pooled_dataset(slug_to_rows, subset_strategy="callers_only")
    assert X_sub.shape[0] <= X_all.shape[0], "Subset should not have more rows than 'all'"
    assert X_sub.shape[0] > 0, "callers_only subset is empty"


def test_pooled_dataset_subset_xmod_only(slug_to_rows):
    _, y, _, _ = build_pooled_dataset(slug_to_rows, subset_strategy="xmod_only")
    assert len(y) > 0, "xmod_only subset is empty"


def test_pooled_dataset_subset_deep_only(slug_to_rows):
    _, y, _, _ = build_pooled_dataset(slug_to_rows, subset_strategy="deep_only")
    assert len(y) > 0, "deep_only subset is empty"


# ─────────────────────────────────────────────────────────────────────────────
# §4  Random Forest feature importance
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def rf_result(slug_to_rows):
    return compute_feature_importance(slug_to_rows, clean_slug="main")


def test_rf_returns_expected_keys(rf_result):
    for key in ("feature_importances", "cv_accuracy_mean", "cv_accuracy_std",
                "n_clean", "n_antipattern", "n_features", "subset_strategy"):
        assert key in rf_result, f"RF result missing key: {key}"


def test_rf_importances_sum_to_one(rf_result):
    total = sum(f["importance"] for f in rf_result["feature_importances"])
    assert abs(total - 1.0) < 0.01, f"Importances sum to {total:.4f}, expected ~1.0"


def test_rf_importances_all_nonnegative(rf_result):
    for f in rf_result["feature_importances"]:
        assert f["importance"] >= 0, f"{f['feature']} has negative importance"


def test_rf_importance_ranks_are_sequential(rf_result):
    ranks = [f["rank"] for f in rf_result["feature_importances"]]
    assert ranks == list(range(1, len(ranks) + 1))


def test_rf_cv_accuracy_above_chance(rf_result):
    """CV accuracy must exceed 0.5 (random chance for balanced binary)."""
    assert rf_result["cv_accuracy_mean"] > 0.5, (
        f"RF CV accuracy {rf_result['cv_accuracy_mean']:.3f} ≤ 0.5 (chance level)"
    )


def test_rf_cv_accuracy_in_valid_range(rf_result):
    acc = rf_result["cv_accuracy_mean"]
    assert 0.0 <= acc <= 1.0, f"CV accuracy {acc} out of [0,1]"
    std = rf_result["cv_accuracy_std"]
    assert 0.0 <= std <= 0.5, f"CV accuracy std {std} out of range"


def test_rf_has_clean_and_antipattern_samples(rf_result):
    assert rf_result["n_clean"] > 0
    assert rf_result["n_antipattern"] > 0


def test_rf_sorted_by_importance_descending(rf_result):
    imps = [f["importance"] for f in rf_result["feature_importances"]]
    assert imps == sorted(imps, reverse=True)


# ─────────────────────────────────────────────────────────────────────────────
# §5  Subset comparison
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def subset_result(slug_to_rows):
    return compute_subset_comparison(slug_to_rows, clean_slug="main")


def test_subset_comparison_has_all_strategies(subset_result):
    for strategy in ("all", "callers_only", "xmod_only", "deep_only"):
        assert strategy in subset_result, f"Missing strategy: {strategy}"


def test_subset_comparison_each_has_accuracy(subset_result):
    for strategy, res in subset_result.items():
        if "error" in res:
            continue
        assert "cv_accuracy_mean" in res, f"{strategy}: missing cv_accuracy_mean"
        assert res["cv_accuracy_mean"] >= 0


def test_subset_comparison_top_5_features_are_strings(subset_result):
    for strategy, res in subset_result.items():
        if "error" in res:
            continue
        assert "top_5_features" in res
        for feat in res["top_5_features"]:
            assert isinstance(feat, str)


# ─────────────────────────────────────────────────────────────────────────────
# §6  Correlation matrix
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def corr_result(all_rows):
    return compute_correlation_matrix(all_rows)


def test_corr_returns_expected_keys(corr_result):
    for key in ("features", "matrix", "redundant_pairs", "low_variance", "n_redundant_pairs"):
        assert key in corr_result, f"Correlation result missing key: {key}"


def test_corr_matrix_is_square(corr_result):
    features = corr_result["features"]
    matrix = corr_result["matrix"]
    for feat in features:
        assert feat in matrix, f"{feat} missing from correlation matrix"
        assert len(matrix[feat]) == len(features)


def test_corr_diagonal_is_one(corr_result):
    matrix = corr_result["matrix"]
    for feat, row in matrix.items():
        diag = row.get(feat)
        assert diag is not None
        assert abs(diag - 1.0) < 0.01, f"Diagonal for {feat} is {diag}, expected 1.0"


def test_corr_matrix_is_symmetric(corr_result):
    matrix = corr_result["matrix"]
    features = corr_result["features"]
    for i, a in enumerate(features):
        for b in features[i + 1:]:
            r_ab = matrix[a][b]
            r_ba = matrix[b][a]
            assert abs(r_ab - r_ba) < 0.001, (
                f"Correlation matrix not symmetric: [{a}][{b}]={r_ab} vs [{b}][{a}]={r_ba}"
            )


def test_corr_values_in_valid_range(corr_result):
    matrix = corr_result["matrix"]
    for feat, row in matrix.items():
        for other, val in row.items():
            assert -1.01 <= val <= 1.01, (
                f"Correlation [{feat}][{other}]={val} out of [-1,1]"
            )


def test_corr_redundant_pairs_exceed_threshold(corr_result):
    threshold = 0.85
    for pair in corr_result["redundant_pairs"]:
        assert pair["abs_corr"] >= threshold, (
            f"Redundant pair {pair['feature_a']}↔{pair['feature_b']} "
            f"has |r|={pair['abs_corr']} < threshold {threshold}"
        )


def test_corr_pooled_data_has_some_redundancy(corr_result):
    """
    With 25 signals computed from overlapping graph primitives, we expect
    at least some highly-correlated pairs (e.g. utility_score ↔ transitive_callers).
    """
    assert corr_result["n_redundant_pairs"] >= 1, (
        "Expected at least one redundant feature pair (|r| ≥ 0.85) in enriched signals"
    )


# ─────────────────────────────────────────────────────────────────────────────
# §7  t-SNE / 2D projection
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def tsne_result(all_rows):
    # Use PCA fallback for speed in tests (deterministic, no perplexity issue)
    return compute_2d_projection(all_rows, method="pca")


def test_2d_projection_returns_expected_keys(tsne_result):
    for key in ("method_used", "n_nodes", "points"):
        assert key in tsne_result, f"2D projection result missing key: {key}"


def test_2d_projection_point_count_matches_input(all_rows, tsne_result):
    assert tsne_result["n_nodes"] == len(all_rows)
    assert len(tsne_result["points"]) == len(all_rows)


def test_2d_projection_points_have_xy(tsne_result):
    for pt in tsne_result["points"][:10]:
        assert "x" in pt and "y" in pt
        assert isinstance(pt["x"], float)
        assert isinstance(pt["y"], float)
        assert not math.isnan(pt["x"])
        assert not math.isnan(pt["y"])


def test_2d_projection_points_not_all_identical(tsne_result):
    xs = {pt["x"] for pt in tsne_result["points"]}
    ys = {pt["y"] for pt in tsne_result["points"]}
    assert len(xs) > 1, "All x-coordinates are identical — projection failed"
    assert len(ys) > 1, "All y-coordinates are identical — projection failed"


# ─────────────────────────────────────────────────────────────────────────────
# §8  Cohen's d discriminability
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def disc_result(slug_to_rows):
    labeled = {"clean": slug_to_rows["main"]}
    for slug, rows in slug_to_rows.items():
        if slug != "main":
            labeled[slug] = rows
    return compute_discriminability(labeled)


def test_disc_has_feature_list(disc_result):
    assert "features" in disc_result
    assert len(disc_result["features"]) > 0


def test_disc_sorted_by_cohens_d_descending(disc_result):
    ds = [f["max_cohens_d"] for f in disc_result["features"]]
    assert ds == sorted(ds, reverse=True)


def test_disc_cohens_d_nonnegative(disc_result):
    for f in disc_result["features"]:
        assert f["max_cohens_d"] >= 0, f"{f['feature']}: negative Cohen's d"


def test_disc_top_signal_has_meaningful_effect(disc_result):
    """
    The top-ranked signal should have Cohen's d > 0.1 (small effect).
    If all signals are d < 0.1, the enrichment pipeline has zero discriminability.
    """
    top_d = disc_result["features"][0]["max_cohens_d"]
    assert top_d > 0.1, (
        f"Top discriminability signal has d={top_d:.3f} — no signal separates "
        f"antipatterns from clean code"
    )


def test_disc_reference_group_is_clean(disc_result):
    assert disc_result["reference_group"] == "clean"


def test_disc_per_group_means_present(disc_result):
    first = disc_result["features"][0]
    assert "group_means" in first
    assert "clean" in first["group_means"]
