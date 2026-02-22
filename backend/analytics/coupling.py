"""
Module coupling analysis — pure functions only.

Computes afferent/efferent coupling, instability, and per-module symbol stats.
"""
from __future__ import annotations


def compute_coupling(module_edges: list[dict]) -> dict[str, dict]:
    """
    Compute per-module afferent/efferent coupling and instability.

    module_edges — list of dicts: {caller_module, callee_module, edge_count}
                   should already have __external__ filtered out
    Returns      — {module: {afferent, efferent, instability}}
    """
    afferent: dict[str, int] = {}
    efferent: dict[str, int] = {}

    for e in module_edges:
        src, dst, cnt = e["caller_module"], e["callee_module"], e.get("edge_count", e.get("cnt", 0))
        if src == dst:
            continue
        efferent[src] = efferent.get(src, 0) + cnt
        afferent[dst] = afferent.get(dst, 0) + cnt

    modules = set(list(afferent) + list(efferent))
    result = {}
    for m in modules:
        ca = afferent.get(m, 0)
        ce = efferent.get(m, 0)
        total = ca + ce
        result[m] = {
            "afferent":    ca,
            "efferent":    ce,
            "instability": round(ce / total, 3) if total else 0,
        }
    return result


def compute_module_stats(
    symbol_stats: list[dict],
    module_edges: list[dict],
) -> list[dict]:
    """
    Combine per-module symbol/complexity stats with coupling metrics.

    symbol_stats — list of dicts: {module, symbol_count, total_complexity, avg_complexity}
    module_edges — list of dicts: {caller_module, callee_module, edge_count}
    Returns      — list of per-module dicts with coupling + symbol data, sorted by total coupling desc
    """
    raw = {r["module"]: dict(r) for r in symbol_stats}

    for e in module_edges:
        src, dst, cnt = e["caller_module"], e["callee_module"], e.get("edge_count", 0)
        if src == dst:
            continue
        if dst in raw:
            raw[dst]["afferent"] = raw[dst].get("afferent", 0) + cnt
        if src in raw:
            raw[src]["efferent"] = raw[src].get("efferent", 0) + cnt

    results = []
    for m, data in raw.items():
        ca = data.get("afferent", 0)
        ce = data.get("efferent", 0)
        instability = ce / (ca + ce) if (ca + ce) > 0 else 0
        results.append({
            "module":              m,
            "symbol_count":        data.get("symbol_count", 0),
            "afferent_coupling":   ca,
            "efferent_coupling":   ce,
            "instability":         round(instability, 3),
            "avg_complexity":      round(data.get("avg_complexity", 0), 2),
        })

    results.sort(key=lambda x: x["afferent_coupling"] + x["efferent_coupling"], reverse=True)
    return results
