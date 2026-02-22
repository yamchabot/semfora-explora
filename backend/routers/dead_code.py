from fastapi import APIRouter, Query

from db import get_db
from queries.dead_code import fetch_dead_candidates
from analytics.dead_code import analyze_dead_code

router = APIRouter()


@router.get("/api/repos/{repo_id}/dead-code")
def dead_code(repo_id: str, limit: int = Query(200, le=1000)):
    conn = get_db(repo_id)
    candidates, total = fetch_dead_candidates(conn, limit=limit)
    conn.close()
    return analyze_dead_code(candidates, total)
