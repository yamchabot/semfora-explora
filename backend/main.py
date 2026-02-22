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
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="Semfora Explorer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent.parent / "data"
CONFIG_DIR = DATA_DIR  # load-bearing configs stored alongside .db files


def lb_config_path(repo_id: str) -> Path:
    return CONFIG_DIR / f"{repo_id}.load-bearing.json"


def read_lb_config(repo_id: str) -> dict:
    p = lb_config_path(repo_id)
    if p.exists():
        return json.loads(p.read_text())
    return {"declared_modules": [], "declared_nodes": []}


def write_lb_config(repo_id: str, config: dict):
    lb_config_path(repo_id).write_text(json.dumps(config, indent=2))

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
        try:
            conn = sqlite3.connect(db_file)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) as n FROM nodes")
            node_count = cur.fetchone()["n"]
            cur.execute("SELECT COUNT(*) as n FROM edges")
            edge_count = cur.fetchone()["n"]
            cur.execute("SELECT COUNT(DISTINCT module) as n FROM nodes WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'")
            module_count = cur.fetchone()["n"]
            conn.close()
        except Exception:
            continue
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
    cur.execute("SELECT COUNT(DISTINCT module) as n FROM nodes WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'")
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
        WHERE module IS NOT NULL AND hash NOT LIKE 'ext:%'
        GROUP BY module ORDER BY cnt DESC LIMIT 10
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


@app.get("/api/repos/{repo_id}/triage")
def triage(repo_id: str):
    """
    Surface the top actionable structural issues — combines signals from
    multiple analyses into a ranked, prescriptive list.
    """
    conn = get_db(repo_id)
    cur = conn.cursor()
    config = read_lb_config(repo_id)
    declared_hashes  = set(config.get("declared_nodes", []))
    declared_modules = set(config.get("declared_modules", []))
    issues = []

    # ── Issue type 1: Unexpected load-bearing nodes ──────────────────────────
    cur.execute("""
        SELECT n.hash, n.name, n.module, n.complexity,
               COUNT(DISTINCT caller_mod.module) AS calling_modules,
               n.caller_count
        FROM nodes n
        JOIN edges e ON e.callee_hash = n.hash
        JOIN nodes caller_mod ON caller_mod.hash = e.caller_hash
        WHERE n.hash NOT LIKE 'ext:%'
          AND caller_mod.module IS NOT NULL
          AND caller_mod.module != n.module
        GROUP BY n.hash
        HAVING calling_modules >= 5
        ORDER BY calling_modules DESC, n.complexity DESC
        LIMIT 10
    """)
    unexpected = [
        r for r in cur.fetchall()
        if r["hash"] not in declared_hashes
        and (r["module"] or "") not in declared_modules
    ]
    for row in unexpected[:3]:
        issues.append({
            "type":     "unexpected_coupling",
            "severity": "high" if row["calling_modules"] >= 8 else "medium",
            "title":    f"`{row['name']}` is load-bearing without declaration",
            "detail":   f"Called from {row['calling_modules']} modules but not declared as load-bearing. "
                        f"Module: {row['module']}. This node will resist refactoring.",
            "action":   "Open Building View → click this node → Declare load-bearing (if intentional) "
                        "or plan to reduce its callers.",
            "hash":     row["hash"],
            "name":     row["name"],
        })

    # ── Issue type 2: Unstable high-traffic modules ───────────────────────────
    cur.execute("""
        SELECT caller_module, callee_module, SUM(edge_count) AS total
        FROM module_edges
        WHERE caller_module != callee_module
          AND caller_module != '__external__'
          AND callee_module != '__external__'
        GROUP BY caller_module, callee_module
        ORDER BY total DESC
    """)
    mod_edges = cur.fetchall()
    afferent  = defaultdict(int)
    efferent  = defaultdict(int)
    for e in mod_edges:
        afferent[e["callee_module"]]  += e["total"]
        efferent[e["caller_module"]] += e["total"]
    unstable_high_traffic = [
        m for m in afferent
        if afferent[m] > 5
        and (efferent[m] / (afferent[m] + efferent[m])) > 0.65
    ]
    if unstable_high_traffic:
        m = sorted(unstable_high_traffic, key=lambda x: afferent[x] + efferent[x], reverse=True)[0]
        ca, ce = afferent[m], efferent[m]
        instability = round(ce / (ca + ce), 2)
        issues.append({
            "type":     "unstable_module",
            "severity": "medium",
            "title":    f"`{m}` is high-traffic and unstable (I={instability})",
            "detail":   f"Called from {ca} edges in, {ce} edges out. "
                        f"Instability {instability} means changes here ripple widely.",
            "action":   "Open Module Coupling → review this module's callers. "
                        "Consider extracting stable core interfaces from this module.",
            "module":   m,
        })

    # ── Issue type 3: Large cross-module cycles ───────────────────────────────
    try:
        G = build_nx_graph(conn)
        sccs = [scc for scc in nx.strongly_connected_components(G) if len(scc) > 1]
        cross_sccs = []
        for scc in sccs:
            mods = {G.nodes[h].get("module") for h in scc if h in G.nodes}
            mods.discard(None)
            if len(mods) > 1:
                cross_sccs.append((scc, mods))
        if cross_sccs:
            biggest = max(cross_sccs, key=lambda x: len(x[0]))
            scc_hashes, mods = biggest
            # find weakest edge
            intra = [(u, v, d) for u, v, d in G.edges(scc_hashes, data=True) if v in set(scc_hashes)]
            if intra:
                weakest = min(intra, key=lambda e: e[2].get("call_count", 0))
                w_caller = G.nodes.get(weakest[0], {}).get("name", weakest[0])
                w_callee = G.nodes.get(weakest[1], {}).get("name", weakest[1])
                issues.append({
                    "type":     "cross_module_cycle",
                    "severity": "high",
                    "title":    f"Cross-module cycle across {len(mods)} modules ({len(scc_hashes)} symbols)",
                    "detail":   f"Modules involved: {', '.join(sorted(mods)[:4])}{'…' if len(mods) > 4 else ''}. "
                                f"Circular dependencies prevent clean module extraction.",
                    "action":   f"Open Cycles → cut the call `{w_caller}` → `{w_callee}` "
                                f"(lowest call count in the cycle) to break it.",
                    "modules":  sorted(mods),
                })
    except Exception:
        pass

    # ── Issue type 4: High dead code concentration ────────────────────────────
    cur.execute("""
        SELECT file_path,
               COUNT(*) AS total,
               SUM(CASE WHEN caller_count = 0 THEN 1 ELSE 0 END) AS dead
        FROM nodes
        WHERE hash NOT LIKE 'ext:%' AND kind IN ('function','method','class')
          AND file_path IS NOT NULL
        GROUP BY file_path
        HAVING total >= 5 AND dead * 1.0 / total >= 0.6
        ORDER BY dead DESC
        LIMIT 1
    """)
    high_dead = cur.fetchone()
    if high_dead and high_dead["dead"] >= 5:
        pct = round(high_dead["dead"] / high_dead["total"] * 100)
        issues.append({
            "type":     "dead_code_concentration",
            "severity": "low",
            "title":    f"{pct}% of `{high_dead['file_path'].split('/')[-1]}` is unreachable",
            "detail":   f"{high_dead['dead']} of {high_dead['total']} symbols have zero callers. "
                        f"This file may be legacy code.",
            "action":   "Open Dead Code → review this file's symbols. "
                        "Private functions with low complexity are safest to delete first.",
            "file":     high_dead["file_path"],
        })

    conn.close()
    # Sort: high → medium → low
    severity_order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda x: severity_order.get(x["severity"], 3))
    return {"issues": issues[:5]}


