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

──────────────────────────────────────────────────────────────────────────────
PERCEPTION TIERS
──────────────────────────────────────────────────────────────────────────────

Tier 1 — Raw (24 fields)
  Directly extracted from the JS instrumentation output. One-to-one with
  computeFacts() return keys. Lightly renamed for readability.

Tier 2 — Composed (15 fields)
  Pure-math combinations of raw perceptions. Semantically richer scalar
  summaries: readability, module_clarity, hub_prominence, etc.

Tier 3 — Z3 Archetype (5 fields)
  Z3 constraint conjunctions evaluated against fixed measured values via the
  shim's Solver. Each returns 1.0 (SAT) or 0.0 (UNSAT). Classifies the
  graph into named structural archetypes.

Tier 4 — Z3 Solver (8 fields)
  Binary search using the shim's Solver as an oracle to find minimum/maximum
  perception values that satisfy composed formulas. E.g. "what minimum
  silhouette_by_module makes module_clarity ≥ 0.5?" Z3 is used to *find*
  values, not just *check* them.

──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations
from dataclasses import dataclass
from collections import Counter
import math

import numpy as np
from scipy.spatial import ConvexHull
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score, adjusted_rand_score
from sklearn.preprocessing import LabelEncoder


# ──────────────────────────────────────────────────────────────────────────────
# Perceptions dataclass
# ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Perceptions:
    """
    52 measured quantities that capture what the graph communicates.
    Organised in four tiers — raw, composed, Z3 archetype, Z3 solver.
    See module docstring for the full architecture.
    """

    # ═══════════════════════════════════════════════════════════════════════════
    # TIER 1 — Raw (from JS instrumentation)                             24 fields
    # ═══════════════════════════════════════════════════════════════════════════

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

    # ── Geometric ────────────────────────────────────────────────────────────

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

    # ═══════════════════════════════════════════════════════════════════════════
    # TIER 2 — Composed (semantic combinations of raw perceptions)        15 fields
    # ═══════════════════════════════════════════════════════════════════════════

    # ── Holistic quality composites ───────────────────────────────────────────

    # chain_r2 × norm(chain_elongation, max=3) × chain_straightness
    # How well chains communicate sequential flow as a single scalar.
    chain_quality: float

    # degree_gini × (1 − hub_centrality_error)
    # Hub exists in the data AND is visually prominent.
    hub_clarity: float

    # silhouette_by_module × blob_integrity × (1 − cross_edge_ratio)
    # Modules are spatially separated, contained, and not cross-coupled.
    module_clarity: float

    # edge_visibility × (1 − node_overlap) × (1 − edge_crossings)
    # Overall graph legibility — can you read all edges and nodes?
    readability: float

    # spatial_compactness × (1 − clamp(layout_stress/5)) × edge_visibility
    # Efficient use of space with low stress and good visibility.
    layout_efficiency: float

    # ── Structural analysis ───────────────────────────────────────────────────

    # log1p(cross_edge_count × module_count × cross_edge_ratio)
    # Topological complexity: more cross-edges, more modules, higher ratio = harder to read.
    structural_complexity: float

    # cross_edge_ratio × max(0, 1 − module_separation/80)
    # Cross-module coupling working against blob separation.
    coupling_tension: float

    # 1 − gestalt_cohesion
    # Fraction of nodes that feel visually disconnected from their cluster.
    isolation_risk: float

    # (edge_angle_entropy + degree_entropy) / 2
    # Combined visual and structural disorder.
    visual_entropy: float

    # degree_gini × min(1, hub_degree_ratio / 10)
    # How top-heavy is the degree distribution.
    degree_imbalance: float

    # ── Hub / node analysis ───────────────────────────────────────────────────

    # hub_degree_ratio × (1 − hub_centrality_error) × degree_gini
    # All three hub signals combined: dominant node is central and skewed.
    hub_prominence: float

    # |chain_quality − hub_clarity|
    # Structural tension: graph is trying to be both chain-like and hub-like.
    chain_hub_conflict: float

    # ── Spatial analysis ──────────────────────────────────────────────────────

    # blob_integrity × (module_separation / (module_separation + 30))
    # Blob quality accounting for the actual physical gap between blobs.
    blob_health: float

    # 1 − (silhouette_by_module + 1) / 2   (normalises [-1, 1] → [0, 1])
    # How spatially disordered module membership is.
    spatial_disorder: float

    # structural_complexity × (1 + node_size_cv) / (edge_visibility + 0.01)
    # Information load per unit of visual clarity.
    information_density: float

    # ═══════════════════════════════════════════════════════════════════════════
    # TIER 3 — Z3 Archetype (constraint conjunctions, shim-evaluated)     5 fields
    # ═══════════════════════════════════════════════════════════════════════════
    #
    # Each is the result of asking Z3 (via the shim's Solver):
    # "Given all perception variables fixed to their measured values,
    #  is this archetype formula SAT?"
    # Returns 1.0 (SAT) or 0.0 (UNSAT).
    #
    # Archetypes are not mutually exclusive — a graph can match several.

    # chain_elongation ≥ 2.0 ∧ degree_gini ≤ 0.30 ∧ chain_r2 ≥ 0.85
    # Sequential call paths look like actual pipelines.
    archetype_chain: float

    # degree_gini ≥ 0.45 ∧ hub_degree_ratio ≥ 3.0 ∧ hub_centrality_error ≤ 0.45
    # One or few highly-connected nodes dominate and are visually central.
    archetype_hub: float

    # module_count ≥ 2 ∧ blob_integrity ≥ 0.82 ∧ silhouette_by_module ≥ 0.25
    # Multiple modules with clear spatial separation.
    archetype_modular: float

    # edge_crossings ≥ 0.40 ∧ node_overlap ≥ 0.05
    # Dense, tangled, unreadable layout.
    archetype_hairball: float

    # cross_edge_ratio ≥ 0.25 ∧ module_count ≥ 2 ∧ module_separation ≤ 20.0
    # Heavy cross-module coupling with blobs too close to distinguish.
    archetype_spaghetti: float

    # ═══════════════════════════════════════════════════════════════════════════
    # TIER 4 — Z3 Solver (binary search via shim oracle)                  8 fields
    # ═══════════════════════════════════════════════════════════════════════════
    #
    # Each uses _z3_bisect_min / _z3_bisect_max to *find* the minimum or maximum
    # value of a free perception variable that makes a composed formula SAT,
    # given all other perceptions fixed to their measured values.
    # Returns float('inf') / float('-inf') when no solution exists in range.

    # Min silhouette_by_module such that module_clarity ≥ 0.5
    # Tells you how good the spatial clustering would need to be.
    required_silhouette: float

    # Min chain_r2 such that chain_quality ≥ 0.70
    # Tells you how linear chains would need to be for good chain quality.
    required_chain_r2: float

    # Max module_clarity achievable given current blob_integrity and cross_edge_ratio,
    # if silhouette_by_module were optimally placed (range [-1, 1]).
    module_clarity_ceiling: float

    # Max chain_quality achievable given current chain_elongation and straightness,
    # if chain_r2 were optimally placed (range [0, 1]).
    chain_quality_ceiling: float

    # ── Reference constraint conformance ─────────────────────────────────────

    # Magnitude of the worst violated reference constraint (0 = all pass)
    worst_violation: float

    # Number of reference constraints currently violated (as float for Z3)
    violation_count: float

    # Weighted sum of normalised violation magnitudes
    violation_score: float

    # Fraction of reference constraints currently satisfied (0–1)
    layout_conformance: float


