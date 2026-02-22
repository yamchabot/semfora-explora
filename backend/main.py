"""
Semfora Explorer — FastAPI Backend
Serves graph analysis data from Semfora SQLite exports.
"""
import os
import sqlite3
import json
import math
from pathlib import Path
from typing import Optional
from collections import defaultdict, deque

import networkx as nx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Semfora Explorer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent.parent / "data"

# ── Helpers ─────────────────────────────────────────────────────────────────

def get_db(repo_id: str) -> sqlite3.Connection:
    db_path = DATA_DIR / f"{repo_id}.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"Repo '{repo_id}' not found. Run: semfora-engine query callgraph --export data/{repo_id}.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def row_to_dict(row) -> dict:
    return dict(row)

def build_nx_graph(conn: sqlite3.Connection, include_external: bool = False) -> nx.DiGraph:
    G = nx.DiGraph()
    cur = conn.cursor()
    cur.execute("SELECT hash, name, kind, module, file_path, line_start, complexity, caller_count, callee_count, risk FROM nodes")
    for row in cur.fetchall():
        G.add_node(row["hash"], **row_to_dict(row))
    cur.execute("SELECT caller_hash, callee_hash, call_count FROM edges")
    for row in cur.fetchall():
        caller = row["caller_hash"]
        callee = row["callee_hash"]
        if not include_external and (callee.startswith("ext:") or caller.startswith("ext:")):
            continue
        if G.has_node(caller) and G.has_node(callee):
            G.add_edge(caller, callee, call_count=row["call_count"])
    return G

# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/api/repos")
def list_repos():
    repos = []
    for db_file in sorted(DATA_DIR.glob("*.db")):
        repo_id = db_file.stem
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as n FROM nodes")
        node_count = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) as n FROM edges")
        edge_count = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(DISTINCT module) as n FROM nodes WHERE module IS NOT NULL")
        module_count = cur.fetchone()["n"]
        conn.close()
        repos.append({
            "id": repo_id,
            "name": repo_id,
            "node_count": node_count,
            "edge_count": edge_count,
            "module_count": module_count,
            "db_path": str(db_file),
        })
    return {"repos": repos}


@app.get("/api/repos/{repo_id}/overview")
def repo_overview(repo_id: str):
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) as n FROM nodes")
    node_count = cur.fetchone()["n"]
    cur.execute("SELECT COUNT(*) as n FROM edges")
    edge_count = cur.fetchone()["n"]
    cur.execute("SELECT COUNT(DISTINCT module) as n FROM nodes WHERE module IS NOT NULL")
    module_count = cur.fetchone()["n"]
    # Dead code: nodes with caller_count = 0 and not external
    cur.execute("SELECT COUNT(*) as n FROM nodes WHERE caller_count = 0 AND hash NOT LIKE 'ext:%'")
    dead_count = cur.fetchone()["n"]
    # Cycles: just use SCC count > 1 (approximation)
    cur.execute("""
        SELECT COUNT(*) as n FROM (
            SELECT caller_hash FROM edges GROUP BY caller_hash
            INTERSECT
            SELECT callee_hash FROM edges GROUP BY callee_hash
        )
    """)
    cycle_candidates = cur.fetchone()["n"]
    # Top modules by node count
    cur.execute("""
        SELECT module, COUNT(*) as cnt FROM nodes
        WHERE module IS NOT NULL GROUP BY module ORDER BY cnt DESC LIMIT 10
    """)
    top_modules = [row_to_dict(r) for r in cur.fetchall()]
    # Risk distribution
    cur.execute("SELECT risk, COUNT(*) as cnt FROM nodes GROUP BY risk")
    risk_dist = {r["risk"]: r["cnt"] for r in cur.fetchall()}
    conn.close()
    return {
        "repo_id": repo_id,
        "node_count": node_count,
        "edge_count": edge_count,
        "module_count": module_count,
        "dead_symbol_estimate": dead_count,
        "cycle_candidates": cycle_candidates,
        "top_modules": top_modules,
        "risk_distribution": risk_dist,
    }


