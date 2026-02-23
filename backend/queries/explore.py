"""
Explore — OLAP pivot, raw node table, and induced subgraph queries.

Measure format (API string):
  special names:    "symbol_count" | "dead_ratio" | "high_risk_ratio" | "in_cycle_ratio"
  dynamic field:agg "caller_count:avg" | "complexity:stddev" | "utility:max" | ...
"""
from __future__ import annotations

import math
import sqlite3


# ── Simple dimensions ─────────────────────────────────────────────────────────

AVAILABLE_DIMENSIONS: dict[str, str] = {
    "module":     "n.module",
    "risk":       "n.risk",
    "kind":       "n.kind",
    "symbol":     "n.module || '::' || n.name",
    # Derived categorical dims (CASE expressions → fixed string buckets)
    "dead":       "CASE WHEN n.caller_count = 0 THEN 'dead' ELSE 'alive' END",
    "high_risk":  "CASE WHEN n.risk IN ('high','critical') THEN 'high-risk' ELSE 'normal' END",
    "in_cycle":   "CASE WHEN COALESCE(nf.scc_size, 1) > 1 THEN 'in-cycle' ELSE 'clean' END",
    # Community dims (Louvain — stored in node_features during enrichment)
    "community_dominant_mod":  "nf.community_dominant_mod",
    "community_alignment":     "CASE WHEN COALESCE(nf.community_alignment, 1) = 1 THEN 'aligned' ELSE 'misaligned' END",
}

# Dims that require node_features JOIN
_ENRICHED_DIMS = {"in_cycle", "community_dominant_mod", "community_alignment"}

# For graph edge queries we need the n1/n2-prefixed versions
_DIM_SRC = {
    "module":                "n1.module",
    "risk":                  "n1.risk",
    "kind":                  "n1.kind",
    "symbol":                "n1.module || '::' || n1.name",
    # Enriched dims — require LEFT JOIN node_features nf1 ON n1.hash = nf1.hash
    "community_dominant_mod": "nf1.community_dominant_mod",
}
_DIM_TGT = {
    "module":                "n2.module",
    "risk":                  "n2.risk",
    "kind":                  "n2.kind",
    "symbol":                "n2.module || '::' || n2.name",
    # Enriched dims — require LEFT JOIN node_features nf2 ON n2.hash = nf2.hash
    "community_dominant_mod": "nf2.community_dominant_mod",
}

# ── Bucketed dimensions (field:mode → CASE expression) ────────────────────────

BUCKET_FIELDS: dict[str, dict] = {
    "caller_count":    {"expr": "n.caller_count",                                                   "enriched": False},
    "callee_count":    {"expr": "n.callee_count",                                                   "enriched": False},
    "complexity":      {"expr": "n.complexity",                                                     "enriched": False},
    # Special-measure per-node equivalents (binary 0/1 → bucket as low/high)
    "dead_ratio":      {"expr": "CASE WHEN n.caller_count = 0 THEN 0.0 ELSE 1.0 END",              "enriched": False},
    "high_risk_ratio": {"expr": "CASE WHEN n.risk IN ('high','critical') THEN 1.0 ELSE 0.0 END",   "enriched": False},
    "in_cycle_ratio":  {"expr": "CASE WHEN COALESCE(nf.scc_size, 1) > 1 THEN 1.0 ELSE 0.0 END",   "enriched": True },
    # Enriched fields
    "pagerank":        {"expr": "nf.pagerank",                                                      "enriched": True },
    "utility":         {"expr": "nf.utility_score",                                                 "enriched": True },
    "xmod_fan_in":     {"expr": "nf.xmod_fan_in",                                                   "enriched": True },
    "betweenness":     {"expr": "nf.betweenness_centrality",                                        "enriched": True },
}

BUCKET_MODES: dict[str, int] = {
    "median":   2,
    "quartile": 4,
    "decile":   10,
}

_BUCKET_LABELS: dict[int, list[str]] = {
    2:  ["low", "high"],
    4:  ["Q1", "Q2", "Q3", "Q4"],
    10: [f"D{i+1}" for i in range(10)],
}