# ──────────────────────────────────────────────────────────────────────────────
# Tier 1: Raw extraction helpers
# ──────────────────────────────────────────────────────────────────────────────

def _degree_gini(values: list) -> float:
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


def _edge_angle_entropy(angles: list) -> float:
    """Entropy of edge directions binned into 18 × 20° buckets."""
    if len(angles) < 2:
        return 1.0
    bins  = np.histogram(angles, bins=18, range=(-180, 180))[0]
    total = bins.sum()
    if total == 0:
        return 1.0
    probs = bins[bins > 0] / total
    raw   = -np.sum(probs * np.log2(probs))
    return float(min(1.0, raw / math.log2(18)))


def _silhouette_and_ari(node_list: list, module_count: int) -> tuple:
    if module_count < 2 or len(node_list) < max(4, module_count + 1):
        return 1.0, 1.0
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


def _chain_r2(chain_node_pos: list) -> float:
    """Mean PCA-R² over detected chain positions."""
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


def _graph_aspect_ratio(node_list: list) -> float:
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


def _spatial_compactness(node_list: list) -> float:
    if len(node_list) < 4:
        return 1.0
    pos = np.array([[n["x"], n["y"]] for n in node_list], dtype=float)
    try:
        hull      = ConvexHull(pos)
        hull_area = hull.volume          # in 2D, .volume is the area
        dx = pos[:, 0].max() - pos[:, 0].min()
        dy = pos[:, 1].max() - pos[:, 1].min()
        bbox = dx * dy
        return float(min(1.0, hull_area / (bbox + 1e-6)))
    except Exception:
        return 1.0