@app.get("/api/repos/{repo_id}/modules")
def list_modules(repo_id: str):
    conn = get_db(repo_id)
    cur = conn.cursor()
    # Per-module coupling metrics
    cur.execute("""
        SELECT 
            n.module,
            COUNT(DISTINCT n.hash) as symbol_count,
            COALESCE(SUM(n.complexity), 0) as total_complexity,
            COALESCE(AVG(n.complexity), 0) as avg_complexity
        FROM nodes n
        WHERE n.module IS NOT NULL
        GROUP BY n.module
    """)
    modules_raw = {r["module"]: row_to_dict(r) for r in cur.fetchall()}
    # Cross-module edges
    cur.execute("SELECT caller_module, callee_module, edge_count FROM module_edges")
    for row in cur.fetchall():
        cm, callee_m, cnt = row["caller_module"], row["callee_module"], row["edge_count"]
        if cm == callee_m:
            continue
        # callee_m gets afferent coupling (others call into it)
        if callee_m in modules_raw:
            modules_raw[callee_m]["afferent"] = modules_raw[callee_m].get("afferent", 0) + cnt
        # cm gets efferent coupling (it calls out)
        if cm in modules_raw:
            modules_raw[cm]["efferent"] = modules_raw[cm].get("efferent", 0) + cnt
    results = []
    for m, data in modules_raw.items():
        ca = data.get("afferent", 0)
        ce = data.get("efferent", 0)
        instability = ce / (ca + ce) if (ca + ce) > 0 else 0
        results.append({
            "module": m,
            "symbol_count": data["symbol_count"],
            "afferent_coupling": ca,
            "efferent_coupling": ce,
            "instability": round(instability, 3),
            "avg_complexity": round(data["avg_complexity"], 2),
        })
    results.sort(key=lambda x: x["afferent_coupling"] + x["efferent_coupling"], reverse=True)
    conn.close()
    return {"modules": results}


@app.get("/api/repos/{repo_id}/module-edges")
def module_edges(repo_id: str):
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("SELECT caller_module, callee_module, edge_count FROM module_edges ORDER BY edge_count DESC LIMIT 200")
    edges = [row_to_dict(r) for r in cur.fetchall()]
    conn.close()
    return {"edges": edges}


@app.get("/api/repos/{repo_id}/graph")
def get_graph(
    repo_id: str,
    module: Optional[str] = None,
    limit: int = Query(300, le=2000),
    offset: int = 0,
):
    conn = get_db(repo_id)
    cur = conn.cursor()
    # Nodes
    if module:
        cur.execute(
            "SELECT hash, name, kind, module, file_path, line_start, complexity, caller_count, callee_count, risk FROM nodes WHERE module = ? LIMIT ? OFFSET ?",
            (module, limit, offset)
        )
    else:
        cur.execute(
            "SELECT hash, name, kind, module, file_path, line_start, complexity, caller_count, callee_count, risk FROM nodes WHERE hash NOT LIKE 'ext:%' LIMIT ? OFFSET ?",
            (limit, offset)
        )
    nodes = [row_to_dict(r) for r in cur.fetchall()]
    node_hashes = {n["hash"] for n in nodes}
    # Edges between these nodes only
    if node_hashes:
        placeholders = ",".join("?" * len(node_hashes))
        cur.execute(
            f"SELECT caller_hash, callee_hash, call_count FROM edges WHERE caller_hash IN ({placeholders}) AND callee_hash IN ({placeholders}) AND callee_hash NOT LIKE 'ext:%'",
            list(node_hashes) * 2
        )
        edges = [row_to_dict(r) for r in cur.fetchall()]
    else:
        edges = []
    conn.close()
    return {"nodes": nodes, "edges": edges, "total_nodes": len(nodes)}


@app.get("/api/repos/{repo_id}/nodes/{node_hash}")
def get_node(repo_id: str, node_hash: str):
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("SELECT * FROM nodes WHERE hash = ?", (node_hash,))
    node = cur.fetchone()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    node = row_to_dict(node)
    # Direct callers
    cur.execute("""
        SELECT n.hash, n.name, n.module, n.file_path, n.line_start
        FROM edges e JOIN nodes n ON e.caller_hash = n.hash
        WHERE e.callee_hash = ?
        LIMIT 50
    """, (node_hash,))
    callers = [row_to_dict(r) for r in cur.fetchall()]
    # Direct callees
    cur.execute("""
        SELECT n.hash, n.name, n.module, n.file_path, n.line_start
        FROM edges e JOIN nodes n ON e.callee_hash = n.hash
        WHERE e.caller_hash = ? AND e.callee_hash NOT LIKE 'ext:%'
        LIMIT 50
    """, (node_hash,))
    callees = [row_to_dict(r) for r in cur.fetchall()]
    conn.close()
    return {"node": node, "callers": callers, "callees": callees}


