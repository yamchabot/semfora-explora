from fastapi import APIRouter, Query

from db import get_db, row_to_dict

router = APIRouter()


@router.get("/api/repos/{repo_id}/search")
def search_nodes(repo_id: str, q: str = Query(..., min_length=1), limit: int = 20):
    conn = get_db(repo_id)
    rows = conn.execute(
        """
        SELECT hash, name, kind, module, file_path, line_start, caller_count, callee_count, risk
        FROM nodes
        WHERE name LIKE ? AND hash NOT LIKE 'ext:%'
        ORDER BY caller_count DESC
        LIMIT ?
        """,
        (f"%{q}%", limit),
    ).fetchall()
    conn.close()
    return {"results": [row_to_dict(r) for r in rows], "query": q}