# ──────────────────────────────────────────────────────────────────────────────
# Tier 2: Composed perception helpers
# ──────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _composed(r: dict) -> dict:
    """
    Compute Tier 2 composed perceptions from a dict of raw perception values.
    Returns a dict of {field_name: float}.
    """
    c = {}

    # chain_quality: r2 × norm_elongation × straightness
    elo_norm        = _clamp(r["chain_elongation"] / 3.0)
    c["chain_quality"]        = float(r["chain_r2"] * elo_norm * r["chain_straightness"])

    # hub_clarity: gini × (1 - centrality_error)
    c["hub_clarity"]          = float(r["degree_gini"] * (1.0 - r["hub_centrality_error"]))

    # module_clarity: silhouette × blob_integrity × (1 - cross_edge_ratio)
    # silhouette is [-1, 1]; shift to [0, 1] first for the product
    sil_norm = (r["silhouette_by_module"] + 1.0) / 2.0
    c["module_clarity"]       = float(sil_norm * r["blob_integrity"] * (1.0 - r["cross_edge_ratio"]))

    # readability: edge_vis × (1 - overlap) × (1 - crossings)
    c["readability"]          = float(
        r["edge_visibility"] * (1.0 - r["node_overlap"]) * (1.0 - r["edge_crossings"])
    )

    # layout_efficiency: compactness × (1 - stress_norm) × edge_vis
    stress_norm = _clamp(r["layout_stress"] / 5.0)
    c["layout_efficiency"]    = float(
        r["spatial_compactness"] * (1.0 - stress_norm) * r["edge_visibility"]
    )

    # structural_complexity: log1p(cross_edge_count × module_count × cross_edge_ratio)
    c["structural_complexity"] = float(
        math.log1p(r["cross_edge_count"] * r["module_count"] * r["cross_edge_ratio"])
    )

    # coupling_tension: cross_edge_ratio × max(0, 1 - sep/80)
    sep_factor = max(0.0, 1.0 - r["module_separation"] / 80.0)
    c["coupling_tension"]     = float(r["cross_edge_ratio"] * sep_factor)

    # isolation_risk
    c["isolation_risk"]       = float(1.0 - r["gestalt_cohesion"])

    # visual_entropy
    c["visual_entropy"]       = float((r["edge_angle_entropy"] + r["degree_entropy"]) / 2.0)

    # degree_imbalance
    c["degree_imbalance"]     = float(r["degree_gini"] * min(1.0, r["hub_degree_ratio"] / 10.0))

    # hub_prominence: hub_degree_ratio × (1 - hub_err) × gini
    c["hub_prominence"]       = float(
        r["hub_degree_ratio"] * (1.0 - r["hub_centrality_error"]) * r["degree_gini"]
    )

    # chain_hub_conflict: |chain_quality - hub_clarity|
    c["chain_hub_conflict"]   = float(abs(c["chain_quality"] - c["hub_clarity"]))

    # blob_health: blob_integrity × sigmoid-like separation factor
    sep_sat = r["module_separation"] / (r["module_separation"] + 30.0) if r["module_separation"] > 0 else 0.0
    c["blob_health"]          = float(r["blob_integrity"] * sep_sat if r["module_count"] >= 2 else r["blob_integrity"])

    # spatial_disorder: 1 - (silhouette + 1) / 2  → [0, 1]
    c["spatial_disorder"]     = float(1.0 - (r["silhouette_by_module"] + 1.0) / 2.0)

    # information_density
    c["information_density"]  = float(
        c["structural_complexity"] * (1.0 + r["node_size_cv"]) / (r["edge_visibility"] + 0.01)
    )

    return c


