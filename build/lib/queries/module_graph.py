"""Module graph queries."""
from __future__ import annotations
import sqlite3
from queries.core import fetch_module_symbol_stats, fetch_module_edges


def fetch_module_graph_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict], int]:
    """
    Module symbol stats + edges for the force-graph view.
    Returns (module_symbol_rows, module_edge_rows, max_meaningful_depth).
    """
    symbol_rows = fetch_module_symbol_stats(conn)
    edge_rows   = fetch_module_edges(conn)

    max_depth = max(
        (len(r["module"].replace("/", ".").split("."))
         for r in symbol_rows if not r["module"].startswith("__")),
        default=1,
    )
    return symbol_rows, edge_rows, max_depth