def _is_bucketed_dim(s: str) -> bool:
    if ":" not in s:
        return False
    field, mode = s.split(":", 1)
    return field in BUCKET_FIELDS and mode in BUCKET_MODES


def _compute_thresholds(
    conn: sqlite3.Connection,
    field_expr: str,
    n_buckets: int,
    has_nf: bool,
    kinds: list[str] | None,
) -> list[float]:
    """Compute n_buckets-1 percentile cut-points for field_expr."""
    join = "LEFT JOIN node_features nf ON n.hash = nf.hash" if (has_nf and "nf." in field_expr) else ""
    kc, kp = _kinds_clause(kinds)
    sql = (
        f"SELECT {field_expr} FROM nodes n {join} "
        f"WHERE n.hash NOT LIKE 'ext:%' AND {field_expr} IS NOT NULL {kc} "
        f"ORDER BY {field_expr}"
    )
    vals = [r[0] for r in conn.execute(sql, kp).fetchall()]
    if not vals:
        return []
    return [vals[int(len(vals) * i / n_buckets)] for i in range(1, n_buckets)]


def _bucket_case_expr(field_expr: str, thresholds: list, labels: list[str]) -> str:
    if not thresholds:
        return f"'{labels[-1]}'"
    whens = "".join(
        f" WHEN {field_expr} < {t} THEN '{lbl}'"
        for t, lbl in zip(thresholds, labels[:-1])
    )
    return f"CASE{whens} ELSE '{labels[-1]}' END"


def _resolve_dims(
    conn: sqlite3.Connection,
    dimensions: list[str],
    has_nf: bool,
    kinds: list[str] | None,
) -> list[tuple[str, str, str]]:
    """
    Return list of (key, safe_alias, sql_expr) for each valid dimension.
    Skips unknown dims and enriched-bucket dims when has_nf=False.
    """
    result = []
    for d in dimensions:
        if d in AVAILABLE_DIMENSIONS:
            if d in _ENRICHED_DIMS and not has_nf:
                continue   # skip enriched dim when node_features unavailable
            safe = d.replace(".", "_")
            result.append((d, safe, AVAILABLE_DIMENSIONS[d]))
        elif _is_bucketed_dim(d):
            field, mode = d.split(":", 1)
            bf = BUCKET_FIELDS[field]
            if bf["enriched"] and not has_nf:
                continue
            n  = BUCKET_MODES[mode]
            labels     = _BUCKET_LABELS.get(n, [str(i+1) for i in range(n)])
            thresholds = _compute_thresholds(conn, bf["expr"], n, has_nf, kinds)
            case_expr  = _bucket_case_expr(bf["expr"], thresholds, labels)
            safe       = f"{field}_{mode}"
            result.append((d, safe, case_expr))
    return result


# ── Fields (for dynamic field:agg measures) ───────────────────────────────────

FIELDS: dict[str, dict] = {
    "caller_count":  {"expr": "n.caller_count",             "type": "int",   "enriched": False, "label": "callers"},
    "callee_count":  {"expr": "n.callee_count",             "type": "int",   "enriched": False, "label": "callees"},
    "complexity":    {"expr": "n.complexity",               "type": "int",   "enriched": False, "label": "complexity"},
    "utility":       {"expr": "nf.utility_score",           "type": "float", "enriched": True,  "label": "utility"},
    "pagerank":      {"expr": "nf.pagerank",                "type": "float", "enriched": True,  "label": "pagerank"},
    "xmod_fan_in":   {"expr": "nf.xmod_fan_in",            "type": "int",   "enriched": True,  "label": "xmod_fan_in"},
    "topo_depth":    {"expr": "nf.topological_depth",      "type": "int",   "enriched": True,  "label": "topo_depth"},
    "betweenness":   {"expr": "nf.betweenness_centrality", "type": "float", "enriched": True,  "label": "betweenness"},
}

# ── Aggregation templates ─────────────────────────────────────────────────────

