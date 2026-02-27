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


# ══════════════════════════════════════════════════════════════════════════════
# ML tools — added in enrichment-ml pass
# ══════════════════════════════════════════════════════════════════════════════

def build_pooled_dataset(
    slug_to_rows: dict[str, list[dict]],
    clean_slug: str = "main",
    cols: list[str] | None = None,
    subset_strategy: str = "all",
) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    """
    Pool node rows from multiple repos into one labeled dataset.

    Labels:
      0 = clean (matches clean_slug)
      1 = antipattern (everything else)

    subset_strategy:
      "all"           — use all nodes (default)
      "callers_only"  — only nodes with caller_count > 0
      "xmod_only"     — only nodes with xmod_fan_in > 0 or xmod_fan_out > 0
      "deep_only"     — only nodes with topological_depth >= 2

    Returns (X, y, col_names, slug_labels)
    where slug_labels[i] is the repo slug for row i.
    """
    cols = cols or FEATURE_COLS
    all_rows: list[dict] = []
    all_labels: list[int] = []
    slug_labels: list[str] = []

    for slug, rows in slug_to_rows.items():
        label = 0 if slug == clean_slug else 1
        filtered = _apply_subset(rows, subset_strategy)
        for row in filtered:
            all_rows.append(row)
            all_labels.append(label)
            slug_labels.append(slug)

    X, col_names = build_feature_matrix(all_rows, cols)
    y = np.array(all_labels, dtype=int)
    return X, y, col_names, slug_labels


def _apply_subset(rows: list[dict], strategy: str) -> list[dict]:
    if strategy == "all":
        return rows
    if strategy == "callers_only":
        return [r for r in rows if _safe(r.get("caller_count")) > 0]
    if strategy == "xmod_only":
        return [r for r in rows if _safe(r.get("xmod_fan_in")) > 0 or _safe(r.get("xmod_fan_out")) > 0]
    if strategy == "deep_only":
        return [r for r in rows if _safe(r.get("topological_depth")) >= 2]
    return rows


