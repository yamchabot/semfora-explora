from collections import defaultdict

from fastapi import APIRouter, Query

from db import get_db
from queries.explore import (
    AVAILABLE_DIMENSIONS,
    BUCKET_FIELDS,
    BUCKET_MODES,
    FIELDS,
    AGGS,
    SPECIAL_MEASURES,
    fetch_pivot,
    fetch_nodes,
    fetch_dim_values,
)

router = APIRouter()

_STATUS_TO_VAL: dict[str, float] = {
    "added":    0.0,
    "modified": 0.25,
    "removed":  1.0,
    # "unchanged" → 0.5 (default)
}

DIFF_EDGE_COLORS: dict[str, str] = {
    "added":   "#3fb950",   # green
    "removed": "#f85149",   # red (won't appear in current graph, but kept for completeness)
}


def _annotate_diff(result: dict, dims: list[str], conn, status_map: dict, snap_a: dict) -> None:
    """
    Mutates *result* in-place: adds diff_status_value to rows and diff_status to edges.

    diff_status_value encoding:
      0.0  = added    (new in HEAD, not in base)
      0.25 = modified (in both, but content changed)
      0.5  = unchanged
      1.0  = removed  (only in base — these nodes won't normally appear in the graph)
    """
    symbol_mode = (len(dims) == 1 and dims[0] == "symbol") or len(dims) == 0
    rows         = result.get("rows", [])

    # ── Node diff_status_value ──────────────────────────────────────────────
    if symbol_mode:
        # One row per node: direct lookup
        for row in rows:
            sym = row["key"].get("symbol", "")
            row["values"]["diff_status_value"] = _STATUS_TO_VAL.get(
                status_map.get(sym), 0.5
            )
    else:
        # Group grain: average the diff_status_value of all member symbols
        first_dim = dims[0]
        dim_expr  = AVAILABLE_DIMENSIONS.get(first_dim)
        if dim_expr:
            needs_nf = first_dim in {"in_cycle", "community"}
            nf_join  = "LEFT JOIN node_features nf ON n.hash = nf.hash" if needs_nf else ""
            node_rows = conn.execute(
                f"SELECT {dim_expr} AS gk, n.module, n.name "
                f"FROM nodes n {nf_join} "
                f"WHERE n.hash NOT LIKE 'ext:%'"
            ).fetchall()
            gv: dict[str, list[float]] = defaultdict(list)
            for nr in node_rows:
                gk = nr["gk"] if hasattr(nr, "__getitem__") else nr[0]
                mod = nr["module"] if hasattr(nr, "__getitem__") else nr[1]
                nm  = nr["name"]   if hasattr(nr, "__getitem__") else nr[2]
                if gk is not None:
                    vid = f"{mod}::{nm}"
                    gv[str(gk)].append(_STATUS_TO_VAL.get(status_map.get(vid), 0.5))
            for row in rows:
                gk = row["key"].get(first_dim)
                vals = gv.get(str(gk), []) if gk is not None else []
                row["values"]["diff_status_value"] = (
                    round(sum(vals) / len(vals), 3) if vals else 0.5
                )
        else:
            for row in rows:
                row["values"]["diff_status_value"] = 0.5

    # For 2-dim pivot (blob mode), children are the actual graph nodes.
    # Annotate them too so blob-mode coloring works via diff_status_value.
    for row in rows:
        for child in row.get("children", []):
            if "diff_status_value" not in child.get("values", {}):
                child_vid = child["key"].get("symbol", "")
                child["values"]["diff_status_value"] = _STATUS_TO_VAL.get(
                    status_map.get(child_vid), 0.5
                )

    result["measure_types"]["diff_status_value"] = "float"

    # ── Edge diff_status ────────────────────────────────────────────────────
    graph_edges = result.get("graph_edges", [])
    if not graph_edges:
        return

    # Edge status:
    #   "added"     — new relationship in HEAD (green)
    #   "modified"  — existed in both, but ≥1 endpoint has changed code (yellow)
    #   "unchanged" — existed in both, all endpoints unchanged (no color override)
    #   "removed"   — existed in base only; can't show in HEAD graph

    if symbol_mode:
        # Build base edge set as (caller_vid, callee_vid)
        bh_a = snap_a.get("nodes_by_hash", {})
        def vid_from_hash(h: str) -> str | None:
            n = bh_a.get(h)
            return f"{n['module']}::{n['name']}" if n else None
        base_edges: set[tuple[str, str]] = {
            (sv, tv)
            for e in snap_a.get("edges", [])
            if (sv := vid_from_hash(e["caller_hash"])) and (tv := vid_from_hash(e["callee_hash"]))
        }
        for edge in graph_edges:
            src, tgt = edge.get("source", ""), edge.get("target", "")
            if (src, tgt) not in base_edges:
                edge["diff_status"] = "added"
            elif status_map.get(src) in ("modified", "added") or status_map.get(tgt) in ("modified", "added"):
                edge["diff_status"] = "modified"
            else:
                edge["diff_status"] = "unchanged"
    else:
        # Module/kind grain: compare at the group level using module_edges
        base_mod_edges: set[tuple[str, str]] = {
            (e.get("caller_module", ""), e.get("callee_module", ""))
            for e in snap_a.get("module_edges", [])
        }
        # Precompute which modules have any changed symbols
        changed_modules: set[str] = {
            vid.split("::")[0]
            for vid, status in status_map.items()
            if "::" in vid and status in ("added", "modified", "removed")
        }
        for edge in graph_edges:
            src, tgt = edge.get("source", ""), edge.get("target", "")
            if (src, tgt) not in base_mod_edges:
                edge["diff_status"] = "added"
            elif src in changed_modules or tgt in changed_modules:
                edge["diff_status"] = "modified"
            else:
                edge["diff_status"] = "unchanged"