# {e} is replaced by the field expression
AGGS: dict[str, str] = {
    "avg":    "ROUND(AVG(CAST({e} AS REAL)), 4)",
    "min":    "MIN({e})",
    "max":    "MAX({e})",
    "sum":    "SUM({e})",
    "count":  "COUNT({e})",
    "stddev": "ROUND(stddev_pop({e}), 4)",   # registered Python aggregate
}

# ── Special (named, non-parametric) measures ──────────────────────────────────

SPECIAL_MEASURES: dict[str, dict] = {
    "symbol_count": {
        "expr":     "COUNT(*)",
        "type":     "int",
    },
    "dead_ratio": {
        "expr":     "ROUND(CAST(SUM(CASE WHEN n.caller_count = 0 THEN 1 ELSE 0 END) AS REAL)"
                    " / NULLIF(COUNT(*), 0), 3)",
        "type":     "ratio",
    },
    "high_risk_ratio": {
        "expr":     "ROUND(CAST(SUM(CASE WHEN n.risk IN ('high','critical') THEN 1 ELSE 0 END) AS REAL)"
                    " / NULLIF(COUNT(*), 0), 3)",
        "type":     "ratio",
    },
    "in_cycle_ratio": {
        "expr":     "ROUND(CAST(SUM(CASE WHEN COALESCE(nf.scc_size, 1) > 1 THEN 1 ELSE 0 END) AS REAL)"
                    " / NULLIF(COUNT(*), 0), 3)",
        "type":     "ratio",
        "enriched": True,
    },
}

_ENRICHED_FIELDS   = {k for k, v in FIELDS.items()          if v.get("enriched")}
_ENRICHED_SPECIALS = {k for k, v in SPECIAL_MEASURES.items() if v.get("enriched")}


# ── Population stddev as a SQLite custom aggregate ────────────────────────────

class _StddevPop:
    """Population standard deviation — registered as stddev_pop() in SQLite."""
    def __init__(self):
        self._vals: list[float] = []

    def step(self, x):
        if x is not None:
            try:
                self._vals.append(float(x))
            except (TypeError, ValueError):
                pass

    def finalize(self):
        n = len(self._vals)
        if n < 2:
            return 0.0
        mean = sum(self._vals) / n
        variance = sum((v - mean) ** 2 for v in self._vals) / n
        return round(math.sqrt(variance), 4)


def _register_aggregates(conn: sqlite3.Connection) -> None:
    conn.create_aggregate("stddev_pop", 1, _StddevPop)


# ── Measure parsing ───────────────────────────────────────────────────────────

def parse_measure(s: str) -> dict | None:
    """
    Parse one measure token.
      "symbol_count"     → {"type": "special", "name": "symbol_count"}
      "caller_count:avg" → {"type": "dynamic", "field": "caller_count", "agg": "avg"}
    Returns None for unknown tokens.
    """
    if ":" in s:
        field, _, agg = s.partition(":")
        if field in FIELDS and agg in AGGS:
            return {"type": "dynamic", "field": field, "agg": agg}
    elif s in SPECIAL_MEASURES:
        return {"type": "special", "name": s}
    return None


def measure_col(m: dict) -> str:
    """SQL column alias for a parsed measure."""
    if m["type"] == "special":
        return m["name"]
    return f"{m['field']}_{m['agg']}"


def measure_sql(m: dict, has_nf: bool) -> str | None:
    """
    SQL fragment "expr AS col" for a parsed measure.
    Returns None if the measure requires enriched data that isn't available.
    """
    if m["type"] == "special":
        name = m["name"]
        spec = SPECIAL_MEASURES[name]
        if spec.get("enriched") and not has_nf:
            return None
        return f"{spec['expr']} AS {name}"
    # dynamic
    field = m["field"]
    agg   = m["agg"]
    if FIELDS[field]["enriched"] and not has_nf:
        return None
    expr      = AGGS[agg].replace("{e}", FIELDS[field]["expr"])
    col       = measure_col(m)
    return f"{expr} AS {col}"


