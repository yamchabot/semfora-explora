"""
Semfora offline ML analysis pass.

Loads all enriched taskboard DBs, pools node features into a labeled
dataset, and runs the full dimensionality analysis suite:

  - PCA (per repo)
  - Random Forest feature importance (pooled, clean vs antipattern)
  - Correlation matrix (redundancy detection)
  - Subset comparison (which node subsets are most discriminable)
  - Per-antipattern Cohen's d discriminability
  - Optional t-SNE 2D projection

Usage:
    python3 analyze.py                          # all taskboard fixtures
    python3 analyze.py --out data/report.json   # custom output path
    python3 analyze.py --tsne                   # include 2D projection (slow)
    python3 analyze.py --slugs main god-object  # specific slugs only

Output: JSON report written to data/analysis_report.json (default).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

DATA_DIR   = Path(__file__).parent.parent / "data"
BACKEND    = Path(__file__).parent
sys.path.insert(0, str(BACKEND))

from enrich import enrich, enriched_path  # noqa: E402
from analytics.dimensionality import (    # noqa: E402
    FEATURE_COLS,
    run_pca,
    compute_discriminability,
    compute_feature_importance,
    compute_correlation_matrix,
    compute_2d_projection,
    compute_subset_comparison,
)

# All taskboard fixture slugs (original 8 + 3 new antipatterns)
DEFAULT_SLUGS = [
    "main",
    "antipattern-circular-deps",
    "antipattern-dead-code-graveyard",
    "antipattern-feature-creep",
    "antipattern-god-object",
    "antipattern-tight-coupling",
    "antipattern-unstable-foundation",
    "antipattern-util-dumping-ground",
    "antipattern-shotgun-surgery",
    "antipattern-anemic-domain-model",
    "antipattern-hub-spoke",
]


# ── Data loading ──────────────────────────────────────────────────────────────

def load_enriched_rows(db_path: Path) -> list[dict]:
    """
    Load all non-external nodes with their enriched features.
    Returns list of dicts with all node + node_features columns.
    """
    ep = enriched_path(db_path)
    if not ep.exists():
        print(f"  Enriching {db_path.name}...", flush=True)
        enrich(db_path, verbose=False)

    conn = sqlite3.connect(str(ep))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            n.hash, n.name, n.module,
            n.caller_count, n.callee_count, n.complexity,
            nf.scc_id, nf.scc_size, nf.scc_cross_module,
            nf.topological_depth, nf.reverse_topological_depth,
            nf.transitive_callers, nf.transitive_callees,
            nf.betweenness_centrality, nf.pagerank,
            nf.hub_score, nf.authority_score, nf.clustering_coeff,
            nf.xmod_fan_in, nf.xmod_fan_out, nf.xmod_call_ratio,
            nf.dominant_callee_mod, nf.dominant_callee_frac,
            nf.utility_score, nf.stability_rank,
            nf.complexity_pct, nf.middleman_score,
            nf.community_id, nf.community_dominant_mod, nf.community_alignment
        FROM nodes n
        JOIN node_features nf ON n.hash = nf.hash
        WHERE n.hash NOT LIKE 'ext:%'
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def load_all_slugs(slugs: list[str]) -> dict[str, list[dict]]:
    slug_to_rows: dict[str, list[dict]] = {}
    for slug in slugs:
        db_path = DATA_DIR / f"taskboard-{slug}@HEAD.db"
        if not db_path.exists():
            print(f"  SKIP {slug} — DB not found", flush=True)
            continue
        rows = load_enriched_rows(db_path)
        slug_to_rows[slug] = rows
        print(f"  Loaded {slug}: {len(rows)} nodes", flush=True)
    return slug_to_rows


# ── Analysis passes ───────────────────────────────────────────────────────────

def run_per_repo_pca(slug_to_rows: dict[str, list[dict]]) -> dict:
    results = {}
    for slug, rows in slug_to_rows.items():
        pca = run_pca(rows, n_components=5)
        results[slug] = {
            "n_nodes":               pca.get("n_nodes"),
            "cumulative_variance_5": pca.get("cumulative_variance", [0]*5)[-1] if "cumulative_variance" in pca else None,
            "top_component":         pca.get("components", [{}])[0],
        }
    return results


def run_rf_analysis(slug_to_rows: dict[str, list[dict]]) -> dict:
    """RF importance under 4 subset strategies."""
    return compute_subset_comparison(slug_to_rows, clean_slug="main")


def run_discriminability(slug_to_rows: dict[str, list[dict]]) -> dict:
    """Cohen's d per feature vs clean baseline."""
    labeled = {"clean": slug_to_rows.get("main", [])}
    for slug, rows in slug_to_rows.items():
        if slug != "main":
            labeled[slug] = rows
    return compute_discriminability(labeled)


