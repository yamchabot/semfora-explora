"""
Semfora enrichment pass.

Computes all graph-structural signals for every node in a DB and writes
them to a `node_features` table. Run this once after generating a DB with
semfora-engine; analytics can then query pre-computed features instead of
recomputing graph algorithms at request time.

Usage:
    python3 enrich.py data/myrepo.db
    python3 enrich.py --all          # enrich every DB in data/

Signals computed (25 columns):
    Graph-structural (NetworkX):
      scc_id, scc_size, scc_cross_module
      topological_depth, reverse_topological_depth
      transitive_callers, transitive_callees
      betweenness_centrality, pagerank
      hub_score, authority_score
      clustering_coeff

    Module-boundary (SQL JOIN):
      xmod_fan_in, xmod_fan_out
      xmod_call_ratio
      dominant_callee_mod, dominant_callee_frac

    Composite / derived:
      utility_score           log(1 + transitive_callers) * log(2 + xmod_fan_in)
      stability_rank          xmod_fan_out / (xmod_fan_in + xmod_fan_out)
      complexity_pct          percentile of complexity within repo
      middleman_score         float: relay-ness (low complexity + high fan-in + fan-out)

    Community:
      community_id            Louvain community integer
      community_dominant_mod  most common declared module in this community
      community_alignment     bool: community_dominant_mod == declared module
"""
from __future__ import annotations

import argparse
import math
import shutil
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import networkx as nx
from networkx.algorithms.community import louvain_communities

DATA_DIR = Path(__file__).parent.parent / "data"


def enriched_path(db_path: Path) -> Path:
    """Return the path for the enriched copy of a raw DB."""
    return db_path.parent / (db_path.stem + ".enriched.db")

DDL = """
CREATE TABLE IF NOT EXISTS node_features (
    hash                    TEXT PRIMARY KEY,
    scc_id                  INTEGER,
    scc_size                INTEGER,
    scc_cross_module        INTEGER,   -- bool
    topological_depth       INTEGER,
    reverse_topological_depth INTEGER,
    transitive_callers      INTEGER,
    transitive_callees      INTEGER,
    betweenness_centrality  REAL,
    pagerank                REAL,
    hub_score               REAL,
    authority_score         REAL,
    clustering_coeff        REAL,
    xmod_fan_in             INTEGER,
    xmod_fan_out            INTEGER,
    xmod_call_ratio         REAL,
    dominant_callee_mod     TEXT,
    dominant_callee_frac    REAL,
    utility_score           REAL,
    stability_rank          REAL,
    complexity_pct          REAL,
    middleman_score         REAL,
    community_id            INTEGER,
    community_dominant_mod  TEXT,
    community_alignment     INTEGER    -- bool
)
"""


# ── Graph construction ────────────────────────────────────────────────────────

