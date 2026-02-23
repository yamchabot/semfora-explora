import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_db, DATA_DIR
from queries.graph import fetch_graph, fetch_diff_snapshot
from analytics.diff import compute_diff, compute_diff_graph, compute_diff_status_map

router = APIRouter()


@router.get("/api/repos/{repo_id}/graph")
def get_graph(
    repo_id: str,
    module:  Optional[str] = None,
    limit:   int           = Query(300, le=2000),
    offset:  int           = 0,
):
    conn = get_db(repo_id)
    nodes, edges = fetch_graph(conn, module, limit, offset)
    conn.close()
    return {"nodes": nodes, "edges": edges, "total_nodes": len(nodes)}


@router.get("/api/repos/{repo_id}/nodes/{node_hash}")
def get_node(repo_id: str, node_hash: str):
    from db import row_to_dict
    conn = get_db(repo_id)
    cur  = conn.cursor()
    row  = cur.execute("SELECT * FROM nodes WHERE hash = ?", (node_hash,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Node not found")
    node = row_to_dict(row)
    callers = [
        row_to_dict(r) for r in cur.execute(
            "SELECT n.hash, n.name, n.module, n.file_path, n.line_start "
            "FROM edges e JOIN nodes n ON e.caller_hash = n.hash "
            "WHERE e.callee_hash = ? LIMIT 50", (node_hash,)
        ).fetchall()
    ]
    callees = [
        row_to_dict(r) for r in cur.execute(
            "SELECT n.hash, n.name, n.module, n.file_path, n.line_start "
            "FROM edges e JOIN nodes n ON e.callee_hash = n.hash "
            "WHERE e.caller_hash = ? AND e.callee_hash NOT LIKE 'ext:%' LIMIT 50",
            (node_hash,)
        ).fetchall()
    ]
    conn.close()
    return {"node": node, "callers": callers, "callees": callees}


class DiffRequest(BaseModel):
    repo_a: str
    repo_b: str


@router.post("/api/diff")
def graph_diff(req: DiffRequest):
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    snap_a = fetch_diff_snapshot(conn_a)
    snap_b = fetch_diff_snapshot(conn_b)
    conn_a.close()
    conn_b.close()

    result = compute_diff(
        list(snap_a["nodes_by_key"].values()),
        list(snap_b["nodes_by_key"].values()),
        snap_a["module_edges"],
        snap_b["module_edges"],
    )
    return {"repo_a": req.repo_a, "repo_b": req.repo_b, **result}


@router.post("/api/diff-graph")
def diff_graph(
    req:         DiffRequest,
    max_context: int = Query(4, le=10),
    max_nodes:   int = Query(120, le=300),
):
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    snap_a = fetch_diff_snapshot(conn_a)
    snap_b = fetch_diff_snapshot(conn_b)
    conn_a.close()
    conn_b.close()

    result = compute_diff_graph(
        list(snap_a["nodes_by_key"].values()),
        list(snap_b["nodes_by_key"].values()),
        snap_a["edges"],
        snap_b["edges"],
        max_context,
        max_nodes,
    )

    # GitHub compare link (optional metadata)
    github_url = None
    def repo_base(rid): return rid.split("@")[0]
    def repo_sha(rid): parts = rid.split("@"); return parts[1] if len(parts) > 1 else "HEAD"
    if repo_base(req.repo_a) == repo_base(req.repo_b):
        meta_path = DATA_DIR / f"{repo_base(req.repo_a)}.meta.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            gh = meta.get("github_url", "").rstrip("/")
            if gh:
                github_url = f"{gh}/compare/{repo_sha(req.repo_a)}...{repo_sha(req.repo_b)}"

    result["github_compare_url"] = github_url
    return result


@router.get("/api/repos/{repo_id}/diff-status")
def get_diff_status(
    repo_id:    str,
    compare_to: str = Query(..., description="Repo ID to compare against (the base/older snapshot)"),
):
    """
    Returns per-node diff status for all *changed* nodes when comparing
    compare_to (base) → repo_id (head).

    Response: { status_map: { "module::name": "added"|"removed"|"modified" } }

    Uses module::name key format to match explore page node IDs.
    Only changed nodes are included (unchanged nodes are absent).
    """
    conn_a = get_db(compare_to)   # base / older
    conn_b = get_db(repo_id)      # head / newer
    snap_a = fetch_diff_snapshot(conn_a)
    snap_b = fetch_diff_snapshot(conn_b)
    conn_a.close()
    conn_b.close()

    status_map = compute_diff_status_map(
        list(snap_a["nodes_by_key"].values()),
        list(snap_b["nodes_by_key"].values()),
    )
    return {"status_map": status_map}
