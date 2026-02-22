"""
Module graph queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict
from queries.coupling import fetch_module_edges


def fetch_module_graph_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict], int]:
    """
    Fetch raw module symbol stats and module edges for the force-graph view.

    Returns (module_symbol_rows, module_edge_rows, max_meaningful_depth).
    """
    rows = conn.execute(
        """
        SELECT module,
               COUNT(*)                         AS symbol_count,
               COALESCE(SUM(complexity), 0)     AS total_complexity
        FROM nodes
        WHERE hash NOT LIKE 'ext:%' AND module IS NOT NULL
        GROUP BY module
        """
    ).fetchall()
    module_symbol_rows = [row_to_dict(r) for r in rows]
    module_edge_rows   = fetch_module_edges(conn)

    all_modules = [r["module"] for r in module_symbol_rows if not r["module"].startswith("__")]
    max_depth = max(
        (len(m.replace("/", ".").split(".")) for m in all_modules),
        default=1,
    )

    return module_symbol_rows, module_edge_rows, max_depth
