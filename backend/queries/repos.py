"""
Repo list and overview queries — DB I/O only.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from db import row_to_dict


def fetch_repo_list(data_dir: Path) -> list[dict]:
    """Scan data_dir for .db files and return basic stats for each."""
    repos = []
    for db_file in sorted(data_dir.glob("*.db")):
        repo_id = db_file.stem
        try:
            conn = sqlite3.connect(db_file)
            conn.row_factory = sqlite3.Row
            node_count   = conn.execute("SELECT COUNT(*) as n FROM nodes").fetchone()["n"]
            edge_count   = conn.execute("SELECT COUNT(*) as n FROM edges").fetchone()["n"]
            module_count = conn.execute(
                "SELECT COUNT(DISTINCT module) as n FROM nodes "
                "WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'"
            ).fetchone()["n"]
            conn.close()
        except Exception:
            continue
        repos.append({
            "id":           repo_id,
            "name":         repo_id,
            "node_count":   node_count,
            "edge_count":   edge_count,
            "module_count": module_count,
            "db_path":      str(db_file),
        })
    return repos


def fetch_repo_overview(conn: sqlite3.Connection) -> dict:
    """Aggregate stats for a single repo overview page."""
    cur = conn.cursor()

    node_count = cur.execute("SELECT COUNT(*) as n FROM nodes").fetchone()["n"]
    edge_count = cur.execute("SELECT COUNT(*) as n FROM edges").fetchone()["n"]
    module_count = cur.execute(
        "SELECT COUNT(DISTINCT module) as n FROM nodes "
        "WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'"
    ).fetchone()["n"]
    dead_count = cur.execute(
        "SELECT COUNT(*) as n FROM nodes WHERE caller_count = 0 AND hash NOT LIKE 'ext:%'"
    ).fetchone()["n"]
    cycle_candidates = cur.execute(
        """
        SELECT COUNT(*) as n FROM (
            SELECT caller_hash FROM edges GROUP BY caller_hash
            INTERSECT
            SELECT callee_hash FROM edges GROUP BY callee_hash
        )
        """
    ).fetchone()["n"]

    top_modules = [
        row_to_dict(r) for r in cur.execute(
            """
            SELECT module, COUNT(*) as cnt FROM nodes
            WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'
            GROUP BY module ORDER BY cnt DESC LIMIT 10
            """
        ).fetchall()
    ]
    risk_dist = {
        r["risk"]: r["cnt"]
        for r in cur.execute(
            "SELECT risk, COUNT(*) as cnt FROM nodes WHERE hash NOT LIKE 'ext:%' GROUP BY risk"
        ).fetchall()
    }

    return {
        "node_count":           node_count,
        "edge_count":           edge_count,
        "module_count":         module_count,
        "dead_symbol_estimate": dead_count,
        "cycle_candidates":     cycle_candidates,
        "top_modules":          top_modules,
        "risk_distribution":    risk_dist,
    }
