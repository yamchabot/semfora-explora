"""
Triage analysis — pure functions, iteration pattern.

Each check is an independent step: (state: dict) -> dict.
State carries accumulated issues + the pre-fetched input data.
The pipeline composes steps without coupling them to each other.

To add a new triage check: write a function matching the step
signature and append it to TRIAGE_STEPS.
"""
from __future__ import annotations

from collections import defaultdict

from .cycles import find_cycles


# ── Individual triage steps ───────────────────────────────────────────────────
# Each receives state = {issues, inputs, lb_config} and returns updated state.
# inputs keys: high_centrality_nodes, module_edges, call_graph, dead_file_stats


def _check_unexpected_coupling(state: dict) -> dict:
    """Flag nodes that are load-bearing but not declared as such."""
    inputs     = state["inputs"]
    lb_config  = state["lb_config"]
    declared_hashes  = set(lb_config.get("declared_nodes", []))
    declared_modules = set(lb_config.get("declared_modules", []))

    candidates = [
        r for r in inputs.get("high_centrality_nodes", [])
        if r["hash"] not in declared_hashes
        and (r.get("module") or "") not in declared_modules
    ]

    for row in candidates[:3]:
        n_mods = row["calling_modules"]
        state["issues"].append({
            "type":     "unexpected_coupling",
            "severity": "high" if n_mods >= 8 else "medium",
            "title":    f"`{row['name']}` is load-bearing without declaration",
            "detail":   (
                f"Called from {n_mods} modules but not declared as load-bearing. "
                f"Module: {row.get('module')}. This node will resist refactoring."
            ),
            "action": (
                "Open Building View → click this node → Declare load-bearing (if intentional) "
                "or plan to reduce its callers."
            ),
            "hash": row["hash"],
            "name": row["name"],
        })
    return state


def _check_unstable_modules(state: dict) -> dict:
    """Flag modules that are both high-traffic and highly unstable."""
    module_edges = state["inputs"].get("module_edges", [])

    afferent: dict[str, int] = defaultdict(int)
    efferent: dict[str, int] = defaultdict(int)
    for e in module_edges:
        afferent[e["callee_module"]] += e["edge_count"]
        efferent[e["caller_module"]] += e["edge_count"]

    unstable_high_traffic = [
        m for m in afferent
        if afferent[m] > 5
        and efferent[m] / (afferent[m] + efferent[m]) > 0.65
    ]

    if unstable_high_traffic:
        m = max(unstable_high_traffic, key=lambda x: afferent[x] + efferent[x])
        ca, ce = afferent[m], efferent[m]
        instability = round(ce / (ca + ce), 2)
        state["issues"].append({
            "type":     "unstable_module",
            "severity": "medium",
            "title":    f"`{m}` is high-traffic and unstable (I={instability})",
            "detail":   (
                f"Called from {ca} edges in, {ce} edges out. "
                f"Instability {instability} means changes here ripple widely."
            ),
            "action": (
                "Open Module Coupling → review this module's callers. "
                "Consider extracting stable core interfaces from this module."
            ),
            "module": m,
        })
    return state


def _check_cross_module_cycles(state: dict) -> dict:
    """Detect large cross-module cycles using the pre-fetched call graph."""
    call_graph = state["inputs"].get("call_graph", {})
    nodes = call_graph.get("nodes", [])
    edges = call_graph.get("edges", [])

    if not nodes or not edges:
        return state

    cycles = find_cycles(nodes, edges)
    cross = [c for c in cycles if c["cross_module"]]

    if cross:
        biggest = max(cross, key=lambda c: c["size"])
        mods = biggest["modules"]
        bs   = biggest.get("break_suggestion") or {}
        state["issues"].append({
            "type":     "cross_module_cycle",
            "severity": "high",
            "title":    f"Cross-module cycle across {len(mods)} modules ({biggest['size']} symbols)",
            "detail":   (
                f"Modules involved: {', '.join(sorted(mods)[:4])}{'…' if len(mods) > 4 else ''}. "
                "Circular dependencies prevent clean module extraction."
            ),
            "action": (
                f"Open Cycles → cut the call `{bs.get('caller_name', '?')}` → "
                f"`{bs.get('callee_name', '?')}` (lowest call count in the cycle) to break it."
            ) if bs else "Open Cycles view to identify the weakest edge to cut.",
            "modules": sorted(mods),
        })
    return state


def _check_dead_code_concentration(state: dict) -> dict:
    """Flag files where the majority of symbols are unreachable."""
    dead_file_stats = state["inputs"].get("dead_file_stats", [])

    if not dead_file_stats:
        return state

    # Already filtered to total>=5 AND dead/total>=0.6 — pick worst
    worst = max(dead_file_stats, key=lambda r: r["dead"])
    if worst["dead"] >= 5:
        pct = round(worst["dead"] / worst["total"] * 100)
        state["issues"].append({
            "type":     "dead_code_concentration",
            "severity": "low",
            "title":    f"{pct}% of `{worst['file_path'].split('/')[-1]}` is unreachable",
            "detail":   (
                f"{worst['dead']} of {worst['total']} symbols have zero callers. "
                "This file may be legacy code."
            ),
            "action": (
                "Open Dead Code → review this file's symbols. "
                "Private functions with low complexity are safest to delete first."
            ),
            "file": worst["file_path"],
        })
    return state


# ── Pipeline ──────────────────────────────────────────────────────────────────

TRIAGE_STEPS = [
    _check_unexpected_coupling,
    _check_unstable_modules,
    _check_cross_module_cycles,
    _check_dead_code_concentration,
]

_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def analyze_triage(inputs: dict, lb_config: dict) -> dict:
    """
    Run all triage checks via the iteration pattern.

    inputs    — pre-fetched data bundle from queries/triage.py
    lb_config — load-bearing config for the repo

    Each step in TRIAGE_STEPS is independently testable.
    To add a check, write a step function and append to TRIAGE_STEPS.
    """
    state: dict = {
        "issues":    [],
        "inputs":    inputs,
        "lb_config": lb_config,
    }
    for step in TRIAGE_STEPS:
        state = step(state)

    issues = sorted(state["issues"], key=lambda x: _SEVERITY_ORDER.get(x["severity"], 3))
    return {"issues": issues[:5]}
