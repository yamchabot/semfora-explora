"""
Building view queries — DB I/O only.

Sequential query pattern: node hashes from the first query
drive the edge filter in the second query.
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict


def fetch_building_data(conn: sqlite3.Connection, max_nodes: int = 120) -> dict:
    """
    Fetch nodes and the edges between them for the building view.

    Two-step sequence:
      1. Fetch top max_nodes by caller_count
      2. Fetch edges restricted to those node hashes
    Returns {"nodes": [...], "edges": [...]}
    """
    cur = conn.cursor()

    cur.execute(
        """
        SELECT hash, name, module, file_path,
               caller_count, callee_count, complexity, risk
        FROM nodes
        WHERE hash NOT LIKE 'ext:%'
        ORDER BY caller_count DESC
        LIMIT ?
        """,
        (max_nodes,),
    )
    nodes = [row_to_dict(r) for r in cur.fetchall()]

    if not nodes:
        return {"nodes": [], "edges": []}

    # Step 2 depends on step 1 — node hashes determine which edges to fetch
    hashes = [n["hash"] for n in nodes]
    ph = ",".join("?" * len(hashes))
    cur.execute(
        f"""
        SELECT caller_hash, callee_hash FROM edges
        WHERE caller_hash IN ({ph}) AND callee_hash IN ({ph})
          AND callee_hash NOT LIKE 'ext:%'
        """,
        hashes * 2,
    )
    edges = [{"from": r["caller_hash"], "to": r["callee_hash"]} for r in cur.fetchall()]

    return {"nodes": nodes, "edges": edges}


def fetch_diff_building_data(conn: sqlite3.Connection, max_nodes: int = 120) -> dict:
    """Same shape as fetch_building_data — used for both sides of a diff."""
    return fetch_building_data(conn, max_nodes)