@app.get("/api/repos/{repo_id}/module-edges-detail")
def module_edges_detail(
    repo_id: str,
    from_module: str = Query(...),
    to_module:   str = Query(...),
    limit:       int = Query(50, le=200),
):
    """
    Return the actual function-level calls that make up the edge
    between two modules in the heatmap.
    """
    conn = get_db(repo_id)
    cur = conn.cursor()
    cur.execute("""
        SELECT
            cn.name AS caller_name, cn.hash AS caller_hash, cn.file_path AS caller_file,
            ee.name AS callee_name, ee.hash AS callee_hash, ee.file_path AS callee_file,
            COALESCE(e.call_count, 1) AS call_count
        FROM edges e
        JOIN nodes cn ON cn.hash = e.caller_hash
        JOIN nodes ee ON ee.hash = e.callee_hash
        WHERE cn.module = ? AND ee.module = ?
          AND cn.hash NOT LIKE 'ext:%' AND ee.hash NOT LIKE 'ext:%'
        ORDER BY call_count DESC
        LIMIT ?
    """, (from_module, to_module, limit))
    calls = [row_to_dict(r) for r in cur.fetchall()]
    conn.close()
    return {
        "from_module": from_module,
        "to_module":   to_module,
        "total":       len(calls),
        "calls":       calls,
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
        WHERE n.module IS NOT NULL AND n.hash NOT LIKE 'ext:%'
        GROUP BY n.module
    """)
    modules_raw = {r["module"]: row_to_dict(r) for r in cur.fetchall()}
    # Cross-module edges
    cur.execute("""
        SELECT caller_module, callee_module, edge_count FROM module_edges
        WHERE caller_module != '__external__' AND callee_module != '__external__'
    """)
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
    cur.execute("""
        SELECT caller_module, callee_module, edge_count FROM module_edges
        WHERE caller_module != '__external__' AND callee_module != '__external__'
        ORDER BY edge_count DESC LIMIT 200
    """)
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


_ENTRYPOINT_NAMES = {
    "main", "setup", "teardown", "configure", "run", "start", "init",
    "handler", "handle", "on_event", "register", "create_app", "app",
    "cli", "command", "callback", "entry", "entrypoint", "wsgi", "asgi",
    "lambda_handler", "index",
}
_FRAMEWORK_PATTERNS = {"test_", "Test", "Spec", "Fixture", "conftest", "setUp", "tearDown"}

def _dead_confidence(node: dict) -> str:
    """
    Return 'safe' | 'review' | 'caution'.
    'safe'    = high confidence actually unused
    'review'  = probably unused but verify
    'caution' = likely a false positive (entrypoint, test hook, public API)
    """
    name = node.get("name", "")
    fp   = node.get("file_path", "") or ""
    kind = node.get("kind", "")

    # Strong false-positive signals → caution
    if name.lower() in _ENTRYPOINT_NAMES:
        return "caution"
    if any(name.startswith(p) or name.endswith(p) for p in _FRAMEWORK_PATTERNS):
        return "caution"
    if any(seg in fp.lower() for seg in ["test", "spec", "fixture", "conftest", "__init__", "setup.py", "manage.py"]):
        return "caution"
    if kind == "class":
        return "caution"   # class deletion almost never safe without checking subclasses

    # Private name → higher confidence
    is_private = name.startswith("_") or name.startswith("__")
    if is_private and (node.get("complexity") or 0) <= 8:
        return "safe"

    return "review"


@app.get("/api/repos/{repo_id}/dead-code")
def dead_code(repo_id: str, limit: int = Query(200, le=1000)):
    """Find nodes with no callers (unreachable), with confidence tiers."""
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

    # Attach confidence tier
    for node in dead:
        node["confidence"] = _dead_confidence(node)

    # Group by file, preserving confidence info
    by_file = defaultdict(list)
    for node in dead:
        by_file[node.get("file_path", "unknown")].append(node)

    file_groups = [
        {
            "file": f,
            "dead_count": len(nodes),
            "safe_count":    sum(1 for n in nodes if n["confidence"] == "safe"),
            "review_count":  sum(1 for n in nodes if n["confidence"] == "review"),
            "caution_count": sum(1 for n in nodes if n["confidence"] == "caution"),
            "nodes": nodes,
        }
        for f, nodes in sorted(by_file.items(), key=lambda x: -len(x[1]))
    ]

    conn.close()
    return {
        "total_dead":    len(dead),
        "safe_count":    sum(1 for n in dead if n["confidence"] == "safe"),
        "review_count":  sum(1 for n in dead if n["confidence"] == "review"),
        "caution_count": sum(1 for n in dead if n["confidence"] == "caution"),
        "file_groups":   file_groups,
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
    """Find strongly connected components (cycles) with break suggestions."""
    conn = get_db(repo_id)
    G = build_nx_graph(conn)
    cur = conn.cursor()

    sccs = [list(scc) for scc in nx.strongly_connected_components(G) if len(scc) > 1]

    result_cycles = []
    for scc in sorted(sccs, key=len, reverse=True)[:20]:
        scc_set = set(scc)
        placeholders = ",".join("?" * len(scc))
        cur.execute(
            f"SELECT hash, name, module, file_path FROM nodes WHERE hash IN ({placeholders})", scc
        )
        nodes_info = {r["hash"]: row_to_dict(r) for r in cur.fetchall()}
        nodes = list(nodes_info.values())

        # Cross-module? (more severe)
        modules_in_cycle = {n.get("module") for n in nodes if n.get("module")}
        cross_module = len(modules_in_cycle) > 1

        # Find break suggestion: the intra-SCC edge with the lowest call_count
        intra_edges = [
            (u, v, d) for u, v, d in G.edges(scc, data=True)
            if v in scc_set
        ]
        break_suggestion = None
        if intra_edges:
            weakest = min(intra_edges, key=lambda e: e[2].get("call_count", 0))
            caller_info = nodes_info.get(weakest[0]) or {}
            callee_info = nodes_info.get(weakest[1]) or {}
            break_suggestion = {
                "caller_hash":   weakest[0],
                "callee_hash":   weakest[1],
                "caller_name":   caller_info.get("name", weakest[0]),
                "callee_name":   callee_info.get("name", weakest[1]),
                "caller_module": caller_info.get("module", ""),
                "callee_module": callee_info.get("module", ""),
                "call_count":    weakest[2].get("call_count", 0),
            }

        result_cycles.append({
            "size":             len(scc),
            "cross_module":     cross_module,
            "modules":          sorted(modules_in_cycle),
            "nodes":            nodes,
            "break_suggestion": break_suggestion,
        })

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
    _ext_filter = "WHERE caller_module != '__external__' AND callee_module != '__external__'"
    cur_a.execute(f"SELECT caller_module, callee_module, edge_count FROM module_edges {_ext_filter}")
    mod_edges_a = {(r["caller_module"], r["callee_module"]): r["edge_count"] for r in cur_a.fetchall()}
    cur_b.execute(f"SELECT caller_module, callee_module, edge_count FROM module_edges {_ext_filter}")
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


@app.post("/api/diff-graph")
def diff_graph(req: DiffRequest, max_context: int = Query(4, le=10), max_nodes: int = Query(120, le=300)):
    """
    Build a visual diff subgraph.
    - Added/removed nodes shown with status
    - Their 1-hop neighbors included as context
    - All edges between any of these nodes tagged added/removed/unchanged
    """
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    cur_a, cur_b = conn_a.cursor(), conn_b.cursor()

    # --- Node identity by (name, module) ----
    def load_nodes(cur):
        cur.execute("SELECT hash, name, module, kind, file_path, caller_count, callee_count FROM nodes WHERE hash NOT LIKE 'ext:%'")
        rows = cur.fetchall()
        by_key = {}
        by_hash = {}
        for r in rows:
            key = (r["name"], r["module"])
            by_key[key] = row_to_dict(r)
            by_hash[r["hash"]] = row_to_dict(r)
        return by_key, by_hash

    nodes_a_by_key, nodes_a_by_hash = load_nodes(cur_a)
    nodes_b_by_key, nodes_b_by_hash = load_nodes(cur_b)

    added_keys = set(nodes_b_by_key) - set(nodes_a_by_key)
    removed_keys = set(nodes_a_by_key) - set(nodes_b_by_key)

    # Virtual node ID: "name::module"  (stable across repos)
    def node_vid(name, module): return f"{name}::{module}"

    changed_vids = {node_vid(k[0], k[1]) for k in added_keys | removed_keys}

    # --- Build adjacency for context lookup ----
    def load_edges(cur):
        cur.execute("SELECT caller_hash, callee_hash FROM edges WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'")
        return cur.fetchall()

    edges_a_rows = load_edges(cur_a)
    edges_b_rows = load_edges(cur_b)

    def adjacency(edge_rows, hash_map):
        callers = defaultdict(set)
        callees = defaultdict(set)
        for e in edge_rows:
            ch, ce = e["caller_hash"], e["callee_hash"]
            if ch not in hash_map or ce not in hash_map:
                continue
            cn = hash_map[ch]
            en = hash_map[ce]
            caller_vid = node_vid(cn["name"], cn["module"])
            callee_vid = node_vid(en["name"], en["module"])
            callers[callee_vid].add(caller_vid)
            callees[caller_vid].add(callee_vid)
        return callers, callees

    callers_a, callees_a = adjacency(edges_a_rows, nodes_a_by_hash)
    callers_b, callees_b = adjacency(edges_b_rows, nodes_b_by_hash)

    # Build a unified node lookup vid → node info (prefer B for added, A for removed)
    all_node_info = {}
    for key, node in nodes_b_by_key.items():
        all_node_info[node_vid(key[0], key[1])] = node
    for key, node in nodes_a_by_key.items():
        vid = node_vid(key[0], key[1])
        if vid not in all_node_info:
            all_node_info[vid] = node

    # --- Collect context nodes ----
    context_vids = set()
    def top_neighbors(vid_set, adj_map, n):
        """Get top-n neighbors by caller_count for a set of VIDs."""
        neighbors = set()
        for vid in vid_set:
            nbrs = list(adj_map.get(vid, set()))
            nbrs_info = [(n2, all_node_info.get(n2, {}).get("caller_count", 0)) for n2 in nbrs]
            nbrs_info.sort(key=lambda x: -x[1])
            for n2, _ in nbrs_info[:max_context]:
                if n2 not in changed_vids:
                    neighbors.add(n2)
        return neighbors

    added_vids = {node_vid(k[0], k[1]) for k in added_keys}
    removed_vids = {node_vid(k[0], k[1]) for k in removed_keys}

    # Context: who calls new code + what new code calls (from B)
    context_vids |= top_neighbors(added_vids, callers_b, max_context)
    context_vids |= top_neighbors(added_vids, callees_b, max_context)
    # Context: who was calling removed code + what removed code called (from A)
    context_vids |= top_neighbors(removed_vids, callers_a, max_context)
    context_vids |= top_neighbors(removed_vids, callees_a, max_context)

    all_vids = added_vids | removed_vids | context_vids
    # Cap total nodes
    if len(all_vids) > max_nodes:
        # Keep changed nodes always; trim context
        ctx_sorted = sorted(context_vids, key=lambda v: -all_node_info.get(v, {}).get("caller_count", 0))
        context_vids = set(ctx_sorted[:max_nodes - len(changed_vids)])
        all_vids = added_vids | removed_vids | context_vids

    # --- Build edge set (vid pairs) ----
    def edge_vids(edge_rows, hash_map):
        result = set()
        for e in edge_rows:
            ch, ce = e["caller_hash"], e["callee_hash"]
            if ch not in hash_map or ce not in hash_map:
                continue
            cn, en = hash_map[ch], hash_map[ce]
            cv, ev = node_vid(cn["name"], cn["module"]), node_vid(en["name"], en["module"])
            if cv in all_vids and ev in all_vids:
                result.add((cv, ev))
        return result

    ev_a = edge_vids(edges_a_rows, nodes_a_by_hash)
    ev_b = edge_vids(edges_b_rows, nodes_b_by_hash)

    edge_added   = ev_b - ev_a
    edge_removed = ev_a - ev_b
    edge_same    = ev_a & ev_b

    # --- Serialize ----
    def status(vid):
        if vid in added_vids:   return "added"
        if vid in removed_vids: return "removed"
        return "context"

    nodes_out = []
    for vid in all_vids:
        info = all_node_info.get(vid, {})
        nodes_out.append({
            "id": vid,
            "name": info.get("name", vid.split("::")[0]),
            "module": info.get("module", ""),
            "kind": info.get("kind", ""),
            "caller_count": info.get("caller_count", 0),
            "status": status(vid),
        })

    edges_out = []
    for src, tgt in edge_added:
        edges_out.append({"source": src, "target": tgt, "status": "added"})
    for src, tgt in edge_removed:
        edges_out.append({"source": src, "target": tgt, "status": "removed"})
    for src, tgt in edge_same:
        edges_out.append({"source": src, "target": tgt, "status": "unchanged"})

    # --- GitHub compare link ----
    def repo_base(rid): return rid.split("@")[0]
    def repo_sha(rid):
        parts = rid.split("@")
        return parts[1] if len(parts) > 1 else "HEAD"

    github_url = None
    base_a, base_b = repo_base(req.repo_a), repo_base(req.repo_b)
    if base_a == base_b:
        meta_path = DATA_DIR / f"{base_a}.meta.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            gh = meta.get("github_url", "").rstrip("/")
            if gh:
                sha_a = repo_sha(req.repo_a)
                sha_b = repo_sha(req.repo_b)
                github_url = f"{gh}/compare/{sha_a}...{sha_b}"

    conn_a.close()
    conn_b.close()
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "stats": {
            "added": len(added_vids),
            "removed": len(removed_vids),
            "context": len(context_vids),
            "edge_added": len(edge_added),
            "edge_removed": len(edge_removed),
            "edge_unchanged": len(edge_same),
        },
        "github_compare_url": github_url,
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


# ── Load-bearing config endpoints ──────────────────────────────────────────

@app.get("/api/repos/{repo_id}/load-bearing/config")
def get_lb_config(repo_id: str):
    return read_lb_config(repo_id)


class LBDeclareRequest(BaseModel):
    hash: Optional[str] = None       # declare a specific node
    module: Optional[str] = None     # declare an entire module
    remove: bool = False             # if true, undeclare instead


@app.post("/api/repos/{repo_id}/load-bearing/declare")
def declare_lb(repo_id: str, req: LBDeclareRequest):
    config = read_lb_config(repo_id)
    if req.hash:
        if req.remove:
            config["declared_nodes"] = [h for h in config["declared_nodes"] if h != req.hash]
        elif req.hash not in config["declared_nodes"]:
            config["declared_nodes"].append(req.hash)
    if req.module:
        if req.remove:
            config["declared_modules"] = [m for m in config["declared_modules"] if m != req.module]
        elif req.module not in config["declared_modules"]:
            config["declared_modules"].append(req.module)
    write_lb_config(repo_id, config)
    return {"ok": True, "config": config}


@app.get("/api/repos/{repo_id}/load-bearing")
def load_bearing_analysis(repo_id: str, threshold: int = Query(3, le=50)):
    """
    Detect load-bearing nodes using both explicit config + heuristics.
    Returns declared, unexpected, and candidate nodes.
    """
    conn = get_db(repo_id)
    cur = conn.cursor()
    config = read_lb_config(repo_id)
    declared_hashes = set(config.get("declared_nodes", []))
    declared_modules = set(config.get("declared_modules", []))

    # Heuristic keyword modules (auto-detect)
    lb_keywords = {"core", "platform", "base", "shared", "common", "infra", "lib", "utils",
                   "foundation", "primitives", "runtime", "framework", "kernel"}

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
        LIMIT 100
    """, (threshold,))
    high_centrality = [row_to_dict(r) for r in cur.fetchall()]

    declared = []
    unexpected = []
    for node in high_centrality:
        h = node["hash"]
        mod = (node.get("module") or "").lower()
        mod_parts = set(mod.replace(".", "/").replace("-", "/").split("/"))
        explicitly_declared = h in declared_hashes or any(
            m in mod for m in declared_modules
        )
        auto_lb = bool(mod_parts & lb_keywords)

        if explicitly_declared or auto_lb:
            node["declaration"] = "explicit" if explicitly_declared else "auto"
            declared.append(node)
        else:
            unexpected.append(node)

    conn.close()
    return {
        "declared_load_bearing": declared,
        "unexpected_load_bearing": unexpected,
        "threshold_modules": threshold,
        "config": config,
    }