@app.get("/api/repos/{repo_id}/blast-radius/{node_hash}")
def blast_radius(repo_id: str, node_hash: str, max_depth: int = Query(5, le=10)):
    """BFS upstream (callers of callers) to find everything affected by this node."""
    conn = get_db(repo_id)
    cur = conn.cursor()
    # Build reverse adjacency: callee -> list of callers
    cur.execute("SELECT caller_hash, callee_hash FROM edges WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'")
    reverse_adj = defaultdict(list)
    for row in cur.fetchall():
        reverse_adj[row["callee_hash"]].append(row["caller_hash"])
    # BFS from target upward
    visited = {}  # hash -> depth
    queue = deque([(node_hash, 0)])
    while queue:
        current, depth = queue.popleft()
        if current in visited or depth > max_depth:
            continue
        visited[current] = depth
        if depth < max_depth:
            for caller in reverse_adj.get(current, []):
                if caller not in visited:
                    queue.append((caller, depth + 1))
    # Fetch node details for all visited
    if len(visited) > 1:
        hashes = [h for h in visited if h != node_hash]
        placeholders = ",".join("?" * len(hashes))
        cur.execute(f"SELECT hash, name, module, file_path, caller_count FROM nodes WHERE hash IN ({placeholders})", hashes)
        affected_nodes = []
        for row in cur.fetchall():
            d = row_to_dict(row)
            d["depth"] = visited[d["hash"]]
            affected_nodes.append(d)
    else:
        affected_nodes = []
    # Target node info
    cur.execute("SELECT hash, name, module, file_path, complexity, caller_count, callee_count, risk FROM nodes WHERE hash = ?", (node_hash,))
    target = cur.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="Node not found")
    target = row_to_dict(target)
    # Affected modules
    modules_affected = list({n["module"] for n in affected_nodes if n.get("module")})
    conn.close()
    return {
        "target": target,
        "affected_count": len(affected_nodes),
        "affected_nodes": sorted(affected_nodes, key=lambda x: x["depth"]),
        "modules_affected": modules_affected,
        "max_depth_reached": max_depth,
    }


@app.get("/api/repos/{repo_id}/dead-code")
def dead_code(repo_id: str, limit: int = Query(200, le=1000)):
    """Find nodes with no callers (unreachable)."""
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("""
        SELECT hash, name, kind, module, file_path, line_start, line_end, complexity
        FROM nodes
        WHERE caller_count = 0
          AND hash NOT LIKE 'ext:%'
          AND kind IN ('function', 'method', 'class')
        ORDER BY complexity DESC, name ASC
        LIMIT ?
    """, (limit,))
    dead = [row_to_dict(r) for r in cur.fetchall()]
    # Group by file
    by_file = defaultdict(list)
    for node in dead:
        by_file[node.get("file_path", "unknown")].append(node)
    file_groups = [
        {
            "file": f,
            "dead_count": len(nodes),
            "nodes": nodes,
        }
        for f, nodes in sorted(by_file.items(), key=lambda x: -len(x[1]))
    ]
    conn.close()
    return {
        "total_dead": len(dead),
        "file_groups": file_groups,
    }


@app.get("/api/repos/{repo_id}/centrality")
def centrality(repo_id: str, top_n: int = Query(30, le=100)):
    """Compute betweenness centrality for the top N most central nodes."""
    conn = get_db(repo_id)
    G = build_nx_graph(conn)
    conn2 = get_db(repo_id)
    cur = conn2.cursor()
    # Use degree centrality as a fast proxy (betweenness is O(n*m) and too slow for large graphs)
    if len(G.nodes) > 2000:
        # Use in-degree as a fast proxy for callee centrality
        scores = dict(G.in_degree())
        max_score = max(scores.values()) if scores else 1
        centrality_scores = {k: v / max_score for k, v in scores.items()}
    else:
        centrality_scores = nx.betweenness_centrality(G, normalized=True)
    top_hashes = sorted(centrality_scores, key=lambda h: centrality_scores[h], reverse=True)[:top_n]
    placeholders = ",".join("?" * len(top_hashes))
    cur.execute(
        f"SELECT hash, name, module, file_path, caller_count, callee_count, risk FROM nodes WHERE hash IN ({placeholders})",
        top_hashes
    )
    results = []
    for row in cur.fetchall():
        d = row_to_dict(row)
        d["centrality"] = round(centrality_scores.get(d["hash"], 0), 4)
        results.append(d)
    results.sort(key=lambda x: x["centrality"], reverse=True)
    conn.close()
    conn2.close()
    return {"nodes": results}


@app.get("/api/repos/{repo_id}/cycles")
def find_cycles(repo_id: str):
    """Find strongly connected components (cycles) in the call graph."""
    conn = get_db(repo_id)
    G = build_nx_graph(conn)
    sccs = [list(scc) for scc in nx.strongly_connected_components(G) if len(scc) > 1]
    cur = conn.cursor()
    result_cycles = []
    for scc in sorted(sccs, key=len, reverse=True)[:20]:
        placeholders = ",".join("?" * len(scc))
        cur.execute(f"SELECT hash, name, module, file_path FROM nodes WHERE hash IN ({placeholders})", scc)
        nodes = [row_to_dict(r) for r in cur.fetchall()]
        result_cycles.append({"size": len(scc), "nodes": nodes})
    conn.close()
    return {"cycles": result_cycles, "total_cycles": len(sccs)}


