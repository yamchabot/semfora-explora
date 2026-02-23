"""
Database helpers shared across queries and routers.
No analysis logic lives here — only I/O primitives.
"""
import json
import sqlite3
from pathlib import Path

import networkx as nx
from fastapi import HTTPException

DATA_DIR = Path(__file__).parent.parent / "data"
CONFIG_DIR = DATA_DIR


def row_to_dict(row) -> dict:
    return dict(row)


def get_db(repo_id: str) -> sqlite3.Connection:
    base_path     = DATA_DIR / f"{repo_id}.db"
    enriched_path = DATA_DIR / f"{repo_id}.enriched.db"
    # Prefer enriched DB when available — it is a strict superset of the base schema
    db_path = enriched_path if enriched_path.exists() else base_path
    if not db_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Repo '{repo_id}' not found. Run: semfora-engine query callgraph --export data/{repo_id}.db",
        )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def build_nx_graph(conn: sqlite3.Connection, include_external: bool = False) -> nx.DiGraph:
    G = nx.DiGraph()
    cur = conn.cursor()
    cur.execute(
        "SELECT hash, name, kind, module, file_path, line_start, complexity, caller_count, callee_count, risk FROM nodes"
    )
    for row in cur.fetchall():
        G.add_node(row["hash"], **row_to_dict(row))
    cur.execute("SELECT caller_hash, callee_hash, call_count FROM edges")
    for row in cur.fetchall():
        caller, callee = row["caller_hash"], row["callee_hash"]
        if not include_external and (callee.startswith("ext:") or caller.startswith("ext:")):
            continue
        if G.has_node(caller) and G.has_node(callee):
            G.add_edge(caller, callee, call_count=row["call_count"])
    return G


# ── Load-bearing config ──────────────────────────────────────────────────────

def lb_config_path(repo_id: str) -> Path:
    return CONFIG_DIR / f"{repo_id}.load-bearing.json"


def read_lb_config(repo_id: str) -> dict:
    p = lb_config_path(repo_id)
    if p.exists():
        return json.loads(p.read_text())
    return {"declared_modules": [], "declared_nodes": []}


def write_lb_config(repo_id: str, config: dict) -> None:
    lb_config_path(repo_id).write_text(json.dumps(config, indent=2))