@app.get("/api/repos/{repo_id}/building")
def building_view(repo_id: str, max_nodes: int = Query(120, le=300)):
    """
    Compute a structural 'building' layout for visualization.
    - Layers are determined by topological depth (0 = foundation, N = leaf)
    - Returns nodes with layer assignments + load-bearing status
    """
    conn = get_db(repo_id)
    cur = conn.cursor()
    config = read_lb_config(repo_id)
    declared_hashes = set(config.get("declared_nodes", []))
    declared_modules = set(config.get("declared_modules", []))
    lb_keywords = {"core", "platform", "base", "shared", "common", "infra", "lib", "utils",
                   "foundation", "primitives", "runtime", "framework", "kernel"}

    # Get top nodes by caller_count (most impactful subset)
    cur.execute("""
        SELECT hash, name, module, file_path, caller_count, callee_count, complexity, risk
        FROM nodes
        WHERE hash NOT LIKE 'ext:%'
        ORDER BY caller_count DESC
        LIMIT ?
    """, (max_nodes,))
    nodes = {r["hash"]: row_to_dict(r) for r in cur.fetchall()}

    # Get edges within this node set
    if nodes:
        ph = ",".join("?" * len(nodes))
        cur.execute(
            f"SELECT caller_hash, callee_hash FROM edges WHERE caller_hash IN ({ph}) AND callee_hash IN ({ph}) AND callee_hash NOT LIKE 'ext:%'",
            list(nodes.keys()) * 2
        )
        edges = cur.fetchall()
    else:
        edges = []

    # Compute in-degree for layer assignment
    in_degree = defaultdict(int)
    out_neighbors = defaultdict(list)
    in_neighbors = defaultdict(list)
    for e in edges:
        caller, callee = e["caller_hash"], e["callee_hash"]
        out_neighbors[caller].append(callee)
        in_neighbors[callee].append(caller)
        in_degree[callee] += 1

    # BFS topological layering: nodes with no callers = top layer (features)
    # Nodes with most callers = bottom layer (foundation)
    # We reverse: layer 0 = highest caller_count (foundation)
    max_callers = max((n["caller_count"] for n in nodes.values()), default=1)

    for h, node in nodes.items():
        mod = (node.get("module") or "").lower()
        mod_parts = set(mod.replace(".", "/").replace("-", "/").split("/"))
        explicitly_declared = h in declared_hashes or any(m in mod for m in declared_modules)
        auto_lb = bool(mod_parts & lb_keywords)
        node["is_load_bearing"] = explicitly_declared or auto_lb
        node["declaration"] = "explicit" if explicitly_declared else ("auto" if auto_lb else "none")

        # Layer: 0-4 based on caller_count percentile
        pct = node["caller_count"] / max_callers if max_callers > 0 else 0
        if pct > 0.6:
            node["layer"] = 0  # foundation
        elif pct > 0.3:
            node["layer"] = 1  # platform
        elif pct > 0.1:
            node["layer"] = 2  # services
        elif pct > 0.02:
            node["layer"] = 3  # features
        else:
            node["layer"] = 4  # leaves

    conn.close()
    return {
        "nodes": list(nodes.values()),
        "edges": [{"from": e["caller_hash"], "to": e["callee_hash"]} for e in edges],
        "layer_labels": ["Foundation", "Platform", "Services", "Features", "Leaves"],
    }


