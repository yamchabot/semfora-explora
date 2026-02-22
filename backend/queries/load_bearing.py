"""
Load-bearing node queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from queries.coupling import fetch_high_centrality_nodes


def fetch_lb_candidates(conn: sqlite3.Connection, threshold: int = 3) -> list[dict]:
    """
    Fetch nodes called from at least `threshold` distinct external modules.
    These are candidates for load-bearing classification.
    """
    return fetch_high_centrality_nodes(conn, threshold=threshold)
