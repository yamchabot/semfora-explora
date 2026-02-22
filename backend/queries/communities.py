"""
Community detection queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict


def fetch_community_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """
    Fetch all internal nodes and weighted edges for Louvain community detection.

    Returns (nodes, edges) where edges have an aggregated 'weight' field.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT hash, name, module, file_path FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    nodes = [row_to_dict(r) for r in cur.fetchall()]

    cur.execute(
        """
        SELECT caller_hash, callee_hash, COUNT(*) AS weight
        FROM edges
        WHERE callee_hash NOT LIKE 'ext:%'
        GROUP BY caller_hash, callee_hash
        """
    )
    edges = [row_to_dict(r) for r in cur.fetchall()]

    return nodes, edges
