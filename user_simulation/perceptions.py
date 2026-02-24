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

    return Perceptions(
        module_count         = int(mod_count),
        module_separation    = float(sep) if sep is not None else 0.0,
        blob_integrity       = float(integr),
        gestalt_cohesion     = float(cohesion),
        cross_edge_visibility= float(cross_vis),
        cross_edge_count     = int(cross_count),
        cross_edge_ratio     = float(cross_ratio),
        edge_visibility      = float(edge_vis),
        chain_elongation     = float(chain_elo),
        chain_straightness   = float(chain_str),
        hub_centrality_error = float(hub),
        node_size_cv         = float(size_cv),
        node_overlap         = float(overlap),
        edge_crossings       = float(crossings),
        layout_stress        = float(stress),
    )
