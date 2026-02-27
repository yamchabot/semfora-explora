"""Community detection queries."""
from __future__ import annotations
import sqlite3
from queries.core import fetch_nodes, fetch_edges_weighted


def fetch_community_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """All internal nodes and weighted edges for Louvain community detection."""
    nodes = fetch_nodes(conn, fields=["hash", "name", "module", "file_path"])
    edges = fetch_edges_weighted(conn)
    return nodes, edges
