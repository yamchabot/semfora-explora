"""
Call graph and diff graph queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict
from queries.coupling import fetch_module_edges

_NODE_FIELDS = "hash, name, kind, module, file_path, line_start, complexity, caller_count, callee_count, risk"


def fetch_graph(
    conn: sqlite3.Connection,
    module: str | None = None,
    limit: int = 300,
    offset: int = 0,
) -> tuple[list[dict], list[dict]]:
    """
    Fetch a subgraph of internal nodes and edges between them.

    If module is given, returns only nodes from that module.
    Sequential: edges are fetched after node hashes are known.
    """
    cur = conn.cursor()
    if module:
        cur.execute(
            f"SELECT {_NODE_FIELDS} FROM nodes WHERE module = ? LIMIT ? OFFSET ?",
            (module, limit, offset),
        )
    else:
        cur.execute(
            f"SELECT {_NODE_FIELDS} FROM nodes WHERE hash NOT LIKE 'ext:%' LIMIT ? OFFSET ?",
            (limit, offset),
        )
    nodes = [row_to_dict(r) for r in cur.fetchall()]
    node_hashes = {n["hash"] for n in nodes}

    edges = []
    if node_hashes:
        ph = ",".join("?" * len(node_hashes))
        cur.execute(
            f"SELECT caller_hash, callee_hash, call_count FROM edges "
            f"WHERE caller_hash IN ({ph}) AND callee_hash IN ({ph}) "
            f"AND callee_hash NOT LIKE 'ext:%'",
            list(node_hashes) * 2,
        )
        edges = [row_to_dict(r) for r in cur.fetchall()]

    return nodes, edges


def fetch_diff_snapshot(conn: sqlite3.Connection) -> dict:
    """
    Fetch everything needed from one side of a diff.

    Returns {nodes_by_key, nodes_by_hash, edges, module_edges}.
    """
    cur = conn.cursor()
    cur.execute(
        f"SELECT hash, name, module, kind, file_path, caller_count, callee_count "
        f"FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    rows = cur.fetchall()
    nodes_by_key  = {(r["name"], r["module"]): row_to_dict(r) for r in rows}
    nodes_by_hash = {r["hash"]: row_to_dict(r) for r in rows}

    cur.execute(
        "SELECT caller_hash, callee_hash FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    )
    edges = [row_to_dict(r) for r in cur.fetchall()]

    module_edges = fetch_module_edges(conn)

    return {
        "nodes_by_key":  nodes_by_key,
        "nodes_by_hash": nodes_by_hash,
        "edges":         edges,
        "module_edges":  module_edges,
    }
