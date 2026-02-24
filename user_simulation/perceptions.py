"""
perceptions.py  —  Layer 2: What the graph communicates

Translates raw layout measurements into domain-level quantities in the
vocabulary of software engineering.

Rules:
  - Every field is a measured quantity (int or float) — not a boolean
  - Thresholds live in user formulas, not here
  - No imports from the application — only the raw facts dict as input
  - This layer is allowed to normalise, rename, and reinterpret raw values,
    but not to make judgements about them

The facts dict is produced by layoutMetrics.js → computeFacts(), serialised
to JSON, and passed here. Field paths match the JS output exactly.

What users say in meetings:
  "I need at least 3 modules."
  "If there are more than 4 cross-module edges, the modules need to be
   further apart."
  "I can tolerate chain elongation as low as 1.6, but only if straightness
   stays above 0.65."

Those are the constraints. This file is just the ruler.
"""

from __future__ import annotations
from dataclasses import dataclass
from collections import Counter
import math

import numpy as np
from scipy.spatial import ConvexHull
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.linear_model import LinearRegression
from sklearn.metrics import silhouette_score, adjusted_rand_score
from sklearn.preprocessing import LabelEncoder


@dataclass(frozen=True)
class Perceptions:
    """
    Measured quantities that capture what the graph communicates to a viewer.

    These are NOT booleans. They are the values that users reason over
    when forming judgements like:
      "I need module_count >= 3"
      "If blob_integrity < 0.90, cross_edge_visibility must exceed 0.85"
      "Chain elongation of 1.6 is fine as long as straightness > 0.65"

    All fields are documented with their unit and range.
    """

    # ── Module structure ──────────────────────────────────────────────────────

    # Number of distinct module regions visible in the graph
    module_count: int

    # Minimum pixel clearance between module regions (0.0 when single module)
    module_separation: float

    # Fraction of nodes rendered inside their own module's convex hull (0–1)
    blob_integrity: float

    # Within-group proximity relative to between-group (0–1; 1 = perfectly cohesive)
    gestalt_cohesion: float

    # ── Dependencies ──────────────────────────────────────────────────────────

    # Fraction of cross-module edges that are visually discernible (0–1)
    cross_edge_visibility: float

    # Total number of cross-module edges in the graph
    cross_edge_count: int

    # Fraction of all edges that cross a module boundary (0–1)
    cross_edge_ratio: float

    # Fraction of all edges with a visible gap between source and target (0–1)
    edge_visibility: float

    # ── Call chains & flow ────────────────────────────────────────────────────

    # PCA elongation ratio of sequential call paths (1.0 = circular, >2.0 = very linear)
    chain_elongation: float

    # Fraction of chain steps pointing in the dominant direction (0–1)
    chain_straightness: float

    # ── Node prominence ───────────────────────────────────────────────────────

    # Normalised distance of high-degree nodes from their callee-cloud centroid
    # (0 = perfectly central, 1 = far from centre)
    hub_centrality_error: float

    # Coefficient of variation in node sizes (0 = all same size, >0.3 = meaningful spread)
    node_size_cv: float

    # ── Cognitive load ────────────────────────────────────────────────────────

    # Fraction of nodes that visually overlap at least one other node (0–1)
    node_overlap: float

    # Normalised density of edge crossings (0 = none, 1 = maximum possible)
    edge_crossings: float

    # Per-edge layout stress: how well spatial distance tracks code coupling
    # (0 = perfect, higher = distances mismatch coupling)
    layout_stress: float

    # ── Statistical: degree distribution ─────────────────────────────────────

    # Gini coefficient of node degree distribution
    # (0 = all nodes equal degree; 1 = one node has all the edges)
    degree_gini: float

    # max_degree / mean_degree — how much the busiest node dominates
    # (1.0 = all equal; 10+ = one extreme hub)
    hub_degree_ratio: float

    # Normalised Shannon entropy of the degree distribution
    # (0 = all nodes same degree; 1 = maximally diverse)
    degree_entropy: float

    # ── Statistical: edge geometry ────────────────────────────────────────────

    # Normalised Shannon entropy of edge direction angles (18 × 20° bins)
    # (0 = all edges same direction; 1 = uniformly distributed angles)
    edge_angle_entropy: float

    # ── Geometric: global layout shape ───────────────────────────────────────

    # PCA major-axis / minor-axis ratio across ALL node positions
    # (1.0 = circular spread; high = globally elongated)
    graph_aspect_ratio: float

    # ConvexHull area / bounding-box area of all node positions
    # (1.0 = nodes fill the hull compactly; low = sparse or ring-shaped)
    spatial_compactness: float

    # ── sklearn cluster quality ───────────────────────────────────────────────

    # Silhouette score with module labels as cluster assignments
    # (-1 = badly grouped; 0 = overlapping; 1 = perfectly separated)
    silhouette_by_module: float

    # Adjusted Rand Index: KMeans(k=module_count) on positions vs true module labels
    # (0 = spatial clusters don't match modules; 1 = perfect alignment)
    spatial_cluster_purity: float

    # ── sklearn regression: chain linearity ───────────────────────────────────

    # Mean fraction of variance explained by PC1 across detected chain positions
    # (0 = chains are circular blobs; 1 = chains are perfect straight lines)
    chain_r2: float