@app.get("/api/repos/{repo_id}/module-graph")
def module_graph(repo_id: str, depth: int = Query(2, ge=1, le=6)):
    """
    Force-graph at the module level.
    Roll up path-derived module names to `depth` path segments.
    e.g., depth=2: "backend.sandbox.docker" → "backend.sandbox"
    """
    conn = get_db(repo_id)
    cur = conn.cursor()

    def rollup(module, d):
        if not module:
            return "__unknown__"
        if module.startswith("__"):
            return module
        parts = module.replace("/", ".").split(".")
        return ".".join(parts[:d])

    # Aggregate node stats to rolled-up module names
    cur.execute("""
        SELECT module, COUNT(*) AS symbol_count,
               COALESCE(SUM(complexity), 0) AS total_complexity
        FROM nodes WHERE hash NOT LIKE 'ext:%' AND module IS NOT NULL
        GROUP BY module
    """)
    rolled_stats: dict = {}
    for r in cur.fetchall():
        rolled = rollup(r["module"], depth)
        if rolled not in rolled_stats:
            rolled_stats[rolled] = {"symbol_count": 0, "complexity": 0, "submodules": set()}
        rolled_stats[rolled]["symbol_count"] += r["symbol_count"]
        rolled_stats[rolled]["complexity"] += r["total_complexity"]
        if r["module"] != rolled:
            rolled_stats[rolled]["submodules"].add(r["module"])

    # Roll up module_edges (exclude __external__ — not a real internal module)
    cur.execute("""
        SELECT caller_module, callee_module, edge_count FROM module_edges
        WHERE caller_module != '__external__' AND callee_module != '__external__'
    """)
    edge_map: dict = {}
    intra: dict = {}
    for r in cur.fetchall():
        src = rollup(r["caller_module"], depth)
        dst = rollup(r["callee_module"], depth)
        if src == dst:
            intra[src] = intra.get(src, 0) + r["edge_count"]
            continue
        if dst.startswith("__") or src.startswith("__"):
            continue
        key = (src, dst)
        edge_map[key] = edge_map.get(key, 0) + r["edge_count"]

    # Coupling metrics per rolled module
    afferent: dict = {}
    efferent: dict = {}
    for (src, dst), cnt in edge_map.items():
        efferent[src] = efferent.get(src, 0) + cnt
        afferent[dst] = afferent.get(dst, 0) + cnt

    valid_ids = {m for m in rolled_stats if not m.startswith("__")}
    nodes_out = []
    for mod in valid_ids:
        stats = rolled_stats[mod]
        ca = afferent.get(mod, 0)
        ce = efferent.get(mod, 0)
        instability = ce / (ca + ce) if (ca + ce) > 0 else 0.5
        nodes_out.append({
            "id": mod,
            "label": mod.split(".")[-1],
            "full_name": mod,
            "symbol_count": stats["symbol_count"],
            "complexity": stats["complexity"],
            "afferent": ca,
            "efferent": ce,
            "instability": round(instability, 3),
            "intra_calls": intra.get(mod, 0),
            "submodule_count": len(stats["submodules"]),
        })

    max_edge = max((v for v in edge_map.values()), default=1)
    edges_out = [
        {"from": k[0], "to": k[1], "count": v, "weight": round(v / max_edge, 3)}
        for k, v in edge_map.items()
        if k[0] in valid_ids and k[1] in valid_ids
    ]

    # Determine available depths (how many unique path segments exist)
    cur.execute("SELECT DISTINCT module FROM nodes WHERE hash NOT LIKE 'ext:%' AND module IS NOT NULL")
    all_modules = [r["module"] for r in cur.fetchall()]
    max_meaningful_depth = max(
        (len(m.replace("/", ".").split(".")) for m in all_modules if not m.startswith("__")),
        default=1
    )

    conn.close()
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "depth": depth,
        "max_depth": min(max_meaningful_depth, 6),
    }