# ──────────────────────────────────────────────────────────────────────────────
# Tier 3: Z3 archetype detection
# ──────────────────────────────────────────────────────────────────────────────

def _z3_eval(assignment: dict, formula) -> float:
    """
    Evaluate a Z3 formula against a fixed variable assignment.
    Uses the shim's Solver as the SAT oracle.
    Returns 1.0 (SAT) or 0.0 (UNSAT).
    """
    from .z3_compat import Real, Int, Solver, sat as z3_sat
    s = Solver()
    for name, val in assignment.items():
        if isinstance(val, int):
            s.add(Int(name) == val)
        else:
            s.add(Real(name) == float(val))
    s.add(formula)
    return 1.0 if s.check() == z3_sat else 0.0


def _archetypes(assignment: dict) -> dict:
    """
    Evaluate archetype formulas against the current perception assignment.
    All formulas are written in Z3's expression language.
    """
    from .z3_compat import Real, Int, And

    chain_elo = Real("chain_elongation")
    chain_r2v = Real("chain_r2")
    deg_gini  = Real("degree_gini")
    hub_ratio = Real("hub_degree_ratio")
    hub_err   = Real("hub_centrality_error")
    mod_count = Int("module_count")
    blob_int  = Real("blob_integrity")
    sil       = Real("silhouette_by_module")
    xcross    = Real("edge_crossings")
    overlap   = Real("node_overlap")
    x_ratio   = Real("cross_edge_ratio")
    sep       = Real("module_separation")

    formulas = {
        "archetype_chain": And(
            chain_elo >= 2.0,
            deg_gini  <= 0.30,
            chain_r2v >= 0.85,
        ),
        "archetype_hub": And(
            deg_gini  >= 0.45,
            hub_ratio >= 3.0,
            hub_err   <= 0.45,
        ),
        "archetype_modular": And(
            mod_count >= 2,
            blob_int  >= 0.82,
            sil       >= 0.25,
        ),
        "archetype_hairball": And(
            xcross    >= 0.40,
            overlap   >= 0.05,
        ),
        "archetype_spaghetti": And(
            x_ratio   >= 0.25,
            mod_count >= 2,
            sep       <= 20.0,
        ),
    }

    return {name: _z3_eval(assignment, formula) for name, formula in formulas.items()}


# ──────────────────────────────────────────────────────────────────────────────
# Tier 4: Z3 binary-search solver helpers
# ──────────────────────────────────────────────────────────────────────────────

def _z3_bisect_min(
    var_name: str,
    get_formula,      # callable: (ArithRef) -> BoolRef  using Z3 arithmetic
    lo: float,
    hi: float,
    n_iters: int = 22,
) -> float:
    """
    Binary search for the minimum value v ∈ [lo, hi] such that
    get_formula(var) is SAT when var = v, using the Z3 shim as the oracle.

    The formula is a Z3 BoolRef built from the provided ArithRef variable,
    with all other constants folded in as Python floats.

    Returns float('inf') if never SAT across the full range.
    """
    from .z3_compat import Real, Solver, sat as z3_sat

    var = Real(var_name)

    # Feasibility check at the high end
    s = Solver()
    s.add(var == hi)
    s.add(get_formula(var))
    if s.check() != z3_sat:
        return float("inf")

    for _ in range(n_iters):
        mid = (lo + hi) / 2.0
        s = Solver()
        s.add(var == mid)
        s.add(get_formula(var))
        if s.check() == z3_sat:
            hi = mid
        else:
            lo = mid
    return hi


