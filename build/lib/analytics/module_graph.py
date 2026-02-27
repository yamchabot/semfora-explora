"""
Module-level force graph — pure functions only.

Rolls module paths up to a given depth and computes coupling metrics
for the force-directed module graph view.
"""
from __future__ import annotations


def _rollup(module: str, depth: int) -> str:
    if not module:
        return "__unknown__"
    if module.startswith("__"):
        return module
    parts = module.replace("/", ".").split(".")
    return ".".join(parts[:depth])


def compute_module_graph(
    module_symbol_rows: list[dict],
    module_edge_rows: list[dict],
    depth: int = 2,
) -> dict:
    """
    Roll up modules to `depth` path segments and compute coupling metrics.

    module_symbol_rows — [{module, symbol_count, total_complexity}]
    module_edge_rows   — [{caller_module, callee_module, edge_count}]
                         should already exclude __external__
    depth              — number of module path segments to keep
    """
    # Aggregate symbol stats per rolled-up module
    rolled_stats: dict[str, dict] = {}
    for r in module_symbol_rows:
        rolled = _rollup(r["module"], depth)
        if rolled not in rolled_stats:
            rolled_stats[rolled] = {"symbol_count": 0, "complexity": 0, "submodules": set()}
        rolled_stats[rolled]["symbol_count"] += r["symbol_count"]
        rolled_stats[rolled]["complexity"]   += r.get("total_complexity", 0)
        if r["module"] != rolled:
            rolled_stats[rolled]["submodules"].add(r["module"])

    # Roll up edges
    edge_map: dict[tuple, int] = {}
    intra:    dict[str, int]   = {}
    for r in module_edge_rows:
        src = _rollup(r["caller_module"], depth)
        dst = _rollup(r["callee_module"], depth)
        if src == dst:
            intra[src] = intra.get(src, 0) + r["edge_count"]
            continue
        if dst.startswith("__") or src.startswith("__"):
            continue
        key = (src, dst)
        edge_map[key] = edge_map.get(key, 0) + r["edge_count"]

    # Coupling per rolled module
    afferent: dict[str, int] = {}
    efferent: dict[str, int] = {}
    for (src, dst), cnt in edge_map.items():
        efferent[src] = efferent.get(src, 0) + cnt
        afferent[dst] = afferent.get(dst, 0) + cnt

    valid_ids = {m for m in rolled_stats if not m.startswith("__")}
    nodes_out = []
    for mod in valid_ids:
        stats      = rolled_stats[mod]
        ca, ce     = afferent.get(mod, 0), efferent.get(mod, 0)
        instability = ce / (ca + ce) if (ca + ce) > 0 else 0.5
        nodes_out.append({
            "id":              mod,
            "label":           mod.split(".")[-1],
            "full_name":       mod,
            "symbol_count":    stats["symbol_count"],
            "complexity":      stats["complexity"],
            "afferent":        ca,
            "efferent":        ce,
            "instability":     round(instability, 3),
            "intra_calls":     intra.get(mod, 0),
            "submodule_count": len(stats["submodules"]),
        })

    max_edge = max(edge_map.values(), default=1)
    edges_out = [
        {"from": k[0], "to": k[1], "count": v, "weight": round(v / max_edge, 3)}
        for k, v in edge_map.items()
        if k[0] in valid_ids and k[1] in valid_ids
    ]

    # Max meaningful depth across all module paths
    max_depth = max(
        (len(r["module"].replace("/", ".").split("."))
         for r in module_symbol_rows
         if not r["module"].startswith("__")),
        default=1,
    )

    return {
        "nodes":     nodes_out,
        "edges":     edges_out,
        "depth":     depth,
        "max_depth": min(max_depth, 6),
    }
