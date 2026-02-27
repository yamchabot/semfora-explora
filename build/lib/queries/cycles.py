"""Cycle detection queries."""
from __future__ import annotations
import sqlite3
from queries.core import fetch_nodes, fetch_edges_all


def fetch_cycle_graph_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """Full internal call graph for SCC-based cycle detection."""
    nodes = fetch_nodes(conn, fields=["hash", "name", "module", "file_path"])
    node_hashes = {n["hash"] for n in nodes}
    edges = [
        e for e in fetch_edges_all(conn, call_count=True)
        if e["caller_hash"] in node_hashes and e["callee_hash"] in node_hashes
    ]
    return nodes, edges
