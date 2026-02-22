"""
Cycle detection queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict


def fetch_cycle_graph_data(conn: sqlite3.Connection) -> tuple[list[dict], list[dict]]:
    """
    Fetch the full internal call graph needed for SCC-based cycle detection.

    Returns (nodes, edges) as plain lists of dicts.
    External nodes (ext: prefix) are excluded.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT hash, name, module, file_path FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    nodes = [row_to_dict(r) for r in cur.fetchall()]

    node_hashes = {n["hash"] for n in nodes}
    cur.execute(
        "SELECT caller_hash, callee_hash, call_count FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    )
    edges = [
        row_to_dict(r) for r in cur.fetchall()
        if r["caller_hash"] in node_hashes and r["callee_hash"] in node_hashes
    ]

    return nodes, edges
