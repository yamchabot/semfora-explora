"""
Core query primitives — generic, reusable DB fetches.

All functions here operate on the internal call graph (external nodes/modules
filtered by default). Per-analytics query files should import from here and
add only the domain-specific logic that doesn't fit a generic pattern.

Naming convention:
  fetch_nodes(...)          — rows from the nodes table
  fetch_edges_*(...)        — rows from the edges table
  fetch_module_edges(...)   — rows from the module_edges table
  fetch_module_symbol_stats(...) — aggregated module stats from nodes
"""
from __future__ import annotations

import sqlite3

from db import row_to_dict

# ── Sentinel SQL fragments ────────────────────────────────────────────────────
# These are hard-coded constants, never user-derived.
_NOT_EXT_NODE  = "hash NOT LIKE 'ext:%'"
_NOT_EXT_EDGE  = "caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
_NOT_EXT_MOD   = "caller_module != '__external__' AND callee_module != '__external__'"


# ── Nodes ─────────────────────────────────────────────────────────────────────

def fetch_nodes(
    conn:        sqlite3.Connection,
    fields:      list[str] | None = None,
    extra_where: str | None       = None,
    order_by:    str | None       = None,
    limit:       int | None       = None,
) -> list[dict]:
    """
    Fetch internal nodes (external always excluded).

    fields      — column list; None → all columns
    extra_where — additional SQL predicate appended with AND (hard-coded only)
    order_by    — ORDER BY clause without the keyword, e.g. "caller_count DESC"
    limit       — LIMIT value
    """
    field_sql = ", ".join(fields) if fields else "*"
    where     = _NOT_EXT_NODE
    if extra_where:
        where += f" AND ({extra_where})"

    sql = f"SELECT {field_sql} FROM nodes WHERE {where}"
    if order_by:
        sql += f" ORDER BY {order_by}"
    if limit is not None:
        sql += f" LIMIT {limit}"

    return [row_to_dict(r) for r in conn.execute(sql).fetchall()]


# ── Edges ─────────────────────────────────────────────────────────────────────

def fetch_edges_all(
    conn:       sqlite3.Connection,
    call_count: bool = True,
) -> list[dict]:
    """
    Fetch all internal edges (both endpoints non-external).

    call_count — include the call_count column
    """
    cols = "caller_hash, callee_hash" + (", call_count" if call_count else "")
    return [
        row_to_dict(r)
        for r in conn.execute(
            f"SELECT {cols} FROM edges WHERE {_NOT_EXT_EDGE}"
        ).fetchall()
    ]


def fetch_edges_weighted(conn: sqlite3.Connection) -> list[dict]:
    """
    Fetch edges aggregated by (caller, callee) pair with call count as weight.
    Used by community detection which needs an undirected weighted graph.
    """
    return [
        row_to_dict(r)
        for r in conn.execute(
            f"SELECT caller_hash, callee_hash, COUNT(*) AS weight FROM edges "
            f"WHERE callee_hash NOT LIKE 'ext:%' "
            f"GROUP BY caller_hash, callee_hash"
        ).fetchall()
    ]


def fetch_edges_within(
    conn:        sqlite3.Connection,
    node_hashes: set[str] | list[str],
    call_count:  bool = False,
) -> list[dict]:
    """
    Fetch edges where both caller and callee are in node_hashes.
    Used when we already have a node set and want only its internal edges
    (building view, graph view).
    """
    if not node_hashes:
        return []
    hashes = list(node_hashes)
    ph     = ",".join("?" * len(hashes))
    cols   = "caller_hash, callee_hash" + (", call_count" if call_count else "")
    return [
        row_to_dict(r)
        for r in conn.execute(
            f"SELECT {cols} FROM edges "
            f"WHERE caller_hash IN ({ph}) AND callee_hash IN ({ph}) "
            f"AND callee_hash NOT LIKE 'ext:%'",
            hashes * 2,
        ).fetchall()
    ]


# ── Module-level ──────────────────────────────────────────────────────────────

def fetch_module_edges(conn: sqlite3.Connection) -> list[dict]:
    """
    All inter-module edges with __external__ filtered out.
    Canonical source — coupling.py and module_graph.py both import from here.
    """
    return [
        row_to_dict(r)
        for r in conn.execute(
            f"SELECT caller_module, callee_module, edge_count FROM module_edges "
            f"WHERE {_NOT_EXT_MOD}"
        ).fetchall()
    ]


def fetch_module_symbol_stats(conn: sqlite3.Connection) -> list[dict]:
    """
    Per-module symbol count and complexity aggregates, external excluded.
    Used by both module coupling and module graph views.
    """
    return [
        row_to_dict(r)
        for r in conn.execute(
            """
            SELECT module,
                   COUNT(DISTINCT hash)         AS symbol_count,
                   COALESCE(SUM(complexity), 0) AS total_complexity,
                   COALESCE(AVG(complexity), 0) AS avg_complexity
            FROM nodes
            WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'
            GROUP BY module
            """
        ).fetchall()
    ]