class DiffRequest(BaseModel):
    repo_a: str
    repo_b: str

@app.post("/api/diff")
def graph_diff(req: DiffRequest):
    """Compare two repos: find added, removed, and modified nodes/edges."""
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    cur_a, cur_b = conn_a.cursor(), conn_b.cursor()
    # Build node sets by name+module (hash will differ between repos)
    cur_a.execute("SELECT name, module, kind, file_path FROM nodes WHERE hash NOT LIKE 'ext:%'")
    nodes_a = {(r["name"], r["module"]): row_to_dict(r) for r in cur_a.fetchall()}
    cur_b.execute("SELECT name, module, kind, file_path FROM nodes WHERE hash NOT LIKE 'ext:%'")
    nodes_b = {(r["name"], r["module"]): row_to_dict(r) for r in cur_b.fetchall()}
    keys_a, keys_b = set(nodes_a.keys()), set(nodes_b.keys())
    added = [nodes_b[k] for k in keys_b - keys_a]
    removed = [nodes_a[k] for k in keys_a - keys_b]
    common = keys_a & keys_b
    # Module-level edge comparison
    cur_a.execute("SELECT caller_module, callee_module, edge_count FROM module_edges")
    mod_edges_a = {(r["caller_module"], r["callee_module"]): r["edge_count"] for r in cur_a.fetchall()}
    cur_b.execute("SELECT caller_module, callee_module, edge_count FROM module_edges")
    mod_edges_b = {(r["caller_module"], r["callee_module"]): r["edge_count"] for r in cur_b.fetchall()}
    new_mod_edges = [{"from": k[0], "to": k[1], "count": mod_edges_b[k]} for k in set(mod_edges_b) - set(mod_edges_a)]
    removed_mod_edges = [{"from": k[0], "to": k[1], "count": mod_edges_a[k]} for k in set(mod_edges_a) - set(mod_edges_b)]
    similarity = len(common) / max(len(keys_a | keys_b), 1)
    conn_a.close()
    conn_b.close()
    return {
        "repo_a": req.repo_a,
        "repo_b": req.repo_b,
        "similarity": round(similarity, 3),
        "nodes_added": len(added),
        "nodes_removed": len(removed),
        "nodes_common": len(common),
        "added": added[:50],
        "removed": removed[:50],
        "module_edges_added": new_mod_edges[:30],
        "module_edges_removed": removed_mod_edges[:30],
    }


@app.get("/api/repos/{repo_id}/search")
def search_nodes(repo_id: str, q: str = Query(..., min_length=1), limit: int = 20):
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("""
        SELECT hash, name, kind, module, file_path, line_start, caller_count, callee_count, risk
        FROM nodes
        WHERE name LIKE ? AND hash NOT LIKE 'ext:%'
        ORDER BY caller_count DESC
        LIMIT ?
    """, (f"%{q}%", limit))
    results = [row_to_dict(r) for r in cur.fetchall()]
    conn.close()
    return {"results": results, "query": q}


@app.get("/api/repos/{repo_id}/load-bearing")
def load_bearing_analysis(repo_id: str, threshold: int = Query(5)):
    """
    Detect load-bearing nodes: high in-degree, called from many modules.
    Returns both declared (heuristic: in core/platform modules) and unexpected candidates.
    """
    conn = get_db(repo_id)
    cur = conn.cursor()
    # Nodes called from many distinct modules
    cur.execute("""
        SELECT 
            n.hash, n.name, n.module, n.file_path, n.caller_count, n.callee_count, n.risk,
            COUNT(DISTINCT n2.module) as calling_module_count
        FROM nodes n
        JOIN edges e ON e.callee_hash = n.hash
        JOIN nodes n2 ON e.caller_hash = n2.hash
        WHERE n.hash NOT LIKE 'ext:%'
          AND n2.module != n.module
        GROUP BY n.hash
        HAVING calling_module_count >= ?
        ORDER BY calling_module_count DESC
        LIMIT 50
    """, (threshold,))
    high_centrality = [row_to_dict(r) for r in cur.fetchall()]
    # Heuristic: "load-bearing" = in a module named core, platform, base, shared, common, infra, lib
    lb_keywords = {"core", "platform", "base", "shared", "common", "infra", "lib", "utils"}
    declared = []
    unexpected = []
    for node in high_centrality:
        module = (node.get("module") or "").lower()
        parts = set(module.replace(".", "/").split("/"))
        if parts & lb_keywords:
            declared.append({**node, "classification": "load-bearing"})
        else:
            unexpected.append({**node, "classification": "unexpected"})
    conn.close()
    return {
        "declared_load_bearing": declared,
        "unexpected_load_bearing": unexpected,
        "threshold_modules": threshold,
    }
