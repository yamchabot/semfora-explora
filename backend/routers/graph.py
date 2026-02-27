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


def _get_node_detail(conn, node_hash: str) -> dict:
    """Fetch full node detail including callers, callees, inheritance, imports."""
    from db import row_to_dict
    from queries.explore import _has_inheritance_table, _has_imports_table
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM nodes WHERE hash = ?", (node_hash,)).fetchone()
    if not row:
        return None
    node = row_to_dict(row)

    callers = [
        row_to_dict(r) for r in cur.execute(
            "SELECT n.hash, n.name, n.module, n.file_path, n.line_start "
            "FROM edges e JOIN nodes n ON e.caller_hash = n.hash "
            "WHERE e.callee_hash = ? ORDER BY n.caller_count DESC LIMIT 50",
            (node_hash,)
        ).fetchall()
    ]
    callees = [
        row_to_dict(r) for r in cur.execute(
            "SELECT n.hash, n.name, n.module, n.file_path, n.line_start "
            "FROM edges e JOIN nodes n ON e.callee_hash = n.hash "
            "WHERE e.caller_hash = ? AND e.callee_hash NOT LIKE 'ext:%' "
            "ORDER BY e.call_count DESC LIMIT 50",
            (node_hash,)
        ).fetchall()
    ]

    # Inheritance: parents this node extends
    parents = []
    if _has_inheritance_table(conn):
        parents = [
            {"parent_name": r[0], "parent_hash": r[1]}
            for r in cur.execute(
                "SELECT parent_name, parent_hash FROM inheritance WHERE child_hash = ?",
                (node_hash,)
            ).fetchall()
        ]
        # Children: classes that extend this node
    children = []
    if _has_inheritance_table(conn):
        children = [
            {"hash": r[0], "name": r[1], "module": r[2]}
            for r in cur.execute(
                "SELECT n.hash, n.name, n.module FROM inheritance i "
                "JOIN nodes n ON i.child_hash = n.hash "
                "WHERE i.parent_hash = ? LIMIT 30",
                (node_hash,)
            ).fetchall()
        ]

    # External callees (stdlib / third-party)
    ext_callees = [
        {"name": r[0], "ext_package": r[1]}
        for r in cur.execute(
            "SELECT n.name, n.ext_package FROM edges e JOIN nodes n ON e.callee_hash = n.hash "
            "WHERE e.caller_hash = ? AND e.callee_hash LIKE 'ext:%' "
            "ORDER BY e.call_count DESC LIMIT 20",
            (node_hash,)
        ).fetchall()
    ] if "ext_package" in (node or {}) else []

    return {
        "node": node,
        "callers": callers,
        "callees": callees,
        "parents": parents,
        "children": children,
        "ext_callees": ext_callees,
    }


@router.get("/api/repos/{repo_id}/nodes/lookup")
def lookup_node(repo_id: str, sym: str = Query(..., description="module::name symbol ID")):
    """Fetch node detail by symbol ID (module::name format)."""
    from db import row_to_dict
    conn = get_db(repo_id)
    cur  = conn.cursor()
    parts = sym.split("::", 1)
    if len(parts) != 2:
        conn.close()
        raise HTTPException(status_code=400, detail="sym must be module::name format")
    module, name = parts
    row = cur.execute(
        "SELECT hash FROM nodes WHERE module = ? AND name = ? LIMIT 1",
        (module, name)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Node not found: {sym}")
    node_hash = row[0]
    result = _get_node_detail(conn, node_hash)
    conn.close()
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/api/repos/{repo_id}/nodes/{node_hash}")
def get_node(repo_id: str, node_hash: str):
    conn = get_db(repo_id)
    result = _get_node_detail(conn, node_hash)
    conn.close()
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/api/repos/{repo_id}/node-flags")
def get_node_flags(repo_id: str):
    """
    Returns a compact map of symbol → metadata flags for all nodes.
    Used by the frontend to annotate graph node labels without fetching each node.

    Response: { flags: {"module::name": {async: 0|1, recursive: 0|1, exported: 0|1, test: 0|1}} }
    Only nodes with at least one non-zero flag are included.
    Falls back to empty if schema doesn't have new columns.
    """
    from queries.explore import _has_new_schema
    conn = get_db(repo_id)
    if not _has_new_schema(conn):
        conn.close()
        return {"flags": {}, "has_schema": False}

    rows = conn.execute(
        "SELECT module, name, is_async, is_self_recursive, is_exported, framework_entry_point "
        "FROM nodes WHERE hash NOT LIKE 'ext:%' "
        "  AND (is_async = 1 OR is_self_recursive = 1 OR is_exported = 1 "
        "       OR (framework_entry_point != '' AND framework_entry_point IS NOT NULL))"
    ).fetchall()
    conn.close()

    flags = {}
    for r in rows:
        sym = f"{r[0]}::{r[1]}"
        flags[sym] = {
            "async":     r[2] or 0,
            "recursive": r[3] or 0,
            "exported":  r[4] or 0,
            "test":      1 if r[5] == "TestFunction" else 0,
        }
    return {"flags": flags, "has_schema": True}


@router.get("/api/repos/{repo_id}/inheritance-graph")
def get_inheritance_graph(repo_id: str):
    """Return the full inheritance graph (class hierarchy) for a repo."""
    from db import row_to_dict
    from queries.explore import _has_inheritance_table
    conn = get_db(repo_id)
    if not _has_inheritance_table(conn):
        conn.close()
        return {"nodes": [], "edges": [], "has_inheritance": False}

    cur = conn.cursor()
    # Resolved child nodes
    node_rows = cur.execute(
        "SELECT DISTINCT n.hash, n.name, n.module, n.file_path, n.kind "
        "FROM inheritance i "
        "JOIN nodes n ON n.hash = i.child_hash "
        "WHERE n.hash NOT LIKE 'unresolved:%' "
        "LIMIT 500"
    ).fetchall()
    nodes = [row_to_dict(r) for r in node_rows]

    # All edges — child must be resolved; parent may be unresolved (external lib)
    edge_rows = cur.execute(
        "SELECT child_hash, parent_hash, parent_name FROM inheritance "
        "WHERE child_hash NOT LIKE 'unresolved:%'"
    ).fetchall()

    # Synthesise stub nodes for unresolved (external) parents so edges can render
    seen_ids = {n["hash"] for n in nodes}
    for child_hash, parent_hash, parent_name in edge_rows:
        if parent_hash not in seen_ids:
            nodes.append({
                "hash":      parent_hash,
                "name":      parent_name,
                "module":    "external",
                "file_path": None,
                "kind":      "ExternalClass",
                "external":  True,
            })
            seen_ids.add(parent_hash)

    edges = [
        {"source": r[0], "target": r[1], "parent_name": r[2]}
        for r in edge_rows
    ]
    conn.close()
    return {"nodes": nodes, "edges": edges, "has_inheritance": True}


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