@app.get("/api/repos/{repo_id}/communities")
def detect_communities(repo_id: str, resolution: float = Query(1.0, ge=0.1, le=5.0)):
    """
    Louvain community detection on the symbol call graph.
    Returns inferred clusters, alignment score vs declared modules,
    inter-community edges, and misaligned symbols.
    """
    from networkx.algorithms.community import louvain_communities

    conn = get_db(repo_id)
    cur = conn.cursor()

    cur.execute("""
        SELECT hash, name, module, file_path
        FROM nodes WHERE hash NOT LIKE 'ext:%'
    """)
    nodes_data: dict = {}
    for r in cur.fetchall():
        nodes_data[r["hash"]] = {
            "name": r["name"],
            "module": r["module"] or "__unknown__",
            "file_path": r["file_path"] or "",
        }

    if not nodes_data:
        conn.close()
        return {"communities": [], "community_edges": [], "misaligned": [],
                "alignment_score": 0, "total_nodes": 0, "community_count": 0}

    # Build undirected weighted graph for Louvain
    G = nx.Graph()
    for h in nodes_data:
        G.add_node(h)

    cur.execute("""
        SELECT caller_hash, callee_hash, COUNT(*) AS w
        FROM edges WHERE callee_hash NOT LIKE 'ext:%'
        GROUP BY caller_hash, callee_hash
    """)
    for r in cur.fetchall():
        ch, cah = r["caller_hash"], r["callee_hash"]
        if ch in nodes_data and cah in nodes_data:
            if G.has_edge(ch, cah):
                G[ch][cah]["weight"] += r["w"]
            else:
                G.add_edge(ch, cah, weight=r["w"])

    # Run Louvain (seed for reproducibility)
    community_sets = louvain_communities(G, resolution=resolution, seed=42)

    hash_to_comm: dict = {}
    for i, comm in enumerate(community_sets):
        for h in comm:
            hash_to_comm[h] = i

    # Per-community: module distribution
    comm_module_counts: dict = {}
    for h, comm_id in hash_to_comm.items():
        mod = nodes_data[h]["module"]
        if comm_id not in comm_module_counts:
            comm_module_counts[comm_id] = {}
        comm_module_counts[comm_id][mod] = comm_module_counts[comm_id].get(mod, 0) + 1

    # Inter-community edge counts (for meta-graph)
    comm_edges: dict = {}
    for u, v, data in G.edges(data=True):
        cu, cv = hash_to_comm.get(u, -1), hash_to_comm.get(v, -1)
        if cu == cv or cu == -1 or cv == -1:
            continue
        key = (min(cu, cv), max(cu, cv))
        comm_edges[key] = comm_edges.get(key, 0) + data.get("weight", 1)

    # Drop singleton communities — a lone node isn't a community
    singleton_comm_ids = {
        comm_id for comm_id, mod_counts in comm_module_counts.items()
        if sum(mod_counts.values()) <= 1
    }
    comm_module_counts = {k: v for k, v in comm_module_counts.items() if k not in singleton_comm_ids}
    valid_hashes = {h for h, c in hash_to_comm.items() if c not in singleton_comm_ids}

    communities_out = []
    for comm_id, mod_counts in comm_module_counts.items():
        total = sum(mod_counts.values())
        sorted_mods = sorted(mod_counts.items(), key=lambda x: -x[1])
        top_mod, top_cnt = sorted_mods[0]
        purity = top_cnt / total
        communities_out.append({
            "id": comm_id,
            "size": total,
            "dominant_module": top_mod,
            "purity": round(purity, 3),
            "top_modules": dict(sorted_mods[:6]),
        })
    communities_out.sort(key=lambda x: -x["size"])

    # Drop edges that touch a singleton community
    max_comm_edge = max(comm_edges.values(), default=1)
    community_edges_out = [
        {"from": k[0], "to": k[1], "count": v, "weight": round(v / max_comm_edge, 3)}
        for k, v in comm_edges.items()
        if k[0] not in singleton_comm_ids and k[1] not in singleton_comm_ids
    ]

    # Misaligned: declared module ≠ community's dominant module (only high-purity communities)
    misaligned = []
    for h in valid_hashes:
        comm_id = hash_to_comm[h]
        nd = nodes_data[h]
        comm_mods = comm_module_counts[comm_id]
        dominant_mod = max(comm_mods, key=comm_mods.get)
        purity = comm_mods[dominant_mod] / sum(comm_mods.values())
        if nd["module"] != dominant_mod and purity >= 0.5:
            misaligned.append({
                "hash": h,
                "name": nd["name"],
                "declared_module": nd["module"],
                "inferred_module": dominant_mod,
                "community_id": comm_id,
                "file_path": nd["file_path"],
            })
    misaligned.sort(key=lambda x: (x["declared_module"], x["name"]))

    # Alignment score only counts non-singleton nodes
    aligned = sum(
        1 for h in valid_hashes
        if nodes_data[h]["module"] == max(comm_module_counts[hash_to_comm[h]], key=comm_module_counts[hash_to_comm[h]].get)
    )
    alignment_score = aligned / len(valid_hashes) if valid_hashes else 0.0

    conn.close()
    return {
        "communities": communities_out,
        "community_edges": community_edges_out,
        "misaligned": misaligned[:200],
        "alignment_score": round(alignment_score, 3),
        "total_nodes": len(valid_hashes),
        "community_count": len(communities_out),
    }


