"""
Dead code queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict


def fetch_dead_candidates(conn: sqlite3.Connection, limit: int = 200) -> tuple[list[dict], int]:
    """
    Fetch zero-caller nodes eligible for dead-code analysis.

    Returns (candidates, total_symbol_count).
    total_symbol_count is used by the analytics layer to compute dead_ratio.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT hash, name, kind, module, file_path, line_start, line_end, complexity
        FROM nodes
        WHERE caller_count = 0
          AND hash NOT LIKE 'ext:%'
          AND kind IN ('function', 'method', 'class')
        ORDER BY complexity DESC, name ASC
        LIMIT ?
        """,
        (limit,),
    )
    candidates = [row_to_dict(r) for r in cur.fetchall()]

    total = conn.execute(
        "SELECT COUNT(*) as n FROM nodes WHERE hash NOT LIKE 'ext:%'"
    ).fetchone()["n"]

    return candidates, total
