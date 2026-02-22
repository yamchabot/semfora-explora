from fastapi import APIRouter, Query

from db import get_db
from queries.communities import fetch_community_data
from analytics.communities import detect_communities

router = APIRouter()


@router.get("/api/repos/{repo_id}/communities")
def communities(repo_id: str, resolution: float = Query(1.0, ge=0.1, le=5.0)):
    conn = get_db(repo_id)
    nodes, edges = fetch_community_data(conn)
    conn.close()
    return detect_communities(nodes, edges, resolution)
