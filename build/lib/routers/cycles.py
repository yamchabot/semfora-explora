from fastapi import APIRouter

from db import get_db
from queries.cycles import fetch_cycle_graph_data
from analytics.cycles import find_cycles

router = APIRouter()


@router.get("/api/repos/{repo_id}/cycles")
def repo_cycles(repo_id: str):
    conn = get_db(repo_id)
    nodes, edges = fetch_cycle_graph_data(conn)
    conn.close()
    cycles = find_cycles(nodes, edges)
    return {"cycles": cycles, "total_cycles": len(cycles)}