@app.post("/api/diff-building")
def diff_building(req: DiffRequest, max_nodes: int = Query(120, le=300)):
    """
    Building view showing structural diff — added/removed/common nodes with layer assignments.
    """
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    cur_a, cur_b = conn_a.cursor(), conn_b.cursor()
    config = read_lb_config(req.repo_b.split("@")[0])
    declared_hashes = set(config.get("declared_nodes", []))
    declared_modules = set(config.get("declared_modules", []))
    lb_keywords = {"core", "platform", "base", "shared", "common", "infra", "lib", "utils",
                   "foundation", "primitives", "runtime", "framework", "kernel"}

    def load_building_nodes(cur, limit):
        cur.execute("""
            SELECT hash, name, module, file_path, caller_count, callee_count, complexity, risk
            FROM nodes WHERE hash NOT LIKE 'ext:%'
            ORDER BY caller_count DESC LIMIT ?
        """, (limit,))
        return {r["hash"]: row_to_dict(r) for r in cur.fetchall()}

    nodes_a = load_building_nodes(cur_a, max_nodes)
    nodes_b = load_building_nodes(cur_b, max_nodes)

    # Build identity map: (name, module) -> node
    def keyed(node_map):
        return {(n["name"], n["module"]): n for n in node_map.values()}

    keyed_a = keyed(nodes_a)
    keyed_b = keyed(nodes_b)
    keys_a, keys_b = set(keyed_a), set(keyed_b)

    added_keys   = keys_b - keys_a
    removed_keys = keys_a - keys_b
    common_keys  = keys_a & keys_b

    max_callers_b = max((n["caller_count"] for n in nodes_b.values()), default=1)
    max_callers_a = max((n["caller_count"] for n in nodes_a.values()), default=1)

    def assign_layer(node, max_c):
        pct = node["caller_count"] / max_c if max_c > 0 else 0
        if pct > 0.6: return 0
        if pct > 0.3: return 1
        if pct > 0.1: return 2
        if pct > 0.02: return 3
        return 4

    def classify_lb(node):
        mod = (node.get("module") or "").lower()
        mod_parts = set(mod.replace(".", "/").replace("-", "/").split("/"))
        h = node.get("hash", "")
        explicitly = h in declared_hashes or any(m in mod for m in declared_modules)
        auto = bool(mod_parts & lb_keywords)
        return explicitly or auto, "explicit" if explicitly else ("auto" if auto else "none")

    out_nodes = []

    for key in added_keys:
        n = dict(keyed_b[key])
        n["layer"] = assign_layer(n, max_callers_b)
        n["diff_status"] = "added"
        is_lb, decl = classify_lb(n)
        n["is_load_bearing"] = is_lb
        n["declaration"] = decl
        n["calling_module_count"] = 0
        out_nodes.append(n)

    for key in removed_keys:
        n = dict(keyed_a[key])
        n["layer"] = assign_layer(n, max_callers_a)
        n["diff_status"] = "removed"
        is_lb, decl = classify_lb(n)
        n["is_load_bearing"] = is_lb
        n["declaration"] = decl
        n["calling_module_count"] = 0
        out_nodes.append(n)

    for key in common_keys:
        n = dict(keyed_b[key])
        n["layer"] = assign_layer(n, max_callers_b)
        n["diff_status"] = "common"
        is_lb, decl = classify_lb(n)
        n["is_load_bearing"] = is_lb
        n["declaration"] = decl
        n["calling_module_count"] = 0
        out_nodes.append(n)

    # Edges: load from both repos so removed nodes have their connections too
    added_hashes   = {keyed_b[k]["hash"] for k in added_keys}
    removed_hashes = {keyed_a[k]["hash"] for k in removed_keys}
    common_hashes  = {keyed_b[k]["hash"] for k in common_keys}
    all_b_hashes   = added_hashes | common_hashes

    edges_out = []

    # Added-node edges (and added↔common) from repo B
    if added_hashes:
        ph_added = ",".join("?" * len(added_hashes))
        ph_all_b = ",".join("?" * len(all_b_hashes))
        cur_b.execute(
            f"""SELECT caller_hash, callee_hash FROM edges
                WHERE callee_hash NOT LIKE 'ext:%'
                  AND (caller_hash IN ({ph_added}) OR callee_hash IN ({ph_added}))
                  AND caller_hash IN ({ph_all_b})
                  AND callee_hash IN ({ph_all_b})""",
            list(added_hashes) + list(added_hashes) + list(all_b_hashes) + list(all_b_hashes)
        )
        edges_out.extend(
            {"from": e["caller_hash"], "to": e["callee_hash"], "diff_status": "added"}
            for e in cur_b.fetchall()
        )

    # Removed-node edges from repo A
    if removed_hashes:
        all_a_hashes = removed_hashes | {keyed_a[k]["hash"] for k in common_keys}
        ph_removed = ",".join("?" * len(removed_hashes))
        ph_all_a   = ",".join("?" * len(all_a_hashes))
        cur_a.execute(
            f"""SELECT caller_hash, callee_hash FROM edges
                WHERE callee_hash NOT LIKE 'ext:%'
                  AND (caller_hash IN ({ph_removed}) OR callee_hash IN ({ph_removed}))
                  AND caller_hash IN ({ph_all_a})
                  AND callee_hash IN ({ph_all_a})""",
            list(removed_hashes) + list(removed_hashes) + list(all_a_hashes) + list(all_a_hashes)
        )
        edges_out.extend(
            {"from": e["caller_hash"], "to": e["callee_hash"], "diff_status": "removed"}
            for e in cur_a.fetchall()
        )

    conn_a.close()
    conn_b.close()

    return {
        "nodes": out_nodes,
        "edges": edges_out,
        "stats": {
            "added": len(added_keys),
            "removed": len(removed_keys),
            "common": len(common_keys),
        },
        "layer_labels": ["Foundation", "Platform", "Services", "Features", "Leaves"],
    }


# ── Serve React frontend (must be last) ────────────────────────────────────

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve React SPA — return index.html for all non-API routes."""
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)