def _z3_bisect_max(
    var_name: str,
    get_formula,
    lo: float,
    hi: float,
    n_iters: int = 22,
) -> float:
    """
    Binary search for the maximum value v ∈ [lo, hi] such that
    get_formula(var) is SAT when var = v.

    Returns float('-inf') if never SAT across the full range.
    """
    from .z3_compat import Real, Solver, sat as z3_sat

    var = Real(var_name)

    s = Solver()
    s.add(var == lo)
    s.add(get_formula(var))
    if s.check() != z3_sat:
        return float("-inf")

    for _ in range(n_iters):
        mid = (lo + hi) / 2.0
        s = Solver()
        s.add(var == mid)
        s.add(get_formula(var))
        if s.check() == z3_sat:
            lo = mid
        else:
            hi = mid
    return lo


def _z3_solver_perceptions(r: dict, c: dict) -> dict:
    """
    Compute Tier 4 perceptions using Z3 binary search.

    r = raw perceptions dict
    c = composed perceptions dict

    Each result uses the Z3 shim to *solve* for a perception value,
    rather than just checking a known value.
    """
    result = {}

    # ── required_silhouette ───────────────────────────────────────────────────
    # Min silhouette_by_module such that module_clarity ≥ 0.5
    # module_clarity = ((sil + 1) / 2) × blob_integrity × (1 - cross_edge_ratio)
    # ⇒ sil × (blob_integrity × (1 - xr) / 2) + (blob_integrity × (1 - xr) / 2) ≥ 0.5
    # ⇒ sil × factor ≥ 0.5 - factor   (where factor = blob_integrity × (1 - xr) / 2)
    factor_sil = r["blob_integrity"] * (1.0 - r["cross_edge_ratio"]) / 2.0
    if factor_sil > 0:
        result["required_silhouette"] = _z3_bisect_min(
            "silhouette_by_module",
            lambda sil: sil * factor_sil >= (0.5 - factor_sil),
            lo=-1.0, hi=1.0,
        )
    else:
        result["required_silhouette"] = float("inf")

    # ── required_chain_r2 ────────────────────────────────────────────────────
    # Min chain_r2 such that chain_quality ≥ 0.70
    # chain_quality = r2 × norm_elo × straightness
    elo_norm = _clamp(r["chain_elongation"] / 3.0)
    factor_r2 = elo_norm * r["chain_straightness"]
    if factor_r2 > 0:
        result["required_chain_r2"] = _z3_bisect_min(
            "chain_r2",
            lambda r2: r2 * factor_r2 >= 0.70,
            lo=0.0, hi=1.0,
        )
    else:
        result["required_chain_r2"] = float("inf")

    # ── module_clarity_ceiling ────────────────────────────────────────────────
    # Max module_clarity achievable if silhouette could be anywhere in [-1, 1]
    # module_clarity = ((sil + 1) / 2) × blob_integrity × (1 - cross_edge_ratio)
    # Maximum: sil = 1.0 → clarity = 1.0 × blob_integrity × (1 - xr)
    # (Exact, but use Z3 bisect to demonstrate the mechanism)
    result["module_clarity_ceiling"] = _z3_bisect_max(
        "module_clarity_sym",
        lambda mc: mc <= 1.0 * r["blob_integrity"] * (1.0 - r["cross_edge_ratio"]),
        lo=0.0, hi=1.0,
    )
    # Fallback: direct formula (bisect may give -inf on degenerate inputs)
    if result["module_clarity_ceiling"] <= 0:
        result["module_clarity_ceiling"] = float(r["blob_integrity"] * (1.0 - r["cross_edge_ratio"]))

    # ── chain_quality_ceiling ─────────────────────────────────────────────────
    # Max chain_quality achievable if chain_r2 could be anywhere in [0, 1]
    max_chain_r2 = 1.0
    result["chain_quality_ceiling"] = float(max_chain_r2 * elo_norm * r["chain_straightness"])

    return result


# ──────────────────────────────────────────────────────────────────────────────
# Reference constraints for conformance scoring
# ──────────────────────────────────────────────────────────────────────────────

