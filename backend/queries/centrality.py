"""
Centrality and blast-radius queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict

from db import row_to_dict


def fetch_graph_for_centrality(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """Fetch all internal nodes and edges for centrality computation."""
    cur = conn.cursor()
    cur.execute(
        "SELECT hash, name, module, file_path, caller_count, callee_count, risk FROM nodes "
        "WHERE hash NOT LIKE 'ext:%'"
    )
    nodes = [row_to_dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT caller_hash, callee_hash, call_count FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    )
    edges = [row_to_dict(r) for r in cur.fetchall()]
    return nodes, edges


def fetch_blast_radius_data(
    conn: sqlite3.Connection,
    node_hash: str,
) -> tuple[dict | None, dict[str, list[str]], dict[str, dict]]:
    """
    Fetch target node, reverse adjacency map, and all node details.

    Returns (target_node, reverse_adj, all_nodes).
    target_node is None if the hash doesn't exist.
    reverse_adj maps callee_hash -> [caller_hash, ...].
    all_nodes maps hash -> node dict.
    """
    target_row = conn.execute(
        "SELECT hash, name, module, file_path, complexity, caller_count, callee_count, risk "
        "FROM nodes WHERE hash = ?",
        (node_hash,),
    ).fetchone()
    target_node = row_to_dict(target_row) if target_row else None

    rows = conn.execute(
        "SELECT caller_hash, callee_hash FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    ).fetchall()
    reverse_adj: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        reverse_adj[r["callee_hash"]].append(r["caller_hash"])

    node_rows = conn.execute(
        "SELECT hash, name, module, file_path, caller_count FROM nodes "
        "WHERE hash NOT LIKE 'ext:%'"
    ).fetchall()
    all_nodes = {r["hash"]: row_to_dict(r) for r in node_rows}

    return target_node, dict(reverse_adj), all_nodes
