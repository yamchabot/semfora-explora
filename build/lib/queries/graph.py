"""Call graph and diff graph queries."""
from __future__ import annotations
import sqlite3
from queries.core import fetch_nodes, fetch_edges_within, fetch_edges_all, fetch_module_edges

_GRAPH_FIELDS = ["hash", "name", "kind", "module", "file_path",
                 "line_start", "complexity", "caller_count", "callee_count", "risk"]
_DIFF_FIELDS  = ["hash", "name", "module", "kind", "file_path",
                 "caller_count", "callee_count"]


def fetch_graph(
    conn:    sqlite3.Connection,
    module:  str | None = None,
    limit:   int = 300,
    offset:  int = 0,
) -> tuple[list[dict], list[dict]]:
    """
    Subgraph view: nodes (optionally filtered by module) + edges between them.
    Sequential: edges fetched after node hashes are known.
    """
    extra = f"module = '{module}'" if module else None
    nodes = fetch_nodes(conn, fields=_GRAPH_FIELDS, extra_where=extra,
                        limit=limit)
    # manual offset since fetch_nodes doesn't expose it — use raw SQL for offset case
    if offset:
        from db import row_to_dict
        field_sql = ", ".join(_GRAPH_FIELDS)
        where = f"hash NOT LIKE 'ext:%'" + (f" AND module = '{module}'" if module else "")
        rows = conn.execute(
            f"SELECT {field_sql} FROM nodes WHERE {where} LIMIT ? OFFSET ?",
            (limit, offset)
        ).fetchall()
        nodes = [row_to_dict(r) for r in rows]

    edges = fetch_edges_within(conn, {n["hash"] for n in nodes}, call_count=True)
    return nodes, edges


def fetch_diff_snapshot(conn: sqlite3.Connection) -> dict:
    """
    Everything needed from one side of a diff.
    Returns {nodes_by_key, nodes_by_hash, edges, module_edges}.
    """
    nodes = fetch_nodes(conn, fields=_DIFF_FIELDS)
    nodes_by_key  = {(n["name"], n["module"]): n for n in nodes}
    nodes_by_hash = {n["hash"]: n for n in nodes}
    edges         = fetch_edges_all(conn, call_count=False)
    mod_edges     = fetch_module_edges(conn)
    return {
        "nodes_by_key":  nodes_by_key,
        "nodes_by_hash": nodes_by_hash,
        "edges":         edges,
        "module_edges":  mod_edges,
    }
