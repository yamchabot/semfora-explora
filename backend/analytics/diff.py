"""
Graph diff analysis — pure functions only.

Compares two snapshots of a repo's call graph to identify
structural changes (added/removed nodes and module edges).
"""
from __future__ import annotations

from collections import defaultdict


def compute_diff(
    nodes_a: list[dict],
    nodes_b: list[dict],
    mod_edges_a: list[dict],
    mod_edges_b: list[dict],
) -> dict:
    """
    High-level structural diff between two repo snapshots.

    Nodes are matched by (name, module) since hashes differ between snapshots.
    """
    def key(n): return (n["name"], n["module"])

    ka = {key(n): n for n in nodes_a}
    kb = {key(n): n for n in nodes_b}
    keys_a, keys_b = set(ka), set(kb)

    added   = [kb[k] for k in keys_b - keys_a]
    removed = [ka[k] for k in keys_a - keys_b]
    common  = keys_a & keys_b

    def edge_key(e): return (e["caller_module"], e["callee_module"])
    mea = {edge_key(e): e["edge_count"] for e in mod_edges_a}
    meb = {edge_key(e): e["edge_count"] for e in mod_edges_b}

    new_mod_edges     = [{"from": k[0], "to": k[1], "count": meb[k]} for k in set(meb) - set(mea)]
    removed_mod_edges = [{"from": k[0], "to": k[1], "count": mea[k]} for k in set(mea) - set(meb)]

    similarity = len(common) / max(len(keys_a | keys_b), 1)

    return {
        "similarity":           round(similarity, 3),
        "nodes_added":          len(added),
        "nodes_removed":        len(removed),
        "nodes_common":         len(common),
        "added":                added[:50],
        "removed":              removed[:50],
        "module_edges_added":   new_mod_edges[:30],
        "module_edges_removed": removed_mod_edges[:30],
    }


def compute_diff_graph(
    nodes_a: list[dict],
    nodes_b: list[dict],
    edges_a: list[dict],
    edges_b: list[dict],
    max_context: int = 4,
    max_nodes: int = 120,
) -> dict:
    """
    Build a force-graph subgraph showing the structural diff.

    Nodes are identified by virtual ID "name::module" (stable across snapshots).
    Added/removed nodes are shown with their neighborhood as context.
    """
    def vid(name, module): return f"{name}::{module}"

    def keyed_by_vid(node_list):
        by_vid  = {}
        by_hash = {}
        for n in node_list:
            v = vid(n["name"], n["module"])
            by_vid[v]          = n
            by_hash[n["hash"]] = n
        return by_vid, by_hash

    bv_a, bh_a = keyed_by_vid(nodes_a)
    bv_b, bh_b = keyed_by_vid(nodes_b)

    added_vids    = set(bv_b) - set(bv_a)
    removed_vids  = set(bv_a) - set(bv_b)
    common_vids   = set(bv_a) & set(bv_b)
    modified_vids = {v for v in common_vids if bv_a[v]["hash"] != bv_b[v]["hash"]}
    changed_vids  = added_vids | removed_vids | modified_vids

    # Unified node lookup (prefer B for added/modified, A for removed)
    all_info = {**{v: n for v, n in bv_a.items()}, **{v: n for v, n in bv_b.items()}}

    def adjacency(edges, hash_map):
        callers: dict[str, set] = defaultdict(set)
        callees: dict[str, set] = defaultdict(set)
        for e in edges:
            ch, ce = e["caller_hash"], e["callee_hash"]
            if ch not in hash_map or ce not in hash_map:
                continue
            cv = vid(hash_map[ch]["name"], hash_map[ch]["module"])
            ev = vid(hash_map[ce]["name"], hash_map[ce]["module"])
            callers[ev].add(cv)
            callees[cv].add(ev)
        return callers, callees

    cal_a, cee_a = adjacency(edges_a, bh_a)
    cal_b, cee_b = adjacency(edges_b, bh_b)

    def top_neighbors(vids, adj, n):
        nbrs = set()
        for v in vids:
            candidates = sorted(
                adj.get(v, set()),
                key=lambda x: -all_info.get(x, {}).get("caller_count", 0),
            )
            for nb in candidates[:n]:
                if nb not in changed_vids:
                    nbrs.add(nb)
        return nbrs

    context = set()
    context |= top_neighbors(added_vids,    cal_b, max_context)
    context |= top_neighbors(added_vids,    cee_b, max_context)
    context |= top_neighbors(removed_vids,  cal_a, max_context)
    context |= top_neighbors(removed_vids,  cee_a, max_context)
    context |= top_neighbors(modified_vids, cal_b, max_context // 2 + 1)
    context |= top_neighbors(modified_vids, cee_b, max_context // 2 + 1)

    all_vids = added_vids | removed_vids | modified_vids | context
    if len(all_vids) > max_nodes:
        ctx_sorted = sorted(context, key=lambda v: -all_info.get(v, {}).get("caller_count", 0))
        context = set(ctx_sorted[:max(0, max_nodes - len(changed_vids))])
        all_vids = added_vids | removed_vids | modified_vids | context

    def status(v):
        if v in added_vids:    return "added"
        if v in removed_vids:  return "removed"
        if v in modified_vids: return "modified"
        return "context"

    def edge_vids_set(edges, hash_map):
        result = set()
        for e in edges:
            ch, ce = e["caller_hash"], e["callee_hash"]
            if ch not in hash_map or ce not in hash_map:
                continue
            cv = vid(hash_map[ch]["name"], hash_map[ch]["module"])
            ev = vid(hash_map[ce]["name"], hash_map[ce]["module"])
            if cv in all_vids and ev in all_vids:
                result.add((cv, ev))
        return result

    ev_a = edge_vids_set(edges_a, bh_a)
    ev_b = edge_vids_set(edges_b, bh_b)

    nodes_out = [
        {
            "id":           v,
            "name":         all_info.get(v, {}).get("name", v.split("::")[0]),
            "module":       all_info.get(v, {}).get("module", ""),
            "kind":         all_info.get(v, {}).get("kind", ""),
            "caller_count": all_info.get(v, {}).get("caller_count", 0),
            "status":       status(v),
        }
        for v in all_vids
    ]
    edges_out = (
        [{"source": s, "target": t, "status": "added"}     for s, t in ev_b - ev_a] +
        [{"source": s, "target": t, "status": "removed"}   for s, t in ev_a - ev_b] +
        [{"source": s, "target": t, "status": "unchanged"} for s, t in ev_a & ev_b]
    )

    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "stats": {
            "added":          len(added_vids),
            "removed":        len(removed_vids),
            "modified":       len(modified_vids),
            "context":        len(context),
            "edge_added":     len(ev_b - ev_a),
            "edge_removed":   len(ev_a - ev_b),
            "edge_unchanged": len(ev_a & ev_b),
        },
    }
