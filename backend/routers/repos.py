from fastapi import APIRouter

from db import DATA_DIR, get_db
from queries.repos import fetch_repo_list, fetch_repo_overview

router = APIRouter()


@router.get("/api/repos")
def list_repos():
    return {"repos": fetch_repo_list(DATA_DIR)}


@router.get("/api/repos/{repo_id}/overview")
def repo_overview(repo_id: str):
    conn = get_db(repo_id)
    result = fetch_repo_overview(conn)
    conn.close()
    return {"repo_id": repo_id, **result}
