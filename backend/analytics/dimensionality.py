"""
Dimensionality reduction and signal evaluation for enriched node features.

Pure functions — take feature matrices (list of dicts), return results.
Uses PCA to identify which signals explain the most variance,
and discriminability analysis to find which signals best separate
clean from anti-pattern code.
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


# ── Feature columns used in PCA (numeric only) ───────────────────────────────

FEATURE_COLS = [
    "scc_size",
    "scc_cross_module",
    "topological_depth",
    "reverse_topological_depth",
    "transitive_callers",
    "transitive_callees",
    "betweenness_centrality",
    "pagerank",
    "hub_score",
    "authority_score",
    "clustering_coeff",
    "xmod_fan_in",
    "xmod_fan_out",
    "xmod_call_ratio",
    "dominant_callee_frac",
    "utility_score",
    "stability_rank",
    "complexity_pct",
    "middleman_score",
    "community_alignment",
    # Raw node fields joined in
    "caller_count",
    "callee_count",
    "complexity",
]


def _safe(val, default=0.0):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return float(default)
    return float(val)


def build_feature_matrix(
    rows: list[dict],
    cols: list[str] | None = None,
) -> tuple[np.ndarray, list[str]]:
    """
    Convert a list of node dicts (from nodes JOIN node_features) into a
    numeric feature matrix.

    Returns (matrix, column_names).
    """
    cols = cols or FEATURE_COLS
    X = np.array([[_safe(r.get(c)) for c in cols] for r in rows])
    return X, cols


def run_pca(
    rows: list[dict],
    n_components: int = 10,
    cols: list[str] | None = None,
) -> dict:
    """
    Run PCA on node feature vectors.

    Returns:
        explained_variance_ratio  — variance explained per component
        cumulative_variance       — cumulative variance
        loadings                  — {feature: [loading per component]}
        top_features_per_component — top 5 features by |loading| per component
        node_scores               — each input row annotated with PC1..PCN scores
    """
    X, col_names = build_feature_matrix(rows, cols)

    # Drop constant columns
    variances = X.var(axis=0)
    keep = variances > 0
    X_filtered = X[:, keep]
    kept_cols = [c for c, k in zip(col_names, keep) if k]

    if X_filtered.shape[1] == 0 or X_filtered.shape[0] < 2:
        return {"error": "Insufficient data for PCA"}

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_filtered)

    n_components = min(n_components, X_filtered.shape[1], X_filtered.shape[0])
    pca = PCA(n_components=n_components)
    scores = pca.fit_transform(X_scaled)

    loadings = {
        col: [round(float(pca.components_[i][j]), 4) for i in range(n_components)]
        for j, col in enumerate(kept_cols)
    }

    top_per_component = []
    for i in range(n_components):
        comp = [(abs(pca.components_[i][j]), kept_cols[j], round(float(pca.components_[i][j]), 4))
                for j in range(len(kept_cols))]
        comp.sort(reverse=True)
        top_per_component.append({
            "component":      i + 1,
            "variance_explained": round(float(pca.explained_variance_ratio_[i]), 4),
            "top_features":   [{"feature": name, "loading": val} for _, name, val in comp[:5]],
        })

    node_scores = []
    for idx, row in enumerate(rows):
        entry = {
            "hash":   row.get("hash", ""),
            "name":   row.get("name", ""),
            "module": row.get("module", ""),
        }
        for i in range(n_components):
            entry[f"pc{i+1}"] = round(float(scores[idx, i]), 4)
        node_scores.append(entry)

    return {
        "n_components":             n_components,
        "n_nodes":                  len(rows),
        "features_used":            kept_cols,
        "features_dropped_constant": [c for c, k in zip(col_names, keep) if not k],
        "explained_variance_ratio": [round(float(v), 4) for v in pca.explained_variance_ratio_],
        "cumulative_variance":      [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)],
        "components":               top_per_component,
        "loadings":                 loadings,
        "node_scores":              node_scores,
    }


def compute_discriminability(
    labeled_groups: dict[str, list[dict]],
    cols: list[str] | None = None,
) -> dict:
    """
    For each feature, compute how well it separates groups.

    labeled_groups — {"clean": [rows], "antipattern_god": [rows], ...}

    Uses:
      - Mean and std per group
      - Cohen's d between each group and the reference group ("clean" if present)
      - Variance ratio (between-group / within-group)

    Returns ranking of features by discriminability.
    """
    cols = cols or FEATURE_COLS
    ref_key = "clean" if "clean" in labeled_groups else list(labeled_groups)[0]
    ref_rows = labeled_groups[ref_key]
    X_ref, _ = build_feature_matrix(ref_rows, cols)
    ref_means = X_ref.mean(axis=0)
    ref_stds  = X_ref.std(axis=0) + 1e-9

    feature_stats = []
    for j, col in enumerate(cols):
        cohens_ds = {}
        group_means = {}
        group_stds  = {}
        for group, rows in labeled_groups.items():
            X_g, _ = build_feature_matrix(rows, [col])
            vals = X_g[:, 0]
            gm = float(vals.mean())
            gs = float(vals.std()) + 1e-9
            group_means[group] = round(gm, 4)
            group_stds[group]  = round(gs, 4)
            if group != ref_key:
                d = abs(gm - float(ref_means[j])) / float(ref_stds[j])
                cohens_ds[group] = round(d, 4)

        max_d = max(cohens_ds.values(), default=0)
        feature_stats.append({
            "feature":     col,
            "max_cohens_d": round(max_d, 4),
            "group_means": group_means,
            "group_stds":  group_stds,
            "cohens_d_per_group": cohens_ds,
        })

    feature_stats.sort(key=lambda x: -x["max_cohens_d"])
    return {
        "reference_group": ref_key,
        "features":        feature_stats,
    }