def run_correlation(slug_to_rows: dict[str, list[dict]]) -> dict:
    """Correlation matrix on pooled data."""
    all_rows = [r for rows in slug_to_rows.values() for r in rows]
    return compute_correlation_matrix(all_rows)


def run_tsne(slug_to_rows: dict[str, list[dict]]) -> dict:
    """t-SNE projection on pooled data (annotated with slug)."""
    all_rows: list[dict] = []
    for slug, rows in slug_to_rows.items():
        for r in rows:
            all_rows.append({**r, "_slug": slug})
    result = compute_2d_projection(all_rows)
    # Annotate points with slug
    if "points" in result:
        for i, pt in enumerate(result["points"]):
            pt["slug"] = all_rows[i].get("_slug", "")
    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Semfora ML analysis pass.")
    parser.add_argument("--out",   default=str(DATA_DIR / "analysis_report.json"),
                        help="Output JSON path")
    parser.add_argument("--tsne",  action="store_true",
                        help="Include t-SNE 2D projection (adds ~10s)")
    parser.add_argument("--slugs", nargs="*", default=DEFAULT_SLUGS,
                        help="Slugs to include (default: all taskboard fixtures)")
    args = parser.parse_args()

    t0 = time.time()
    print(f"Loading {len(args.slugs)} repos...", flush=True)
    slug_to_rows = load_all_slugs(args.slugs)

    if len(slug_to_rows) < 2:
        print("Need at least 2 repos. Abort."); return

    report: dict = {
        "slugs_loaded":   list(slug_to_rows.keys()),
        "total_nodes":    sum(len(v) for v in slug_to_rows.values()),
    }

    print("Running per-repo PCA...", flush=True)
    report["pca_per_repo"] = run_per_repo_pca(slug_to_rows)

    print("Running RF feature importance (4 subset strategies)...", flush=True)
    report["rf_importance"] = run_rf_analysis(slug_to_rows)

    print("Running Cohen's d discriminability...", flush=True)
    report["discriminability"] = run_discriminability(slug_to_rows)

    print("Computing correlation matrix...", flush=True)
    report["correlation"] = run_correlation(slug_to_rows)

    if args.tsne:
        print("Running t-SNE projection...", flush=True)
        report["tsne"] = run_tsne(slug_to_rows)

    report["elapsed_seconds"] = round(time.time() - t0, 2)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nDone in {report['elapsed_seconds']}s → {out_path}", flush=True)

    # Print summary
    rf_all = report["rf_importance"].get("all", {})
    if "top_5_features" in rf_all:
        print(f"\nTop 5 features (all nodes, RF): {rf_all['top_5_features']}")
        print(f"CV accuracy: {rf_all['cv_accuracy_mean']:.3f} ± {rf_all['cv_accuracy_std']:.3f}")

    corr = report["correlation"]
    if "n_redundant_pairs" in corr:
        print(f"\nRedundant pairs (|r| ≥ 0.85): {corr['n_redundant_pairs']}")
        for pair in corr.get("redundant_pairs", [])[:3]:
            print(f"  {pair['feature_a']} ↔ {pair['feature_b']}: r={pair['correlation']:.3f}")


if __name__ == "__main__":
    main()