# Each entry: (name, weight, check: dict → bool, violation_magnitude: dict → float)
# check returns True = passing; violation_magnitude returns how far below threshold (≥ 0)
_REFERENCE_CONSTRAINTS: list[tuple] = [
    # Visual quality
    ("edge_visibility >= 0.65",       1.0,
     lambda r, c: r["edge_visibility"] >= 0.65,
     lambda r, c: max(0.0, 0.65 - r["edge_visibility"])),

    ("node_overlap <= 0.15",          1.0,
     lambda r, c: r["node_overlap"] <= 0.15,
     lambda r, c: max(0.0, r["node_overlap"] - 0.15)),

    ("edge_crossings <= 0.65",        1.0,
     lambda r, c: r["edge_crossings"] <= 0.65,
     lambda r, c: max(0.0, r["edge_crossings"] - 0.65)),

    ("layout_stress <= 2.5",          1.0,
     lambda r, c: r["layout_stress"] <= 2.5,
     lambda r, c: max(0.0, r["layout_stress"] - 2.5)),

    ("gestalt_cohesion >= 0.30",      0.8,
     lambda r, c: r["gestalt_cohesion"] >= 0.30,
     lambda r, c: max(0.0, 0.30 - r["gestalt_cohesion"])),

    # Module structure (conditional on multi-module)
    ("if mc≥2: blob_integrity >= 0.75", 1.2,
     lambda r, c: r["module_count"] < 2 or r["blob_integrity"] >= 0.75,
     lambda r, c: max(0.0, 0.75 - r["blob_integrity"]) if r["module_count"] >= 2 else 0.0),

    ("if mc≥2: separation >= 10",     1.2,
     lambda r, c: r["module_count"] < 2 or r["module_separation"] >= 10.0,
     lambda r, c: max(0.0, 10.0 - r["module_separation"]) / 100.0 if r["module_count"] >= 2 else 0.0),

    ("if mc≥2: silhouette >= 0.10",   1.0,
     lambda r, c: r["module_count"] < 2 or r["silhouette_by_module"] >= 0.10,
     lambda r, c: max(0.0, 0.10 - r["silhouette_by_module"]) if r["module_count"] >= 2 else 0.0),

    ("if mc≥2: cluster_purity >= 0.10", 0.8,
     lambda r, c: r["module_count"] < 2 or r["spatial_cluster_purity"] >= 0.10,
     lambda r, c: max(0.0, 0.10 - r["spatial_cluster_purity"]) if r["module_count"] >= 2 else 0.0),

    # Chain quality (conditional on elongated chains being present)
    ("if elo≥1.4: chain_r2 >= 0.60",  1.0,
     lambda r, c: r["chain_elongation"] < 1.4 or r["chain_r2"] >= 0.60,
     lambda r, c: max(0.0, 0.60 - r["chain_r2"]) if r["chain_elongation"] >= 1.4 else 0.0),

    ("if r2≥0.6: elongation >= 1.40", 1.0,
     lambda r, c: r["chain_r2"] < 0.60 or r["chain_elongation"] >= 1.40,
     lambda r, c: max(0.0, 1.40 - r["chain_elongation"]) if r["chain_r2"] >= 0.60 else 0.0),

    # Hub quality (conditional on high degree imbalance)
    ("if gini≥0.4: hub_err <= 0.45",  1.0,
     lambda r, c: r["degree_gini"] < 0.40 or r["hub_centrality_error"] <= 0.45,
     lambda r, c: max(0.0, r["hub_centrality_error"] - 0.45) if r["degree_gini"] >= 0.40 else 0.0),

    # Cross-module edge visibility
    ("if xcount≥2: vis >= 0.60",      1.0,
     lambda r, c: r["cross_edge_count"] < 2 or r["cross_edge_visibility"] >= 0.60,
     lambda r, c: max(0.0, 0.60 - r["cross_edge_visibility"]) if r["cross_edge_count"] >= 2 else 0.0),

    # Spatial
    ("spatial_compactness >= 0.20",   0.6,
     lambda r, c: r["spatial_compactness"] >= 0.20,
     lambda r, c: max(0.0, 0.20 - r["spatial_compactness"])),

    ("degree_entropy >= 0.20",        0.6,
     lambda r, c: r["degree_entropy"] >= 0.20,
     lambda r, c: max(0.0, 0.20 - r["degree_entropy"])),

    # Composed quality
    ("readability >= 0.35",           1.2,
     lambda r, c: c["readability"] >= 0.35,
     lambda r, c: max(0.0, 0.35 - c["readability"])),

    ("module_clarity >= 0.05",        1.0,
     lambda r, c: c["module_clarity"] >= 0.05,
     lambda r, c: max(0.0, 0.05 - c["module_clarity"])),

    ("chain_quality or elo < 1.0",    0.8,
     lambda r, c: r["chain_elongation"] < 1.0 or c["chain_quality"] >= 0.20,
     lambda r, c: max(0.0, 0.20 - c["chain_quality"]) if r["chain_elongation"] >= 1.0 else 0.0),

    ("blob_health >= 0.40",           1.0,
     lambda r, c: c["blob_health"] >= 0.40,
     lambda r, c: max(0.0, 0.40 - c["blob_health"])),

    ("information_density <= 4.0",    0.8,
     lambda r, c: c["information_density"] <= 4.0,
     lambda r, c: max(0.0, c["information_density"] - 4.0)),
]


