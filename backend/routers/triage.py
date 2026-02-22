from fastapi import APIRouter

from db import get_db, read_lb_config
from queries.triage import fetch_triage_inputs
from analytics.triage import analyze_triage

router = APIRouter()


@router.get("/api/repos/{repo_id}/triage")
def triage(repo_id: str):
    conn      = get_db(repo_id)
    inputs    = fetch_triage_inputs(conn)
    lb_config = read_lb_config(repo_id)
    conn.close()
    return analyze_triage(inputs, lb_config)
