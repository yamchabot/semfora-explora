"""
Building view analysis — pure functions only.

Assigns architectural layer to each node based on caller_count percentile,
and classifies nodes as load-bearing or not based on config + heuristics.
"""
from __future__ import annotations

LAYER_LABELS = ["Foundation", "Platform", "Services", "Features", "Leaves"]

_LB_KEYWORDS = {
    "core", "platform", "base", "shared", "common", "infra", "lib", "utils",
    "foundation", "primitives", "runtime", "framework", "kernel",
}


def _module_parts(module: str) -> set[str]:
    return set((module or "").lower().replace(".", "/").replace("-", "/").split("/"))


def _is_load_bearing(node: dict, lb_config: dict) -> tuple[bool, str]:
    """Return (is_lb, declaration_type) for a node."""
    declared_hashes  = set(lb_config.get("declared_nodes", []))
    declared_modules = set(lb_config.get("declared_modules", []))

    h   = node.get("hash", "")
    mod = (node.get("module") or "").lower()

    explicitly = h in declared_hashes or any(m in mod for m in declared_modules)
    auto       = bool(_module_parts(mod) & _LB_KEYWORDS)

    if explicitly:
        return True, "explicit"
    if auto:
        return True, "auto"
    return False, "none"


def _assign_layer(caller_count: int, max_callers: int) -> int:
    """Map caller_count to a 0–4 architectural layer."""
    pct = caller_count / max_callers if max_callers > 0 else 0
    if pct > 0.6:  return 0  # Foundation
    if pct > 0.3:  return 1  # Platform
    if pct > 0.1:  return 2  # Services
    if pct > 0.02: return 3  # Features
    return 4                  # Leaves


def assign_layers(nodes: list[dict], edges: list[dict], lb_config: dict) -> dict:
    """
    Assign architectural layers to nodes and classify load-bearing status.

    nodes    — list of dicts: {hash, name, module, caller_count, ...}
    edges    — list of dicts: {from, to}  (caller_hash, callee_hash)
    lb_config — {declared_nodes: [...], declared_modules: [...]}
    """
    if not nodes:
        return {"nodes": [], "edges": [], "layer_labels": LAYER_LABELS}

    max_callers = max(n.get("caller_count", 0) for n in nodes) or 1
    result_nodes = []
    for n in nodes:
        node = dict(n)
        is_lb, decl = _is_load_bearing(node, lb_config)
        node["layer"]            = _assign_layer(node.get("caller_count", 0), max_callers)
        node["is_load_bearing"]  = is_lb
        node["declaration"]      = decl
        result_nodes.append(node)

    return {
        "nodes":        result_nodes,
        "edges":        edges,
        "layer_labels": LAYER_LABELS,
    }


def compute_diff_building(
    nodes_a: list[dict],
    nodes_b: list[dict],
    edges_a: list[dict],
    edges_b: list[dict],
    lb_config: dict,
) -> dict:
    """
    Building view for a structural diff between two snapshots.

    Nodes are identified by (name, module) across both snapshots.
    Each output node has diff_status: 'added' | 'removed' | 'common'.
    """
    def keyed(node_list):
        return {(n["name"], n["module"]): n for n in node_list}

    ka, kb = keyed(nodes_a), keyed(nodes_b)
    added_keys   = set(kb) - set(ka)
    removed_keys = set(ka) - set(kb)
    common_keys  = set(ka) & set(kb)

    max_b = max((n.get("caller_count", 0) for n in nodes_b), default=1) or 1
    max_a = max((n.get("caller_count", 0) for n in nodes_a), default=1) or 1

    out_nodes = []

    for key in added_keys:
        n = dict(kb[key])
        is_lb, decl = _is_load_bearing(n, lb_config)
        n.update(layer=_assign_layer(n.get("caller_count", 0), max_b),
                 diff_status="added", is_load_bearing=is_lb, declaration=decl)
        out_nodes.append(n)

    for key in removed_keys:
        n = dict(ka[key])
        is_lb, decl = _is_load_bearing(n, lb_config)
        n.update(layer=_assign_layer(n.get("caller_count", 0), max_a),
                 diff_status="removed", is_load_bearing=is_lb, declaration=decl)
        out_nodes.append(n)

    for key in common_keys:
        n = dict(kb[key])
        is_lb, decl = _is_load_bearing(n, lb_config)
        n.update(layer=_assign_layer(n.get("caller_count", 0), max_b),
                 diff_status="common", is_load_bearing=is_lb, declaration=decl)
        out_nodes.append(n)

    return {
        "nodes":  out_nodes,
        "edges":  edges_a + edges_b,
        "stats":  {
            "added":   len(added_keys),
            "removed": len(removed_keys),
            "common":  len(common_keys),
        },
        "layer_labels": LAYER_LABELS,
    }
