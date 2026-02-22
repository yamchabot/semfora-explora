from fastapi import APIRouter, Query

from db import get_db
from queries.coupling import (
    fetch_module_edges,
    fetch_module_symbol_stats,
    fetch_module_edge_detail,
)
from analytics.coupling import compute_module_stats

router = APIRouter()


@router.get("/api/repos/{repo_id}/modules")
def list_modules(repo_id: str):
    conn = get_db(repo_id)
    symbol_stats = fetch_module_symbol_stats(conn)
    module_edges = fetch_module_edges(conn)
    conn.close()
    return {"modules": compute_module_stats(symbol_stats, module_edges)}


@router.get("/api/repos/{repo_id}/module-edges")
def module_edges(repo_id: str):
    conn = get_db(repo_id)
    edges = fetch_module_edges(conn)
    conn.close()
    return {"edges": sorted(edges, key=lambda e: -e["edge_count"])[:200]}


@router.get("/api/repos/{repo_id}/module-edges-detail")
def module_edges_detail(
    repo_id: str,
    from_module: str = Query(...),
    to_module:   str = Query(...),
    limit:       int = Query(50, le=200),
):
    conn = get_db(repo_id)
    calls = fetch_module_edge_detail(conn, from_module, to_module, limit)
    conn.close()
    return {
        "from_module": from_module,
        "to_module":   to_module,
        "total":       len(calls),
        "calls":       calls,
    }