def _conformance(r: dict, c: dict) -> dict:
    """Compute violation metrics and overall layout_conformance."""
    results = [(check(r, c), weight, viol(r, c))
               for _, weight, check, viol in _REFERENCE_CONSTRAINTS]

    passed        = sum(1 for ok, _, _ in results if ok)
    total         = len(results)
    total_weight  = sum(w for _, w, _ in results)
    weighted_pass = sum(w for ok, w, _ in results if ok)

    violations     = [v * w for ok, w, v in results if not ok]
    violation_count = float(total - passed)
    worst           = float(max(violations)) if violations else 0.0
    score           = float(sum(violations))
    conformance     = float(weighted_pass / total_weight) if total_weight > 0 else 1.0

    return {
        "worst_violation":   worst,
        "violation_count":   violation_count,
        "violation_score":   score,
        "layout_conformance": conformance,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────────

def compute_perceptions(facts: dict) -> Perceptions:
    """
    Extract and derive all 52 perception fields from the raw facts dict
    produced by layoutMetrics.js → computeFacts().

    Computation order:
      1. Extract raw values from facts (Tier 1)
      2. Compute sklearn geometric metrics
      3. Compute Tier 2 composed perceptions
      4. Evaluate Tier 3 Z3 archetype formulas
      5. Run Tier 4 Z3 bisection solvers
      6. Compute reference constraint conformance
      7. Construct and return Perceptions
    """

    # ── 1. Extract raw from facts ─────────────────────────────────────────────
    sep         = facts["blobSeparation"]["minClearance"]
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
    mod_count   = int(facts.get("moduleCount", 1))
    cross_ratio = float(facts.get("crossEdgeRatio", 0.0))

    deg_dist    = facts.get("degreeDist", {})
    deg_values  = deg_dist.get("values", [])
    deg_mean    = float(deg_dist.get("mean", 0.0)) or 1.0
    deg_max     = float(deg_dist.get("max",  0.0))
    deg_gini_v  = float(deg_dist.get("gini", 0.0))

    edge_angles     = facts.get("edgeAngles", [])
    node_list       = facts.get("nodeList", [])
    chain_node_pos  = facts.get("chainNodePos", [])

    # ── 2. sklearn metrics ────────────────────────────────────────────────────
    sil, ari = _silhouette_and_ari(node_list, mod_count)

    # ── 3. Tier 1 raw dict (for composed / archetype helpers) ─────────────────
    r: dict = {
        "module_count":          mod_count,
        "module_separation":     float(sep) if sep is not None else 0.0,
        "blob_integrity":        float(integr),
        "gestalt_cohesion":      float(cohesion),
        "cross_edge_visibility": float(cross_vis),
        "cross_edge_count":      int(cross_count),
        "cross_edge_ratio":      cross_ratio,
        "edge_visibility":       float(edge_vis),
        "chain_elongation":      float(chain_elo),
        "chain_straightness":    float(chain_str),
        "hub_centrality_error":  float(hub),
        "node_size_cv":          float(size_cv),
        "node_overlap":          float(overlap),
        "edge_crossings":        float(crossings),
        "layout_stress":         float(stress),
        "degree_gini":           deg_gini_v,
        "hub_degree_ratio":      float(deg_max / deg_mean),
        "degree_entropy":        _shannon_entropy_normalised(deg_values),
        "edge_angle_entropy":    _edge_angle_entropy(edge_angles),
        "graph_aspect_ratio":    _graph_aspect_ratio(node_list),
        "spatial_compactness":   _spatial_compactness(node_list),
        "silhouette_by_module":  float(sil),
        "spatial_cluster_purity": float(ari),
        "chain_r2":              _chain_r2(chain_node_pos),
    }

    # ── 4. Tier 2: composed ───────────────────────────────────────────────────
    c = _composed(r)

    # ── 5. Tier 3: Z3 archetypes ──────────────────────────────────────────────
    a = _archetypes({**r, **c})

    # ── 6. Tier 4: Z3 solver ──────────────────────────────────────────────────
    z = _z3_solver_perceptions(r, c)

    # ── 7. Reference conformance ──────────────────────────────────────────────
    conf = _conformance(r, c)

    # ── 8. Construct Perceptions ──────────────────────────────────────────────
    return Perceptions(
        # Tier 1 — Raw
        module_count           = r["module_count"],
        module_separation      = r["module_separation"],
        blob_integrity         = r["blob_integrity"],
        gestalt_cohesion       = r["gestalt_cohesion"],
        cross_edge_visibility  = r["cross_edge_visibility"],
        cross_edge_count       = r["cross_edge_count"],
        cross_edge_ratio       = r["cross_edge_ratio"],
        edge_visibility        = r["edge_visibility"],
        chain_elongation       = r["chain_elongation"],
        chain_straightness     = r["chain_straightness"],
        hub_centrality_error   = r["hub_centrality_error"],
        node_size_cv           = r["node_size_cv"],
        node_overlap           = r["node_overlap"],
        edge_crossings         = r["edge_crossings"],
        layout_stress          = r["layout_stress"],
        degree_gini            = r["degree_gini"],
        hub_degree_ratio       = r["hub_degree_ratio"],
        degree_entropy         = r["degree_entropy"],
        edge_angle_entropy     = r["edge_angle_entropy"],
        graph_aspect_ratio     = r["graph_aspect_ratio"],
        spatial_compactness    = r["spatial_compactness"],
        silhouette_by_module   = r["silhouette_by_module"],
        spatial_cluster_purity = r["spatial_cluster_purity"],
        chain_r2               = r["chain_r2"],
        # Tier 2 — Composed
        chain_quality          = c["chain_quality"],
        hub_clarity            = c["hub_clarity"],
        module_clarity         = c["module_clarity"],
        readability            = c["readability"],
        layout_efficiency      = c["layout_efficiency"],
        structural_complexity  = c["structural_complexity"],
        coupling_tension       = c["coupling_tension"],
        isolation_risk         = c["isolation_risk"],
        visual_entropy         = c["visual_entropy"],
        degree_imbalance       = c["degree_imbalance"],
        hub_prominence         = c["hub_prominence"],
        chain_hub_conflict     = c["chain_hub_conflict"],
        blob_health            = c["blob_health"],
        spatial_disorder       = c["spatial_disorder"],
        information_density    = c["information_density"],
        # Tier 3 — Z3 Archetypes
        archetype_chain        = a["archetype_chain"],
        archetype_hub          = a["archetype_hub"],
        archetype_modular      = a["archetype_modular"],
        archetype_hairball     = a["archetype_hairball"],
        archetype_spaghetti    = a["archetype_spaghetti"],
        # Tier 4 — Z3 Solver
        required_silhouette    = z["required_silhouette"],
        required_chain_r2      = z["required_chain_r2"],
        module_clarity_ceiling = z["module_clarity_ceiling"],
        chain_quality_ceiling  = z["chain_quality_ceiling"],
        worst_violation        = conf["worst_violation"],
        violation_count        = conf["violation_count"],
        violation_score        = conf["violation_score"],
        layout_conformance     = conf["layout_conformance"],
    )
