"""
Load-bearing node analysis — pure functions only.
"""
from __future__ import annotations

_LB_KEYWORDS = {
    "core", "platform", "base", "shared", "common", "infra", "lib", "utils",
    "foundation", "primitives", "runtime", "framework", "kernel",
}


def _module_parts(module: str) -> set[str]:
    return set((module or "").lower().replace(".", "/").replace("-", "/").split("/"))


def analyze_load_bearing(candidates: list[dict], lb_config: dict) -> dict:
    """
    Classify high-centrality nodes as declared or unexpected load-bearing.

    candidates — nodes called from many distinct modules (pre-filtered by threshold)
    lb_config  — {declared_nodes: [...], declared_modules: [...]}
    """
    declared_hashes  = set(lb_config.get("declared_nodes", []))
    declared_modules = set(lb_config.get("declared_modules", []))

    declared   = []
    unexpected = []

    for node in candidates:
        h   = node.get("hash", "")
        mod = (node.get("module") or "").lower()

        explicitly = h in declared_hashes or any(m in mod for m in declared_modules)
        auto       = bool(_module_parts(mod) & _LB_KEYWORDS)

        if explicitly or auto:
            node = dict(node)
            node["declaration"] = "explicit" if explicitly else "auto"
            declared.append(node)
        else:
            unexpected.append(node)

    return {
        "declared_load_bearing":   declared,
        "unexpected_load_bearing": unexpected,
        "config":                  lb_config,
    }
