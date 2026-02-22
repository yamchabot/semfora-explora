"""
Building view queries.

Sequential pattern: node hashes from step 1 drive the edge filter in step 2.
Both steps live here because the two-query sequence is an implementation detail
of this specific data fetch — the analytics layer never sees the connection.
"""
from __future__ import annotations
import sqlite3
from queries.core import fetch_nodes, fetch_edges_within

_BUILDING_FIELDS = ["hash", "name", "module", "file_path",
                    "caller_count", "callee_count", "complexity", "risk"]


def fetch_building_data(conn: sqlite3.Connection, max_nodes: int = 120) -> dict:
    """
    Top max_nodes by caller_count, plus the edges between them.

    Step 1: nodes ordered by caller_count DESC
    Step 2: edges restricted to those node hashes (depends on step 1)
    """
    nodes = fetch_nodes(conn, fields=_BUILDING_FIELDS,
                        order_by="caller_count DESC", limit=max_nodes)
    edges = fetch_edges_within(conn, {n["hash"] for n in nodes})
    return {"nodes": nodes, "edges": edges}


def fetch_diff_building_data(conn: sqlite3.Connection, max_nodes: int = 120) -> dict:
    """Same shape as fetch_building_data — used for both sides of a diff."""
    return fetch_building_data(conn, max_nodes)