# ── Helpers ───────────────────────────────────────────────────────────────────

def _degree_gini(values: list[float]) -> float:
    """Gini coefficient of a non-negative distribution."""
    if not values or sum(values) == 0:
        return 0.0
    s = sorted(values)
    n = len(s)
    numer = sum((2 * i - n + 1) * v for i, v in enumerate(s))
    return abs(numer / (n * sum(s)))


def _shannon_entropy_normalised(values: list) -> float:
    """Shannon entropy of a discrete distribution, normalised to [0, 1]."""
    counts = np.array(list(Counter(values).values()), dtype=float)
    if len(counts) <= 1:
        return 0.0
    probs = counts / counts.sum()
    raw   = -np.sum(probs * np.log2(probs + 1e-12))
    return float(raw / math.log2(len(values)))


def _edge_angle_entropy(angles: list[float]) -> float:
    """Entropy of edge directions binned into 18 × 20° buckets."""
    if len(angles) < 2:
        return 1.0   # no structure to measure → assume isotropic
    bins  = np.histogram(angles, bins=18, range=(-180, 180))[0]
    total = bins.sum()
    if total == 0:
        return 1.0
    probs = bins[bins > 0] / total
    raw   = -np.sum(probs * np.log2(probs))
    return float(min(1.0, raw / math.log2(18)))


def _silhouette_and_ari(
    node_list: list[dict],
    module_count: int,
) -> tuple[float, float]:
    """
    Compute silhouette score (module labels) and ARI (KMeans vs module labels).
    Returns (silhouette, ari). Falls back to (1.0, 1.0) for single-module graphs.
    """
    if module_count < 2 or len(node_list) < max(4, module_count + 1):
        return 1.0, 1.0   # single module or too few nodes → trivially good

    X      = np.array([[n["x"], n["y"]] for n in node_list], dtype=float)
    groups = [n["g"] for n in node_list]
    le     = LabelEncoder()
    labels = le.fit_transform(groups)

    try:
        sil = float(silhouette_score(X, labels))
    except Exception:
        sil = 0.0

    try:
        km   = KMeans(n_clusters=module_count, n_init=10, random_state=42)
        pred = km.fit_predict(X)
        ari  = float(max(0.0, adjusted_rand_score(labels, pred)))
    except Exception:
        ari = 0.0

    return sil, ari


def _chain_r2(chain_node_pos: list[list[dict]]) -> float:
    """
    Mean fraction of variance explained by PC1 across all chains.
    Uses sklearn PCA — measures how 'linear' the chain node positions are.
    """
    r2_vals = []
    for pts in chain_node_pos:
        if len(pts) < 3:
            continue
        pos = np.array([[p["x"], p["y"]] for p in pts], dtype=float)
        try:
            pca = PCA(n_components=2)
            pca.fit(pos)
            r2_vals.append(float(pca.explained_variance_ratio_[0]))
        except Exception:
            pass
    return float(np.mean(r2_vals)) if r2_vals else 1.0


def _graph_aspect_ratio(node_list: list[dict]) -> float:
    """PCA major/minor axis ratio of all node positions."""
    if len(node_list) < 3:
        return 1.0
    pos = np.array([[n["x"], n["y"]] for n in node_list], dtype=float)
    try:
        pca = PCA(n_components=2)
        pca.fit(pos)
        var = pca.explained_variance_
        return float(math.sqrt(var[0] / (var[1] + 1e-6)))
    except Exception:
        return 1.0


