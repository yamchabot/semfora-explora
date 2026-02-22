"""
Cycle detection — pure functions only.

Detects strongly-connected components (SCCs) with size > 1
and annotates them with cross-module status and a break suggestion.
"""
from __future__ import annotations

import networkx as nx


def find_cycles(nodes: list[dict], edges: list[dict], max_results: int = 20) -> list[dict]:
    """
    Find circular dependency cycles in a call graph.

    nodes  — list of dicts with keys: hash, name, module, file_path
    edges  — list of dicts with keys: caller_hash, callee_hash, call_count
    Returns sorted list of cycles (largest first), each with:
        size, cross_module, modules, nodes, break_suggestion
    """
    node_map = {n["hash"]: n for n in nodes}

    G = nx.DiGraph()
    for n in nodes:
        G.add_node(n["hash"])
    for e in edges:
        G.add_edge(e["caller_hash"], e["callee_hash"], call_count=e.get("call_count", 1))

    sccs = [list(scc) for scc in nx.strongly_connected_components(G) if len(scc) > 1]

    results = []
    for scc in sorted(sccs, key=len, reverse=True)[:max_results]:
        scc_set = set(scc)
        scc_nodes = [node_map[h] for h in scc if h in node_map]
        modules_in_cycle = {n.get("module") for n in scc_nodes if n.get("module")}
        cross_module = len(modules_in_cycle) > 1

        # Break suggestion: intra-SCC edge with lowest call_count
        intra = [(u, v, d) for u, v, d in G.edges(scc, data=True) if v in scc_set]
        break_suggestion = None
        if intra:
            weakest = min(intra, key=lambda e: e[2].get("call_count", 0))
            caller_info = node_map.get(weakest[0], {})
            callee_info = node_map.get(weakest[1], {})
            break_suggestion = {
                "caller_hash":   weakest[0],
                "callee_hash":   weakest[1],
                "caller_name":   caller_info.get("name", weakest[0]),
                "callee_name":   callee_info.get("name", weakest[1]),
                "caller_module": caller_info.get("module", ""),
                "callee_module": callee_info.get("module", ""),
                "call_count":    weakest[2].get("call_count", 0),
            }

        results.append({
            "size":             len(scc),
            "cross_module":     cross_module,
            "modules":          sorted(modules_in_cycle),
            "nodes":            scc_nodes,
            "break_suggestion": break_suggestion,
        })

    return results