def measure_type(m: dict) -> str:
    if m["type"] == "special":
        return SPECIAL_MEASURES[m["name"]]["type"]
    agg        = m["agg"]
    field_type = FIELDS[m["field"]]["type"]
    if agg == "count":
        return "int"
    if agg in {"avg", "stddev"} or field_type == "float":
        return "float"
    return field_type


# ── Symbol-grain (zero-dimension) measure SQL ─────────────────────────────────
# When dimension = "symbol", each row is one node — no aggregation, raw values.

_SYMBOL_SPECIALS: dict[str, str] = {
    "symbol_count":    "1",
    "dead_ratio":      "CAST(CASE WHEN n.caller_count = 0 THEN 1 ELSE 0 END AS REAL)",
    "high_risk_ratio": "CAST(CASE WHEN n.risk IN ('high','critical') THEN 1 ELSE 0 END AS REAL)",
    "in_cycle_ratio":  "CAST(CASE WHEN COALESCE(nf.scc_size, 1) > 1 THEN 1 ELSE 0 END AS REAL)",
}

def _measure_sql_symbol(m: dict, has_nf: bool) -> str | None:
    """SQL fragment for a parsed measure in symbol (per-node) grain."""
    if m["type"] == "special":
        name = m["name"]
        if SPECIAL_MEASURES[name].get("enriched") and not has_nf:
            return None
        return f"{_SYMBOL_SPECIALS[name]} AS {name}"
    field = m["field"]
    if FIELDS[field]["enriched"] and not has_nf:
        return None
    return f"{FIELDS[field]['expr']} AS {measure_col(m)}"


_SYMBOL_LIMIT = 500