def _spatial_compactness(node_list: list[dict]) -> float:
    """ConvexHull area / bounding-box area of node positions."""
    if len(node_list) < 4:
        return 1.0
    pos = np.array([[n["x"], n["y"]] for n in node_list], dtype=float)
    try:
        hull     = ConvexHull(pos)
        hull_area = hull.volume   # in 2D, ConvexHull.volume is the area
        dx = pos[:, 0].max() - pos[:, 0].min()
        dy = pos[:, 1].max() - pos[:, 1].min()
        bbox_area = dx * dy
        return float(min(1.0, hull_area / (bbox_area + 1e-6)))
    except Exception:
        return 1.0


# ── Derivation from raw facts ─────────────────────────────────────────────────

def compute_perceptions(facts: dict) -> Perceptions:
    """
    Extract domain quantities from the raw facts dict produced by
    layoutMetrics.js → computeFacts().

    This is the ONLY place that reads raw JSON keys.
    Everything above sees only named, documented quantities.
    """
    sep         = facts["blobSeparation"]["minClearance"]     # None if single module
    integr      = facts["blobIntegrity"]["ratio"]
    cohesion    = facts["gestaltProximity"]["cohesion"]
    cross_vis   = facts["crossModuleEdgeVisibility"]["ratio"]
    cross_count = facts["crossModuleEdgeVisibility"]["count"]
    edge_vis    = facts["edgeVisibility"]["ratio"]
    chain_elo   = facts["chainLinearity"]["ratio"]
    chain_str   = facts["chainLinearity"]["straightness"]
    hub         = facts["hubCentrality"]["avgNormalised"]
    overlap     = facts["nodeOverlap"]["ratio"]
    stress      = facts["layoutStress"]["perEdge"]
    crossings   = facts["edgeCrossings"]["normalised"]
    size_cv     = facts["nodeSizeVariation"]["cv"]
    mod_count   = facts.get("moduleCount", 1)
    cross_ratio = facts.get("crossEdgeRatio", 0.0)

    # ── Statistical: degree distribution ─────────────────────────────────────
    deg_dist      = facts.get("degreeDist", {})
    deg_values    = deg_dist.get("values", [])
    deg_mean      = float(deg_dist.get("mean", 0.0)) or 1.0
    deg_max       = float(deg_dist.get("max",  0.0))
    deg_gini_raw  = float(deg_dist.get("gini", 0.0))

    # ── Statistical: edge angles ──────────────────────────────────────────────
    edge_angles   = facts.get("edgeAngles", [])

    # ── Spatial analysis (sklearn) ────────────────────────────────────────────
    node_list       = facts.get("nodeList", [])
    chain_node_pos  = facts.get("chainNodePos", [])

    sil, ari = _silhouette_and_ari(node_list, int(mod_count))

    return Perceptions(
        module_count          = int(mod_count),
        module_separation     = float(sep) if sep is not None else 0.0,
        blob_integrity        = float(integr),
        gestalt_cohesion      = float(cohesion),
        cross_edge_visibility = float(cross_vis),
        cross_edge_count      = int(cross_count),
        cross_edge_ratio      = float(cross_ratio),
        edge_visibility       = float(edge_vis),
        chain_elongation      = float(chain_elo),
        chain_straightness    = float(chain_str),
        hub_centrality_error  = float(hub),
        node_size_cv          = float(size_cv),
        node_overlap          = float(overlap),
        edge_crossings        = float(crossings),
        layout_stress         = float(stress),
        # Statistical
        degree_gini           = float(deg_gini_raw),
        hub_degree_ratio      = float(deg_max / deg_mean),
        degree_entropy        = _shannon_entropy_normalised(deg_values),
        edge_angle_entropy    = _edge_angle_entropy(edge_angles),
        # Geometric
        graph_aspect_ratio    = _graph_aspect_ratio(node_list),
        spatial_compactness   = _spatial_compactness(node_list),
        # sklearn cluster
        silhouette_by_module  = float(sil),
        spatial_cluster_purity= float(ari),
        # sklearn regression
        chain_r2              = _chain_r2(chain_node_pos),
    )