def compute_feature_importance(
    slug_to_rows: dict[str, list[dict]],
    clean_slug: str = "main",
    cols: list[str] | None = None,
    subset_strategy: str = "all",
    n_estimators: int = 200,
    random_state: int = 42,
) -> dict:
    """
    Train a Random Forest classifier (clean vs antipattern) and return
    feature importances.  Also reports cross-validated accuracy.

    Returns:
        feature_importances  — list of {feature, importance, rank} sorted desc
        cv_accuracy_mean     — mean CV accuracy (5-fold)
        cv_accuracy_std      — std of CV accuracy
        n_clean              — number of clean nodes
        n_antipattern        — number of antipattern nodes
        subset_strategy      — strategy used
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler

    cols = cols or FEATURE_COLS
    X, y, col_names, _ = build_pooled_dataset(
        slug_to_rows, clean_slug, cols, subset_strategy
    )

    if len(set(y)) < 2:
        return {"error": "Need both clean and antipattern samples"}
    if X.shape[0] < 10:
        return {"error": "Too few samples for RF"}

    # Drop constant columns
    variances = X.var(axis=0)
    keep = variances > 0
    X_filtered = X[:, keep]
    kept_cols = [c for c, k in zip(col_names, keep) if k]

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_filtered)

    rf = RandomForestClassifier(
        n_estimators=n_estimators,
        random_state=random_state,
        class_weight="balanced",
        n_jobs=-1,
    )

    cv_scores = cross_val_score(rf, X_scaled, y, cv=5, scoring="accuracy")
    rf.fit(X_scaled, y)

    importances = sorted(
        [
            {"feature": col, "importance": round(float(imp), 6), "rank": 0}
            for col, imp in zip(kept_cols, rf.feature_importances_)
        ],
        key=lambda x: -x["importance"],
    )
    for i, item in enumerate(importances):
        item["rank"] = i + 1

    return {
        "feature_importances": importances,
        "cv_accuracy_mean":    round(float(cv_scores.mean()), 4),
        "cv_accuracy_std":     round(float(cv_scores.std()), 4),
        "n_clean":             int((y == 0).sum()),
        "n_antipattern":       int((y == 1).sum()),
        "n_features":          len(kept_cols),
        "subset_strategy":     subset_strategy,
    }


def compute_correlation_matrix(
    rows: list[dict],
    cols: list[str] | None = None,
    redundancy_threshold: float = 0.85,
) -> dict:
    """
    Compute pairwise Pearson correlations between features.
    Flag pairs above redundancy_threshold as potentially redundant.

    Returns:
        matrix        — {feature_a: {feature_b: correlation}}
        redundant_pairs — list of {feature_a, feature_b, correlation}
        low_variance  — features dropped for having zero variance
    """
    cols = cols or FEATURE_COLS
    X, col_names = build_feature_matrix(rows, cols)

    variances = X.var(axis=0)
    keep = variances > 0
    X_filtered = X[:, keep]
    kept_cols = [c for c, k in zip(col_names, keep) if k]
    low_var = [c for c, k in zip(col_names, keep) if not k]

    if X_filtered.shape[1] < 2:
        return {"error": "Need at least 2 non-constant features"}

    # Pearson correlation matrix
    corr = np.corrcoef(X_filtered.T)

    matrix: dict[str, dict[str, float]] = {}
    for i, ci in enumerate(kept_cols):
        matrix[ci] = {}
        for j, cj in enumerate(kept_cols):
            matrix[ci][cj] = round(float(corr[i, j]), 4)

    redundant_pairs = []
    for i in range(len(kept_cols)):
        for j in range(i + 1, len(kept_cols)):
            r = abs(corr[i, j])
            if r >= redundancy_threshold:
                redundant_pairs.append({
                    "feature_a":   kept_cols[i],
                    "feature_b":   kept_cols[j],
                    "correlation": round(float(corr[i, j]), 4),
                    "abs_corr":    round(float(r), 4),
                })

    redundant_pairs.sort(key=lambda x: -x["abs_corr"])

    return {
        "features":         kept_cols,
        "matrix":           matrix,
        "redundant_pairs":  redundant_pairs,
        "low_variance":     low_var,
        "n_redundant_pairs": len(redundant_pairs),
    }


def compute_2d_projection(
    rows: list[dict],
    cols: list[str] | None = None,
    method: str = "tsne",
    random_state: int = 42,
    perplexity: float = 30.0,
) -> dict:
    """
    Project node feature vectors into 2D for visualisation.

    method: "tsne" | "pca"

    Returns:
        points — list of {hash, name, module, x, y} for each input row
        method_used
        n_nodes
    """
    from sklearn.manifold import TSNE
    from sklearn.preprocessing import StandardScaler

    cols = cols or FEATURE_COLS
    X, col_names = build_feature_matrix(rows, cols)

    variances = X.var(axis=0)
    keep = variances > 0
    X_filtered = X[:, keep]

    if X_filtered.shape[0] < 4:
        return {"error": "Need at least 4 nodes for projection"}
    if X_filtered.shape[1] < 2:
        return {"error": "Need at least 2 non-constant features"}

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_filtered)

    if method == "tsne":
        perp = min(perplexity, max(2, X_scaled.shape[0] // 3))
        reducer = TSNE(
            n_components=2,
            random_state=random_state,
            perplexity=perp,
        )
        coords = reducer.fit_transform(X_scaled)
        method_used = f"tsne(perplexity={perp:.0f})"
    else:  # pca fallback
        pca = PCA(n_components=2, random_state=random_state)
        coords = pca.fit_transform(X_scaled)
        method_used = "pca"

    points = []
    for idx, row in enumerate(rows):
        points.append({
            "hash":   row.get("hash", ""),
            "name":   row.get("name", ""),
            "module": row.get("module", ""),
            "x":      round(float(coords[idx, 0]), 4),
            "y":      round(float(coords[idx, 1]), 4),
        })

    return {
        "method_used": method_used,
        "n_nodes":     len(rows),
        "points":      points,
    }


def compute_subset_comparison(
    slug_to_rows: dict[str, list[dict]],
    clean_slug: str = "main",
    cols: list[str] | None = None,
) -> dict:
    """
    Run feature importance under each subset strategy to see which subsets
    produce more discriminable signals.

    Returns per-strategy: cv_accuracy, top_5_features, n_samples.
    """
    strategies = ["all", "callers_only", "xmod_only", "deep_only"]
    results = {}
    for strategy in strategies:
        res = compute_feature_importance(
            slug_to_rows, clean_slug, cols, subset_strategy=strategy
        )
        if "error" in res:
            results[strategy] = res
            continue
        results[strategy] = {
            "cv_accuracy_mean": res["cv_accuracy_mean"],
            "cv_accuracy_std":  res["cv_accuracy_std"],
            "n_clean":          res["n_clean"],
            "n_antipattern":    res["n_antipattern"],
            "top_5_features": [
                f["feature"] for f in res["feature_importances"][:5]
            ],
        }
    return results
