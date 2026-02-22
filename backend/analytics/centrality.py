"""
Centrality and blast-radius analysis — pure functions only.
"""
from __future__ import annotations

from collections import deque

import networkx as nx


def compute_centrality(nodes: list[dict], edges: list[dict], top_n: int = 30) -> list[dict]:
    """
    Rank nodes by centrality score.

    For graphs with >2000 nodes, uses in-degree as a fast proxy.
    For smaller graphs, uses betweenness centrality.

    nodes  — list of dicts: {hash, name, module, file_path, caller_count, callee_count, risk}
    edges  — list of dicts: {caller_hash, callee_hash, call_count}
    """
    G = nx.DiGraph()
    node_map = {n["hash"]: n for n in nodes}
    for n in nodes:
        G.add_node(n["hash"])
    for e in edges:
        G.add_edge(e["caller_hash"], e["callee_hash"], call_count=e.get("call_count", 1))

    if len(G.nodes) > 2000:
        scores = dict(G.in_degree())
        max_score = max(scores.values(), default=1) or 1
        centrality_scores = {k: v / max_score for k, v in scores.items()}
    else:
        centrality_scores = nx.betweenness_centrality(G, normalized=True)

    top_hashes = sorted(centrality_scores, key=lambda h: centrality_scores[h], reverse=True)[:top_n]

    results = []
    for h in top_hashes:
        if h not in node_map:
            continue
        node = dict(node_map[h])
        node["centrality"] = round(centrality_scores.get(h, 0), 4)
        results.append(node)

    results.sort(key=lambda x: x["centrality"], reverse=True)
    return results


def compute_blast_radius(
    target_hash: str,
    target_node: dict,
    reverse_adj: dict[str, list[str]],
    all_nodes: dict[str, dict],
    max_depth: int = 5,
) -> dict:
    """
    BFS upstream from target to find everything affected by a change to target.

    target_hash  — hash of the node being changed
    target_node  — full node dict for the target
    reverse_adj  — {callee_hash: [caller_hash, ...]} — pre-built reverse adjacency
    all_nodes    — {hash: node_dict} for all non-external nodes
    max_depth    — how many hops upstream to traverse
    """
    visited: dict[str, int] = {}  # hash -> depth
    queue = deque([(target_hash, 0)])

    while queue:
        current, depth = queue.popleft()
        if current in visited or depth > max_depth:
            continue
        visited[current] = depth
        if depth < max_depth:
            for caller in reverse_adj.get(current, []):
                if caller not in visited:
                    queue.append((caller, depth + 1))

    affected_nodes = []
    for h, depth in visited.items():
        if h == target_hash:
            continue
        node = all_nodes.get(h)
        if node:
            n = dict(node)
            n["depth"] = depth
            affected_nodes.append(n)

    modules_affected = list({n.get("module") for n in affected_nodes if n.get("module")})

    return {
        "target":           target_node,
        "affected_count":   len(affected_nodes),
        "affected_nodes":   sorted(affected_nodes, key=lambda x: x["depth"]),
        "modules_affected": modules_affected,
        "max_depth_reached": max_depth,
    }
