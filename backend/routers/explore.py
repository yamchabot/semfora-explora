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


@router.get("/api/repos/{repo_id}/explore")
def explore_pivot(
    repo_id:    str,
    dimensions: str = Query("module"),
    measures:   str = Query("symbol_count,dead_ratio,caller_count:avg"),
    kinds:      str = Query("", description="Comma-separated kind filter (empty = all)"),
):
    dims      = [d.strip() for d in dimensions.split(",") if d.strip()]
    meas_raw  = [m.strip() for m in measures.split(",")   if m.strip()]
    kinds_lst = [k.strip() for k in kinds.split(",")      if k.strip()] or None

    conn   = get_db(repo_id)
    result = fetch_pivot(conn, dims, meas_raw, kinds_lst)

    # Available kind values for the filter chips
    kind_rows        = conn.execute(
        "SELECT DISTINCT kind FROM nodes WHERE hash NOT LIKE 'ext:%' AND kind IS NOT NULL ORDER BY kind"
    ).fetchall()
    available_kinds  = [r[0] for r in kind_rows]

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