def _build_graph(conn: sqlite3.Connection) -> tuple[nx.DiGraph, dict[str, dict]]:
    """Build internal call graph and node metadata dict."""
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        "SELECT hash, name, module, complexity, caller_count, callee_count "
        "FROM nodes WHERE hash NOT LIKE 'ext:%'"
    )
    node_rows = {r["hash"]: dict(r) for r in cur.fetchall()}

    cur.execute(
        "SELECT caller_hash, callee_hash FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    )
    edge_rows = [
        (r["caller_hash"], r["callee_hash"]) for r in cur.fetchall()
        if r["caller_hash"] in node_rows and r["callee_hash"] in node_rows
    ]

    G = nx.DiGraph()
    G.add_nodes_from(node_rows)
    G.add_edges_from(edge_rows)
    return G, node_rows


# ── SCC signals ───────────────────────────────────────────────────────────────

def _compute_scc_signals(
    G: nx.DiGraph, node_meta: dict[str, dict]
) -> dict[str, dict]:
    sccs = list(nx.strongly_connected_components(G))
    result = {}
    for scc_id, scc in enumerate(sccs):
        modules = {node_meta[h]["module"] for h in scc if h in node_meta}
        cross = len(modules) > 1
        for h in scc:
            result[h] = {
                "scc_id":           scc_id,
                "scc_size":         len(scc),
                "scc_cross_module": int(cross),
            }
    return result


# ── Topological depth (condensation DAG) ─────────────────────────────────────

def _compute_topo_depths(G: nx.DiGraph) -> tuple[dict[str, int], dict[str, int]]:
    """
    Compute topological depth (from sources) and reverse depth (from sinks)
    on the SCC-condensed DAG using dynamic programming.

    Forward depth  = longest path from any source.
    Reverse depth  = longest path to any sink (= depth of the reversed graph).
    """
    def _dag_depth(dag: nx.DiGraph, reverse: bool = False) -> dict:
        """Longest path from sources in a DAG using DP."""
        g = dag.reverse() if reverse else dag
        depth = {n: 0 for n in g.nodes}
        for node in nx.topological_sort(g):
            for succ in g.successors(node):
                if depth[node] + 1 > depth[succ]:
                    depth[succ] = depth[node] + 1
        return depth

    cond = nx.condensation(G)
    members = nx.get_node_attributes(cond, "members")

    fwd_depth = _dag_depth(cond, reverse=False)
    rev_depth = _dag_depth(cond, reverse=True)

    result = {}
    for scc_node in cond.nodes:
        for h in members[scc_node]:
            result[h] = {
                "topological_depth":         fwd_depth[scc_node],
                "reverse_topological_depth": rev_depth[scc_node],
            }
    return result


# ── Transitive reachability via condensation DP ───────────────────────────────

def _compute_reachability(G: nx.DiGraph) -> dict[str, dict]:
    """
    Compute transitive_callers and transitive_callees for every node.

    Uses SCC condensation + topological DP — O(V + E) after condensation.
    Each node's count = size of SCC + sum of descendant SCC sizes.
    """
    cond = nx.condensation(G)
    members = nx.get_node_attributes(cond, "members")
    scc_size = {n: len(members[n]) for n in cond.nodes}

    def _reachable_counts(dag: nx.DiGraph) -> dict[int, int]:
        """Total reachable nodes from each DAG node (including self's SCC)."""
        counts = {n: scc_size[n] for n in dag.nodes}
        for node in reversed(list(nx.topological_sort(dag))):
            for pred in dag.predecessors(node):
                counts[pred] += counts[node]
        return counts

    fwd_counts = _reachable_counts(cond)
    rev_counts = _reachable_counts(cond.reverse())

    result = {}
    for scc_node in cond.nodes:
        for h in members[scc_node]:
            # subtract self from counts
            result[h] = {
                "transitive_callees": fwd_counts[scc_node] - 1,
                "transitive_callers": rev_counts[scc_node] - 1,
            }
    return result


# ── NetworkX centrality measures ─────────────────────────────────────────────

def _compute_centrality(G: nx.DiGraph) -> dict[str, dict]:
    n = len(G.nodes)

    # Betweenness (exact for small graphs, approximate for large)
    if n <= 3000:
        bc = nx.betweenness_centrality(G, normalized=True)
    else:
        bc = nx.betweenness_centrality(G, normalized=True, k=min(500, n))

    pr = nx.pagerank(G, alpha=0.85, max_iter=200)

    try:
        hubs, auths = nx.hits(G, max_iter=200, normalized=True)
    except nx.PowerIterationFailedConvergence:
        hubs  = {h: 0.0 for h in G.nodes}
        auths = {h: 0.0 for h in G.nodes}

    # Clustering on undirected projection
    UG = G.to_undirected()
    clust = nx.clustering(UG)

    result = {}
    for h in G.nodes:
        result[h] = {
            "betweenness_centrality": round(bc.get(h, 0), 6),
            "pagerank":               round(pr.get(h, 0), 6),
            "hub_score":              round(hubs.get(h, 0), 6),
            "authority_score":        round(auths.get(h, 0), 6),
            "clustering_coeff":       round(clust.get(h, 0), 4),
        }
    return result


# ── Module boundary signals (SQL) ─────────────────────────────────────────────

def _compute_boundary_signals(
    conn: sqlite3.Connection, node_meta: dict[str, dict]
) -> dict[str, dict]:
    cur = conn.cursor()

    # xmod_fan_in
    cur.execute("""
        SELECT n.hash, COUNT(DISTINCT n2.module) AS xmod_fan_in
        FROM nodes n
        JOIN edges e  ON e.callee_hash = n.hash
        JOIN nodes n2 ON e.caller_hash = n2.hash
        WHERE n.hash  NOT LIKE 'ext:%'
          AND n2.module IS NOT NULL AND n2.module != n.module
          AND n2.module != '__external__'
        GROUP BY n.hash
    """)
    xmod_fan_in = {r["hash"]: r["xmod_fan_in"] for r in cur.fetchall()}

    # xmod_fan_out
    cur.execute("""
        SELECT n.hash, COUNT(DISTINCT n2.module) AS xmod_fan_out
        FROM nodes n
        JOIN edges e  ON e.caller_hash = n.hash
        JOIN nodes n2 ON e.callee_hash = n2.hash
        WHERE n.hash  NOT LIKE 'ext:%'
          AND n2.module IS NOT NULL AND n2.module != n.module
          AND n2.module != '__external__' AND n2.hash NOT LIKE 'ext:%'
        GROUP BY n.hash
    """)
    xmod_fan_out = {r["hash"]: r["xmod_fan_out"] for r in cur.fetchall()}

    # xmod_call_ratio + dominant callee module
    cur.execute("""
        SELECT n.hash,
               CAST(SUM(CASE WHEN n2.module != n.module AND n2.module != '__external__'
                             THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS xmod_ratio
        FROM nodes n
        JOIN edges e  ON e.caller_hash = n.hash
        JOIN nodes n2 ON e.callee_hash = n2.hash
        WHERE n.hash NOT LIKE 'ext:%' AND n2.hash NOT LIKE 'ext:%'
        GROUP BY n.hash
    """)
    xmod_ratio = {r["hash"]: round(r["xmod_ratio"] or 0, 4) for r in cur.fetchall()}

    # dominant callee module
    cur.execute("""
        SELECT n.hash, n2.module AS callee_mod, COUNT(*) AS cnt
        FROM nodes n
        JOIN edges e  ON e.caller_hash = n.hash
        JOIN nodes n2 ON e.callee_hash = n2.hash
        WHERE n.hash NOT LIKE 'ext:%' AND n2.hash NOT LIKE 'ext:%'
          AND n2.module != '__external__'
        GROUP BY n.hash, n2.module
    """)
    callee_counts: dict[str, dict[str, int]] = defaultdict(dict)
    for r in cur.fetchall():
        callee_counts[r["hash"]][r["callee_mod"]] = r["cnt"]

    result = {}
    for h in node_meta:
        xfi  = xmod_fan_in.get(h, 0)
        xfo  = xmod_fan_out.get(h, 0)
        xrat = xmod_ratio.get(h, 0.0)

        dom_mod, dom_frac = None, 0.0
        if callee_counts[h]:
            total = sum(callee_counts[h].values())
            dm = max(callee_counts[h], key=callee_counts[h].get)
            dom_mod  = dm
            dom_frac = round(callee_counts[h][dm] / total, 4)

        stab = xfo / (xfi + xfo) if (xfi + xfo) > 0 else 0.5

        result[h] = {
            "xmod_fan_in":           xfi,
            "xmod_fan_out":          xfo,
            "xmod_call_ratio":       xrat,
            "dominant_callee_mod":   dom_mod,
            "dominant_callee_frac":  dom_frac,
            "stability_rank":        round(stab, 4),
        }
    return result


# ── Complexity percentile ─────────────────────────────────────────────────────

def _compute_complexity_pct(node_meta: dict[str, dict]) -> dict[str, float]:
    vals = sorted(v["complexity"] or 0 for v in node_meta.values())
    n = len(vals)
    rank_map: dict[float, float] = {}
    for i, v in enumerate(vals):
        rank_map.setdefault(v, (i + 1) / n)

    return {h: rank_map.get(meta["complexity"] or 0, 0.0) for h, meta in node_meta.items()}


# ── Middleman score ───────────────────────────────────────────────────────────

def _middleman_score(complexity: int, fan_in: int, fan_out: int) -> float:
    """
    How much does this node act as a pure relay (thin delegation wrapper)?
    High score = low complexity + significant fan-in AND fan-out.
    Score in [0, 1].
    """
    if fan_in == 0 or fan_out == 0:
        return 0.0
    complexity_penalty = 1 / (1 + (complexity or 0))
    flow = math.log(1 + fan_in) * math.log(1 + fan_out)
    return round(min(complexity_penalty * flow / 10, 1.0), 4)


# ── Utility score ─────────────────────────────────────────────────────────────

def _utility_score(transitive_callers: int, xmod_fan_in: int) -> float:
    return round(math.log(1 + transitive_callers) * math.log(2 + xmod_fan_in), 4)


# ── Community detection ───────────────────────────────────────────────────────

def _compute_community_signals(
    G: nx.DiGraph, node_meta: dict[str, dict]
) -> dict[str, dict]:
    UG = G.to_undirected()
    communities = louvain_communities(UG, seed=42)

    hash_to_comm = {}
    for cid, comm in enumerate(communities):
        for h in comm:
            hash_to_comm[h] = cid

    # Dominant module per community
    comm_mod_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for h, cid in hash_to_comm.items():
        mod = node_meta.get(h, {}).get("module", "__unknown__")
        comm_mod_counts[cid][mod] += 1

    comm_dominant = {
        cid: max(mc, key=mc.get)
        for cid, mc in comm_mod_counts.items()
    }

    result = {}
    for h in node_meta:
        cid  = hash_to_comm.get(h, -1)
        dom  = comm_dominant.get(cid, "__unknown__")
        home = node_meta[h].get("module", "")
        result[h] = {
            "community_id":           cid,
            "community_dominant_mod": dom,
            "community_alignment":    int(dom == home),
        }
    return result


# ── Main enrichment ───────────────────────────────────────────────────────────

def enrich(db_path: Path, verbose: bool = True) -> Path:
    """
    Enrich a raw semfora DB by writing computed signals into a copy.

    The original DB is never modified. The enriched copy is written to
    ``{stem}.enriched.db`` in the same directory and returned.
    """
    t0 = time.time()
    out_path = enriched_path(db_path)

    if verbose:
        print(f"Enriching {db_path.name} → {out_path.name} ...", flush=True)

    # Copy raw DB so we never touch the original
    shutil.copy2(db_path, out_path)

    conn = sqlite3.connect(out_path)
    conn.row_factory = sqlite3.Row
    conn.execute(DDL)
    conn.commit()

    G, node_meta = _build_graph(conn)
    n = len(G.nodes)
    if verbose:
        print(f"  {n} nodes, {len(G.edges)} edges", flush=True)

    if n == 0:
        conn.close()
        return out_path

    steps = [
        ("SCC signals",         lambda: _compute_scc_signals(G, node_meta)),
        ("Topo depths",         lambda: _compute_topo_depths(G)),
        ("Reachability",        lambda: _compute_reachability(G)),
        ("Centrality",          lambda: _compute_centrality(G)),
        ("Boundary signals",    lambda: _compute_boundary_signals(conn, node_meta)),
        ("Community",           lambda: _compute_community_signals(G, node_meta)),
    ]

    merged: dict[str, dict] = {h: {} for h in node_meta}
    for label, fn in steps:
        ts = time.time()
        data = fn()
        for h, vals in data.items():
            if h in merged:
                merged[h].update(vals)
        if verbose:
            print(f"  {label}: {round(time.time()-ts,2)}s", flush=True)

    # Complexity percentile
    cpct = _compute_complexity_pct(node_meta)

    # Assemble final rows
    rows = []
    for h, meta in node_meta.items():
        m = merged.get(h, {})
        tc  = m.get("transitive_callers", 0)
        xfi = m.get("xmod_fan_in", 0)
        xfo = m.get("xmod_fan_out", 0)
        cc  = meta.get("complexity") or 0
        fi  = meta.get("caller_count") or 0
        fo  = meta.get("callee_count") or 0

        rows.append((
            h,
            m.get("scc_id"),
            m.get("scc_size", 1),
            m.get("scc_cross_module", 0),
            m.get("topological_depth"),
            m.get("reverse_topological_depth"),
            m.get("transitive_callers", 0),
            m.get("transitive_callees", 0),
            m.get("betweenness_centrality", 0),
            m.get("pagerank", 0),
            m.get("hub_score", 0),
            m.get("authority_score", 0),
            m.get("clustering_coeff", 0),
            xfi,
            xfo,
            m.get("xmod_call_ratio", 0),
            m.get("dominant_callee_mod"),
            m.get("dominant_callee_frac", 0),
            _utility_score(tc, xfi),
            m.get("stability_rank", 0.5),
            round(cpct.get(h, 0), 4),
            _middleman_score(cc, fi, fo),
            m.get("community_id", -1),
            m.get("community_dominant_mod"),
            m.get("community_alignment", 0),
        ))

    conn.execute("DELETE FROM node_features")
    conn.executemany("""
        INSERT INTO node_features VALUES (
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
    """, rows)
    conn.commit()
    conn.close()

    if verbose:
        print(f"  Done. {len(rows)} rows written in {round(time.time()-t0,1)}s\n")

    return out_path


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich semfora DB with graph signals.")
    parser.add_argument("db", nargs="?", help="Path to raw .db file")
    parser.add_argument("--all", action="store_true", help="Enrich all raw DBs in data/")
    args = parser.parse_args()

    if args.all:
        # Only glob raw DBs — skip *.enriched.db copies
        dbs = sorted(p for p in DATA_DIR.glob("*.db") if ".enriched" not in p.name)
        print(f"Enriching {len(dbs)} databases in {DATA_DIR}/\n")
        for db in dbs:
            try:
                enrich(db)
            except Exception as ex:
                print(f"  ERROR {db.name}: {ex}")
    elif args.db:
        enrich(Path(args.db))
    else:
        parser.print_help()