def _fetch_symbol_grain(
    conn: sqlite3.Connection,
    parsed: list[dict],
    has_nf: bool,
    kinds: list[str] | None,
) -> dict:
    """One row per node — used when no dimensions are selected."""
    valid_measures = [m for m in parsed if _measure_sql_symbol(m, has_nf) is not None]
    if not valid_measures:
        return {
            "rows": [], "dimensions": ["symbol"], "measures": [],
            "measure_types": {}, "has_enriched": has_nf, "graph_edges": [],
            "symbol_total": 0,
        }

    frags = [_measure_sql_symbol(m, has_nf) for m in valid_measures]
    cols  = [measure_col(m) for m in valid_measures]
    join  = "LEFT JOIN node_features nf ON n.hash = nf.hash" if has_nf else ""
    kc, kp = _kinds_clause(kinds)

    # Fetch node rows + their hashes (for edge query)
    hash_sql = (
        f"SELECT n.hash, n.name, n.module, {', '.join(frags)} "
        f"FROM nodes n {join} "
        f"WHERE n.hash NOT LIKE 'ext:%' {kc} "
        f"ORDER BY n.caller_count DESC, n.name ASC "
        f"LIMIT ?"
    )
    rows_raw = [dict(r) for r in conn.execute(hash_sql, kp + [_SYMBOL_LIMIT]).fetchall()]

    total_sql = f"SELECT COUNT(*) FROM nodes n WHERE n.hash NOT LIKE 'ext:%' {kc}"
    total     = conn.execute(total_sql, kp).fetchone()[0]

    # Build rows — use "module::name" as the unique symbol ID
    rows = [
        {
            "key":      {"symbol": f"{r['module']}::{r['name']}"},
            "depth":    0,
            "values":   {c: r[c] for c in cols},
            "children": [],
        }
        for r in rows_raw
    ]

    # Edges between the returned nodes (direct call relationships)
    hashes = [r["hash"] for r in rows_raw]
    graph_edges: list[dict] = []
    if hashes:
        ph  = ",".join("?" * len(hashes))
        esql = (
            f"SELECT n1.module || '::' || n1.name AS source, "
            f"       n2.module || '::' || n2.name AS target, "
            f"       e.call_count AS weight "
            f"FROM edges e "
            f"JOIN nodes n1 ON e.caller_hash = n1.hash "
            f"JOIN nodes n2 ON e.callee_hash = n2.hash "
            f"WHERE e.caller_hash IN ({ph}) "
            f"  AND e.callee_hash IN ({ph}) "
            f"ORDER BY weight DESC "
            f"LIMIT 2000"
        )
        graph_edges = [dict(r) for r in conn.execute(esql, hashes + hashes).fetchall()]

    return {
        "rows":          rows,
        "dimensions":    ["symbol"],
        "measures":      cols,
        "measure_types": {measure_col(m): measure_type(m) for m in valid_measures},
        "has_enriched":  has_nf,
        "graph_edges":   graph_edges,
        "symbol_total":  total,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _has_node_features(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='node_features'"
    ).fetchone()
    return row is not None


def _kinds_clause(kinds: list[str] | None, alias: str = "n") -> tuple[str, list]:
    if not kinds:
        return "", []
    ph = ",".join("?" * len(kinds))
    return f"AND {alias}.kind IN ({ph})", list(kinds)


def _pivot_sql(
    dim_triples: list[tuple[str, str, str]],   # (key, safe_alias, sql_expr)
    measure_frags: list[str],
    has_nf: bool,
    kinds: list[str] | None,
) -> tuple[str, list]:
    """Build the GROUP BY pivot query from resolved dimension triples."""
    dim_selects = [f"({expr}) AS {alias}" for _, alias, expr in dim_triples]
    join        = "LEFT JOIN node_features nf ON n.hash = nf.hash" if has_nf else ""
    kc, kp      = _kinds_clause(kinds)
    n           = len(dim_triples)
    # Use positional GROUP BY / ORDER BY to support CASE expressions as dims
    positions   = ", ".join(str(i + 1) for i in range(n))

    sql = (
        f"SELECT {', '.join(dim_selects + measure_frags)} "
        f"FROM nodes n {join} "
        f"WHERE n.hash NOT LIKE 'ext:%' {kc} "
        f"GROUP BY {positions} "
        f"ORDER BY {positions}"
    )
    return sql, kp


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_pivot(
    conn: sqlite3.Connection,
    dimensions: list[str],
    measures_raw: list[str],
    kinds: list[str] | None = None,
) -> dict:
    _register_aggregates(conn)

    parsed = [m for m in (parse_measure(s) for s in measures_raw) if m is not None]
    has_nf = _has_node_features(conn)

    # Zero-dimension grain → individual symbol rows
    if not dimensions or dimensions == ["symbol"]:
        return _fetch_symbol_grain(conn, parsed, has_nf, kinds)

    # Resolve all requested dimensions (simple + bucketed)
    dim_triples = _resolve_dims(conn, dimensions, has_nf, kinds)

    # Drop measures that require enriched data when unavailable
    valid_measures = [m for m in parsed if measure_sql(m, has_nf) is not None]

    if not dim_triples or not valid_measures:
        return {
            "rows":             [],
            "dimensions":       [t[0] for t in dim_triples],
            "measures":         [],
            "measure_types":    {},
            "has_enriched":     has_nf,
            "graph_edges":      [],
            "leaf_graph_edges": [],
        }

    frags = [measure_sql(m, has_nf) for m in valid_measures]
    cols  = [measure_col(m) for m in valid_measures]

    # Helpers to read dim values from result rows by safe alias
    def row_key(r: dict, triples: list) -> dict:
        return {t[0]: r[t[1]] for t in triples}

    # ── Build pivot tree ──────────────────────────────────────────────────────

    if len(dim_triples) == 1:
        sql, params = _pivot_sql(dim_triples[:1], frags, has_nf, kinds)
        leaf_rows   = [dict(r) for r in conn.execute(sql, params).fetchall()]
        dim0_key    = dim_triples[0][0]
        dim0_alias  = dim_triples[0][1]
        rows = [
            {
                "key":      {dim0_key: r[dim0_alias]},
                "depth":    0,
                "values":   {c: r[c] for c in cols},
                "children": [],
            }
            for r in leaf_rows
        ]
    else:
        d0_key, d0_alias = dim_triples[0][0], dim_triples[0][1]
        d1_key, d1_alias = dim_triples[1][0], dim_triples[1][1]

        # Leaf level (top-2 dims)
        leaf_sql, leaf_p = _pivot_sql(dim_triples[:2], frags, has_nf, kinds)
        leaf_rows        = [dict(r) for r in conn.execute(leaf_sql, leaf_p).fetchall()]
        # Parent level (first dim only)
        par_sql, par_p   = _pivot_sql(dim_triples[:1], frags, has_nf, kinds)
        parent_map       = {
            r[d0_alias]: {c: r[c] for c in cols}
            for r in (dict(x) for x in conn.execute(par_sql, par_p).fetchall())
        }
        children_map: dict = {}
        for r in leaf_rows:
            pk = r[d0_alias]
            children_map.setdefault(pk, []).append({
                "key":      {d0_key: r[d0_alias], d1_key: r[d1_alias]},
                "depth":    1,
                "values":   {c: r[c] for c in cols},
                "children": [],
            })
        rows = [
            {
                "key":      {d0_key: pk},
                "depth":    0,
                "values":   pv,
                "children": sorted(children_map.get(pk, []), key=lambda c: -(c["values"].get("symbol_count") or 0)),
            }
            for pk, pv in parent_map.items()
        ]

    rows.sort(key=lambda r: -(r["values"].get("symbol_count") or 0))

    # ── Induced subgraph edges ────────────────────────────────────────────────
    # Only simple (non-bucketed) dimensions have edge support
    dim0_key_name = dim_triples[0][0]
    graph_edges   = fetch_graph_edges(conn, dim0_key_name, kinds)
    leaf_edges    = fetch_graph_edges(conn, dim_triples[1][0], kinds) if len(dim_triples) >= 2 else []

    valid_dim_keys = [t[0] for t in dim_triples]
    return {
        "rows":             rows,
        "dimensions":       valid_dim_keys,
        "measures":         [measure_col(m) for m in valid_measures],
        "measure_types":    {measure_col(m): measure_type(m) for m in valid_measures},
        "has_enriched":     has_nf,
        "graph_edges":      graph_edges,
        "leaf_graph_edges": leaf_edges,
    }


def fetch_graph_edges(
    conn: sqlite3.Connection,
    dimension: str,
    kinds: list[str] | None = None,
) -> list[dict]:
    """
    Return inter-group edges for the induced subgraph.
    Nodes = distinct values of `dimension`; edges = call relationships between them.
    """
    if dimension not in _DIM_SRC:
        return []

    src = _DIM_SRC[dimension]
    tgt = _DIM_TGT[dimension]

    # Auto-add node_features join when the dim expression references nf1/nf2
    nf_join = (
        "LEFT JOIN node_features nf1 ON n1.hash = nf1.hash "
        "LEFT JOIN node_features nf2 ON n2.hash = nf2.hash"
        if ("nf1." in src or "nf2." in tgt) else ""
    )

    kc_src, kp_src = _kinds_clause(kinds, alias="n1")
    kc_tgt, kp_tgt = _kinds_clause(kinds, alias="n2")

    sql = (
        f"SELECT {src} AS source, {tgt} AS target, COUNT(*) AS weight "
        f"FROM edges e "
        f"JOIN nodes n1 ON e.caller_hash = n1.hash "
        f"JOIN nodes n2 ON e.callee_hash = n2.hash "
        f"{nf_join} "
        f"WHERE n1.hash NOT LIKE 'ext:%' "
        f"  AND n2.hash NOT LIKE 'ext:%' "
        f"  AND {src} IS NOT NULL AND {tgt} IS NOT NULL "
        f"  AND {src} != {tgt} "
        f"  {kc_src} {kc_tgt} "
        f"GROUP BY source, target "
        f"ORDER BY weight DESC"
    )
    params = kp_src + kp_tgt
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ── Distinct dimension values (for filter chips) ─────────────────────────────

# Simple dims that have bounded cardinality and are useful for value-picker filters
_PICKER_DIMS = {
    "module":                "n.module",
    "risk":                  "n.risk",
    "kind":                  "n.kind",
    "dead":                  "CASE WHEN n.caller_count = 0 THEN 'dead' ELSE 'alive' END",
    "high_risk":             "CASE WHEN n.risk IN ('high','critical') THEN 'high-risk' ELSE 'normal' END",
    "community_dominant_mod":  "nf.community_dominant_mod",
    "community_alignment":     "CASE WHEN COALESCE(nf.community_alignment, 1) = 1 THEN 'aligned' ELSE 'misaligned' END",
}


def fetch_dim_values(
    conn: sqlite3.Connection,
    kinds: list[str] | None = None,
) -> dict[str, list[str]]:
    """
    Return distinct values for each picker dim.
    Used by the frontend filter chips so users can see/select values
    regardless of what Group By dims are currently active.
    """
    kc, kp = _kinds_clause(kinds)
    has_nf = _has_node_features(conn)
    result: dict[str, list[str]] = {}
    for dim, expr in _PICKER_DIMS.items():
        # Skip enriched picker dims when node_features isn't available
        if "nf." in expr and not has_nf:
            continue
        nf_join = "LEFT JOIN node_features nf ON n.hash = nf.hash" if "nf." in expr else ""
        rows = conn.execute(
            f"SELECT DISTINCT ({expr}) AS v FROM nodes n {nf_join} "
            f"WHERE n.hash NOT LIKE 'ext:%' AND ({expr}) IS NOT NULL {kc} "
            f"ORDER BY v",
            kp,
        ).fetchall()
        result[dim] = [r[0] for r in rows if r[0] is not None]
    return result


# ── Raw node table ─────────────────────────────────────────────────────────────

_SAFE_NODE_SORTS = {"caller_count", "callee_count", "complexity", "name", "module"}
_SAFE_NF_SORTS   = {"utility_score", "pagerank", "xmod_fan_in"}


def fetch_nodes(
    conn: sqlite3.Connection,
    sort_by:  str = "caller_count",
    sort_dir: str = "desc",
    limit:    int = 300,
    kinds:    list[str] | None = None,
) -> dict:
    has_nf = _has_node_features(conn)

    base_cols   = (
        "n.hash, n.name, n.module, n.kind, n.risk, "
        "n.complexity, n.caller_count, n.callee_count, n.file_path, n.line_start"
    )
    enrich_cols = (
        ", nf.utility_score, nf.pagerank, nf.xmod_fan_in, nf.xmod_fan_out, "
        "nf.scc_size, nf.topological_depth, nf.complexity_pct"
    ) if has_nf else ""
    join = "LEFT JOIN node_features nf ON n.hash = nf.hash" if has_nf else ""

    if sort_by in _SAFE_NF_SORTS and has_nf:
        sort_col = f"nf.{sort_by}"
    elif sort_by in _SAFE_NODE_SORTS:
        sort_col = f"n.{sort_by}"
    else:
        sort_col = "n.caller_count"
    sort_dir_sql = "DESC" if sort_dir.lower() == "desc" else "ASC"

    kc, kp = _kinds_clause(kinds)

    sql = (
        f"SELECT {base_cols}{enrich_cols} "
        f"FROM nodes n {join} "
        f"WHERE n.hash NOT LIKE 'ext:%' {kc} "
        f"ORDER BY {sort_col} {sort_dir_sql} "
        f"LIMIT ?"
    )
    nodes = [dict(r) for r in conn.execute(sql, kp + [limit]).fetchall()]

    for node in nodes:
        edges = conn.execute(
            "SELECT e.callee_hash AS hash, n2.name, n2.module, e.call_count "
            "FROM edges e JOIN nodes n2 ON e.callee_hash = n2.hash "
            "WHERE e.caller_hash = ? AND n2.hash NOT LIKE 'ext:%' "
            "ORDER BY e.call_count DESC LIMIT 8",
            (node["hash"],),
        ).fetchall()
        node["outbound_edges"] = [dict(e) for e in edges]

    total_sql   = f"SELECT COUNT(*) FROM nodes n WHERE n.hash NOT LIKE 'ext:%' {kc}"
    total       = conn.execute(total_sql, kp).fetchone()[0]

    return {"nodes": nodes, "has_enriched": has_nf, "total": total}