@router.get("/api/repos/{repo_id}/explore")
def explore_pivot(
    repo_id:    str,
    dimensions: str = Query("module"),
    measures:   str = Query("symbol_count,dead_ratio,caller_count:avg"),
    kinds:      str = Query("", description="Comma-separated kind filter (empty = all)"),
    compare_to: str = Query("", description="Repo ID for diff overlay (base/older snapshot)"),
):
    dims      = [d.strip() for d in dimensions.split(",") if d.strip()]
    meas_raw  = [m.strip() for m in measures.split(",")   if m.strip()]
    kinds_lst = [k.strip() for k in kinds.split(",")      if k.strip()] or None

    conn   = get_db(repo_id)
    result = fetch_pivot(conn, dims, meas_raw, kinds_lst)

    # Available kind values for the filter chips
    kind_rows       = conn.execute(
        "SELECT DISTINCT kind FROM nodes WHERE hash NOT LIKE 'ext:%' AND kind IS NOT NULL ORDER BY kind"
    ).fetchall()
    available_kinds = [r[0] for r in kind_rows]

    # Diff overlay — annotate rows + edges with diff_status_value / diff_status
    if compare_to:
        from queries.graph import fetch_diff_snapshot
        from analytics.diff import compute_diff_status_map

        conn_base = get_db(compare_to)
        snap_a    = fetch_diff_snapshot(conn_base)
        snap_b    = fetch_diff_snapshot(conn)
        conn_base.close()

        status_map = compute_diff_status_map(
            list(snap_a["nodes_by_key"].values()),
            list(snap_b["nodes_by_key"].values()),
        )
        _annotate_diff(result, dims, conn, status_map, snap_a)

    conn.close()

    return {
        **result,
        "available_kinds":      available_kinds,
        "available_dimensions": list(AVAILABLE_DIMENSIONS.keys()),
        "available_bucket_dims": {
            field: list(BUCKET_MODES.keys())
            for field in BUCKET_FIELDS
        },
        "available_fields":     {
            k: {"label": v["label"], "type": v["type"], "enriched": v["enriched"]}
            for k, v in FIELDS.items()
        },
        "available_aggs":       list(AGGS.keys()),
        "available_specials":   list(SPECIAL_MEASURES.keys()),
    }


@router.get("/api/repos/{repo_id}/explore/dim-values")
def explore_dim_values(
    repo_id: str,
    kinds:   str = Query("", description="Comma-separated kind filter (empty = all)"),
):
    """
    Distinct values for each categorical dimension — used by filter value pickers
    regardless of the current Group By selection.
    """
    kinds_lst = [k.strip() for k in kinds.split(",") if k.strip()] or None
    conn = get_db(repo_id)
    result = fetch_dim_values(conn, kinds_lst)
    conn.close()
    return {"dims": result}


@router.get("/api/repos/{repo_id}/explore/kinds")
def explore_kinds(repo_id: str):
    conn  = get_db(repo_id)
    rows  = conn.execute(
        "SELECT DISTINCT kind FROM nodes "
        "WHERE hash NOT LIKE 'ext:%' AND kind IS NOT NULL ORDER BY kind"
    ).fetchall()
    conn.close()
    return {"kinds": [r[0] for r in rows]}


@router.get("/api/repos/{repo_id}/explore/nodes")
def explore_nodes(
    repo_id:  str,
    sort_by:  str = Query("caller_count"),
    sort_dir: str = Query("desc"),
    limit:    int = Query(200, le=1000),
    kinds:    str = Query(""),
):
    kinds_lst = [k.strip() for k in kinds.split(",") if k.strip()] or None
    conn      = get_db(repo_id)
    result    = fetch_nodes(conn, sort_by, sort_dir, limit, kinds_lst)
    conn.close()
    return result
