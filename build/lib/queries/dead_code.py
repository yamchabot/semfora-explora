"""Dead code queries."""
from __future__ import annotations
import sqlite3
from queries.core import fetch_nodes

_DEAD_WHERE  = "caller_count = 0 AND kind IN ('function', 'method', 'class')"
_DEAD_FIELDS = ["hash", "name", "kind", "module", "file_path",
                "line_start", "line_end", "complexity"]


def fetch_dead_candidates(conn: sqlite3.Connection, limit: int = 200) -> tuple[list[dict], int]:
    """
    Zero-caller nodes eligible for dead-code analysis.
    Returns (candidates, total_internal_symbol_count).
    """
    candidates = fetch_nodes(conn, fields=_DEAD_FIELDS, extra_where=_DEAD_WHERE,
                             order_by="complexity DESC, name ASC", limit=limit)
    total = conn.execute(
        "SELECT COUNT(*) as n FROM nodes WHERE hash NOT LIKE 'ext:%'"
    ).fetchone()["n"]
    return candidates, total
