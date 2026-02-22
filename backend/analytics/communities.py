"""
Louvain community detection — pure functions only.
"""
from __future__ import annotations

import networkx as nx
from networkx.algorithms.community import louvain_communities


def detect_communities(
    nodes: list[dict],
    edges: list[dict],
    resolution: float = 1.0,
) -> dict:
    """
    Run Louvain community detection on the call graph.

    nodes  — list of dicts: {hash, name, module, file_path}
    edges  — list of dicts: {caller_hash, callee_hash, weight}
    Returns communities with purity scores, inter-community edges, and misaligned nodes.
    """
    if not nodes:
        return {
            "communities": [], "community_edges": [], "misaligned": [],
            "alignment_score": 0, "total_nodes": 0, "community_count": 0,
        }

    node_map = {n["hash"]: n for n in nodes}
    G = nx.Graph()
    for n in nodes:
        G.add_node(n["hash"])
    for e in edges:
        ch, cah, w = e["caller_hash"], e["callee_hash"], e.get("weight", 1)
        if ch in node_map and cah in node_map:
            if G.has_edge(ch, cah):
                G[ch][cah]["weight"] += w
            else:
                G.add_edge(ch, cah, weight=w)

    community_sets = louvain_communities(G, resolution=resolution, seed=42)

    hash_to_comm: dict[str, int] = {}
    for i, comm in enumerate(community_sets):
        for h in comm:
            hash_to_comm[h] = i

    # Per-community module distribution
    comm_module_counts: dict[int, dict[str, int]] = {}
    for h, cid in hash_to_comm.items():
        mod = node_map[h].get("module", "__unknown__")
        comm_module_counts.setdefault(cid, {})[mod] = \
            comm_module_counts.get(cid, {}).get(mod, 0) + 1

    # Drop singletons
    singleton_ids = {
        cid for cid, mc in comm_module_counts.items()
        if sum(mc.values()) <= 1
    }
    comm_module_counts = {k: v for k, v in comm_module_counts.items() if k not in singleton_ids}
    valid_hashes = {h for h, c in hash_to_comm.items() if c not in singleton_ids}

    # Inter-community edges
    comm_edges: dict[tuple, int] = {}
    for u, v, data in G.edges(data=True):
        cu, cv = hash_to_comm.get(u, -1), hash_to_comm.get(v, -1)
        if cu == cv or cu == -1 or cv == -1:
            continue
        if cu in singleton_ids or cv in singleton_ids:
            continue
        key = (min(cu, cv), max(cu, cv))
        comm_edges[key] = comm_edges.get(key, 0) + data.get("weight", 1)

    max_ce = max(comm_edges.values(), default=1)
    community_edges_out = [
        {"from": k[0], "to": k[1], "count": v, "weight": round(v / max_ce, 3)}
        for k, v in comm_edges.items()
    ]

    communities_out = []
    for cid, mc in comm_module_counts.items():
        total = sum(mc.values())
        sorted_mods = sorted(mc.items(), key=lambda x: -x[1])
        top_mod, top_cnt = sorted_mods[0]
        communities_out.append({
            "id":               cid,
            "size":             total,
            "dominant_module":  top_mod,
            "purity":           round(top_cnt / total, 3),
            "top_modules":      dict(sorted_mods[:6]),
        })
    communities_out.sort(key=lambda x: -x["size"])

    # Misaligned nodes
    misaligned = []
    for h in valid_hashes:
        cid  = hash_to_comm[h]
        nd   = node_map[h]
        mc   = comm_module_counts[cid]
        dom  = max(mc, key=mc.get)
        purity = mc[dom] / sum(mc.values())
        if nd.get("module") != dom and purity >= 0.5:
            misaligned.append({
                "hash":             h,
                "name":             nd.get("name", ""),
                "declared_module":  nd.get("module", ""),
                "inferred_module":  dom,
                "community_id":     cid,
                "file_path":        nd.get("file_path", ""),
            })
    misaligned.sort(key=lambda x: (x["declared_module"], x["name"]))

    aligned = sum(
        1 for h in valid_hashes
        if node_map[h].get("module") == max(
            comm_module_counts[hash_to_comm[h]], key=comm_module_counts[hash_to_comm[h]].get
        )
    )
    alignment_score = aligned / len(valid_hashes) if valid_hashes else 0.0

    return {
        "communities":     communities_out,
        "community_edges": community_edges_out,
        "misaligned":      misaligned[:200],
        "alignment_score": round(alignment_score, 3),
        "total_nodes":     len(valid_hashes),
        "community_count": len(communities_out),
    }
