"""
Triage queries — DB I/O only.

Bundles all data fetches needed by analytics/triage.py into one call.
Each sub-fetch is independent; none depend on another's results.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict
from queries.coupling import fetch_high_centrality_nodes, fetch_module_edges
from queries.cycles import fetch_cycle_graph_data


def fetch_triage_inputs(conn: sqlite3.Connection) -> dict:
    """
    Collect all data needed by analyze_triage() in one round-trip bundle.

    Returns:
        high_centrality_nodes — load-bearing candidates (calling_modules >= 5)
        module_edges          — for instability analysis
        call_graph            — {nodes, edges} for cycle detection
        dead_file_stats       — per-file dead-code concentration
    """
    high_centrality_nodes = fetch_high_centrality_nodes(conn, threshold=5)
    module_edges          = fetch_module_edges(conn)
    graph_nodes, graph_edges = fetch_cycle_graph_data(conn)

    rows = conn.execute(
        """
        SELECT file_path,
               COUNT(*)                                              AS total,
               SUM(CASE WHEN caller_count = 0 THEN 1 ELSE 0 END)   AS dead
        FROM nodes
        WHERE hash NOT LIKE 'ext:%'
          AND kind IN ('function', 'method', 'class')
          AND file_path IS NOT NULL
        GROUP BY file_path
        HAVING total >= 5 AND dead * 1.0 / total >= 0.6
        ORDER BY dead DESC
        LIMIT 5
        """
    ).fetchall()
    dead_file_stats = [row_to_dict(r) for r in rows]

    return {
        "high_centrality_nodes": high_centrality_nodes,
        "module_edges":          module_edges,
        "call_graph":            {"nodes": graph_nodes, "edges": graph_edges},
        "dead_file_stats":       dead_file_stats,
    }
