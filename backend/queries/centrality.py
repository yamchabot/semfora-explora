"""Centrality and blast-radius queries."""
from __future__ import annotations
import sqlite3
from collections import defaultdict
from db import row_to_dict
from queries.core import fetch_nodes, fetch_edges_all


def fetch_graph_for_centrality(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """Full internal call graph for centrality computation."""
    nodes = fetch_nodes(conn, fields=["hash", "name", "module", "file_path",
                                      "caller_count", "callee_count", "risk"])
    edges = fetch_edges_all(conn, call_count=True)
    return nodes, edges


def fetch_blast_radius_data(
    conn: sqlite3.Connection,
    node_hash: str,
) -> tuple[dict | None, dict[str, list[str]], dict[str, dict]]:
    """
    Target node, reverse adjacency map, and all node details for BFS.
    Returns (target_node, reverse_adj, all_nodes).
    """
    target_row = conn.execute(
        "SELECT hash, name, module, file_path, complexity, caller_count, callee_count, risk "
        "FROM nodes WHERE hash = ?",
        (node_hash,),
    ).fetchone()
    target_node = row_to_dict(target_row) if target_row else None

    reverse_adj: dict[str, list[str]] = defaultdict(list)
    for e in fetch_edges_all(conn, call_count=False):
        reverse_adj[e["callee_hash"]].append(e["caller_hash"])

    all_nodes = {
        n["hash"]: n
        for n in fetch_nodes(conn, fields=["hash", "name", "module", "file_path", "caller_count"])
    }

    return target_node, dict(reverse_adj), all_nodes
