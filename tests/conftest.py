"""
Shared fixtures and helpers for semfora-explorer analytics regression tests.

All tests run against pre-generated semfora SQLite DBs in data/.
No running server required — we query the DBs directly using the same
logic as the backend endpoints.
"""
import sqlite3
from pathlib import Path
import pytest

DATA_DIR = Path(__file__).parent.parent / "data"


def get_conn(db_name: str) -> sqlite3.Connection:
    """Open a fixture DB, raise a clean error if it doesn't exist."""
    path = DATA_DIR / db_name
    if not path.exists():
        pytest.skip(f"Fixture DB not found: {path}. Run generate_dbs.sh first.")
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


# --------------------------------------------------------------------------
# Analytics helpers — same logic as backend/main.py, extracted as pure fns
# --------------------------------------------------------------------------

def query_dead_code(conn: sqlite3.Connection) -> dict:
    """Returns {nodes: [...], safe_count, review_count, caution_count}."""
    rows = conn.execute(
        "SELECT * FROM nodes WHERE caller_count = 0 ORDER BY complexity DESC"
    ).fetchall()
    nodes = [dict(r) for r in rows]
    total = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]

    def confidence(n):
        name = n.get("name", "")
        kind = n.get("kind", "")
        if kind in ("class", "module"):
            return "caution"
        if name.startswith("test_") or name.startswith("_") or name == "main":
            return "caution"
        if kind == "function" and not name.startswith("_"):
            return "safe"
        return "review"

    for n in nodes:
        n["confidence"] = confidence(n)

    return {
        "nodes": nodes,
        "total_symbols": total,
        "dead_count": len(nodes),
        "dead_ratio": len(nodes) / total if total else 0,
        "safe_count": sum(1 for n in nodes if n["confidence"] == "safe"),
        "review_count": sum(1 for n in nodes if n["confidence"] == "review"),
        "caution_count": sum(1 for n in nodes if n["confidence"] == "caution"),
    }


def query_cycles(conn: sqlite3.Connection) -> list[dict]:
    """Detect SCCs with size > 1 (same logic as backend find_cycles)."""
    try:
        import networkx as nx
    except ImportError:
        pytest.skip("networkx not installed")

    rows = conn.execute("SELECT hash, name, module FROM nodes").fetchall()
    node_map = {r["hash"]: dict(r) for r in rows}
    edges = conn.execute("SELECT caller_hash, callee_hash FROM edges").fetchall()

    G = nx.DiGraph()
    for r in rows:
        G.add_node(r["hash"])
    for e in edges:
        G.add_edge(e["caller_hash"], e["callee_hash"])

    cycles = []
    for scc in nx.strongly_connected_components(G):
        if len(scc) < 2:
            continue
        nodes = [node_map[h] for h in scc if h in node_map]
        modules = list({n["module"] for n in nodes})
        cross = len(modules) > 1

        # find break suggestion (min-call-count edge in SCC)
        best = None
        for e in edges:
            if e["caller_hash"] in scc and e["callee_hash"] in scc:
                row = conn.execute(
                    "SELECT call_count FROM edges WHERE caller_hash=? AND callee_hash=?",
                    (e["caller_hash"], e["callee_hash"])
                ).fetchone()
                cc = row["call_count"] if row else 1
                if best is None or cc < best[2]:
                    best = (e["caller_hash"], e["callee_hash"], cc)

        cycles.append({
            "size": len(scc),
            "nodes": nodes,
            "modules": modules,
            "cross_module": cross,
            "break_suggestion": {
                "caller_hash": best[0],
                "callee_hash": best[1],
                "call_count": best[2],
            } if best else None,
        })

    return sorted(cycles, key=lambda c: c["size"], reverse=True)


def query_module_coupling(conn: sqlite3.Connection) -> dict:
    """Compute per-module afferent/efferent coupling and instability."""
    # Afferent coupling: other modules calling into this module
    afferent = {}
    efferent = {}

    rows = conn.execute("""
        SELECT caller_module, callee_module, SUM(edge_count) as cnt
        FROM module_edges
        WHERE caller_module != callee_module
          AND caller_module != '__external__'
          AND callee_module != '__external__'
        GROUP BY caller_module, callee_module
    """).fetchall()

    for r in rows:
        efferent[r["caller_module"]] = efferent.get(r["caller_module"], 0) + r["cnt"]
        afferent[r["callee_module"]] = afferent.get(r["callee_module"], 0) + r["cnt"]

    modules = set(list(afferent.keys()) + list(efferent.keys()))
    result = {}
    for m in modules:
        ca = afferent.get(m, 0)
        ce = efferent.get(m, 0)
        total = ca + ce
        result[m] = {
            "afferent": ca,
            "efferent": ce,
            "instability": round(ce / total, 3) if total else 0,
        }
    return result


def query_module_symbol_counts(conn: sqlite3.Connection) -> dict:
    """Return symbol count per module."""
    rows = conn.execute(
        "SELECT module, COUNT(*) as cnt FROM nodes GROUP BY module"
    ).fetchall()
    return {r["module"]: r["cnt"] for r in rows}


def query_top_callers(conn: sqlite3.Connection, top_n: int = 20) -> list[dict]:
    """Top nodes by caller_count (centrality proxy)."""
    rows = conn.execute(
        "SELECT * FROM nodes ORDER BY caller_count DESC LIMIT ?", (top_n,)
    ).fetchall()
    return [dict(r) for r in rows]


def count_modules_calling_node(conn: sqlite3.Connection, node_hash: str) -> int:
    """How many distinct modules call into this node?"""
    row = conn.execute("""
        SELECT COUNT(DISTINCT n.module) as cnt
        FROM edges e
        JOIN nodes n ON e.caller_hash = n.hash
        WHERE e.callee_hash = ?
    """, (node_hash,)).fetchone()
    return row["cnt"] if row else 0


# --------------------------------------------------------------------------
# Enrichment fixtures — session-scoped; generate *.enriched.db on demand
# --------------------------------------------------------------------------

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from enrich import enrich  # noqa: E402

TASKBOARD_SLUGS = [
    "main",
    "antipattern-circular-deps",
    "antipattern-dead-code-graveyard",
    "antipattern-feature-creep",
    "antipattern-god-object",
    "antipattern-tight-coupling",
    "antipattern-unstable-foundation",
    "antipattern-util-dumping-ground",
    # New antipatterns
    "antipattern-shotgun-surgery",
    "antipattern-anemic-domain-model",
    "antipattern-hub-spoke",
]


@pytest.fixture(scope="session")
def enriched_taskboard_dbs():
    """
    Enrich all 8 taskboard fixture DBs once per test session.

    Returns dict[slug → sqlite3.Connection] pointing at *.enriched.db copies.
    The original raw DBs are never modified.
    """
    conns: dict[str, sqlite3.Connection] = {}
    for slug in TASKBOARD_SLUGS:
        raw = DATA_DIR / f"taskboard-{slug}@HEAD.db"
        if not raw.exists():
            pytest.skip(f"Fixture DB not found: {raw}. Run generate_dbs.sh first.")
        enriched = enrich(raw, verbose=False)
        conn = sqlite3.connect(str(enriched))
        conn.row_factory = sqlite3.Row
        conns[slug] = conn

    yield conns

    for conn in conns.values():
        conn.close()


def scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> float | None:
    """Run a scalar query and return the single value."""
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def col(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list:
    """Run a query and return a flat list of first-column values (nulls excluded)."""
    return [r[0] for r in conn.execute(sql, params).fetchall() if r[0] is not None]
