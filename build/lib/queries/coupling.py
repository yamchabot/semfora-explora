"""Module coupling queries."""
from __future__ import annotations
import sqlite3
from db import row_to_dict
from queries.core import fetch_module_edges, fetch_module_symbol_stats  # re-export for callers

# Re-export so existing imports of fetch_module_edges from queries.coupling still work.
__all__ = ["fetch_module_edges", "fetch_module_symbol_stats",
           "fetch_high_centrality_nodes", "fetch_module_edge_detail"]


def fetch_high_centrality_nodes(conn: sqlite3.Connection, threshold: int = 3) -> list[dict]:
    """
    Nodes called from at least `threshold` distinct external modules.
    The JOIN logic here isn't reducible to a generic primitive — keep it specific.
    """
    rows = conn.execute(
        """
        SELECT n.hash, n.name, n.module, n.file_path, n.caller_count,
               n.callee_count, n.risk,
               COUNT(DISTINCT n2.module) AS calling_modules
        FROM nodes n
        JOIN edges e  ON e.callee_hash = n.hash
        JOIN nodes n2 ON e.caller_hash = n2.hash
        WHERE n.hash  NOT LIKE 'ext:%'
          AND n2.module IS NOT NULL
          AND n2.module != n.module
          AND n2.module != '__external__'
        GROUP BY n.hash
        HAVING calling_modules >= ?
        ORDER BY calling_modules DESC, n.caller_count DESC
        LIMIT 100
        """,
        (threshold,),
    ).fetchall()
    return [row_to_dict(r) for r in rows]


def fetch_module_edge_detail(
    conn: sqlite3.Connection,
    from_module: str,
    to_module: str,
    limit: int = 50,
) -> list[dict]:
    """Function-level calls between two specific modules."""
    rows = conn.execute(
        """
        SELECT cn.name  AS caller_name,  cn.hash AS caller_hash,  cn.file_path AS caller_file,
               ee.name  AS callee_name,  ee.hash AS callee_hash,  ee.file_path AS callee_file,
               COALESCE(e.call_count, 1) AS call_count
        FROM edges e
        JOIN nodes cn ON cn.hash = e.caller_hash
        JOIN nodes ee ON ee.hash = e.callee_hash
        WHERE cn.module = ? AND ee.module = ?
          AND cn.hash NOT LIKE 'ext:%' AND ee.hash NOT LIKE 'ext:%'
        ORDER BY call_count DESC
        LIMIT ?
        """,
        (from_module, to_module, limit),
    ).fetchall()
    return [row_to_dict(r) for r in rows]
