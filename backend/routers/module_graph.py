from fastapi import APIRouter, Query

from db import get_db
from queries.module_graph import fetch_module_graph_data
from analytics.module_graph import compute_module_graph

router = APIRouter()


@router.get("/api/repos/{repo_id}/module-graph")
def module_graph(repo_id: str, depth: int = Query(2, ge=1, le=6)):
    conn = get_db(repo_id)
    symbol_rows, edge_rows, max_depth = fetch_module_graph_data(conn)
    conn.close()
    result = compute_module_graph(symbol_rows, edge_rows, depth)
    result["max_depth"] = min(max_depth, 6)
    return result
