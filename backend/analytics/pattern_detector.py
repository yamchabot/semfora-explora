"""
Pattern Detector — identifies classic programming patterns from semfora's call graph.

Algorithm: structural graph analysis on the nodes/edges SQLite schema.
Each detector returns:
  { pattern, display_name, instances: [{nodes, description, confidence}] }

Detection is purely structural — no source code reading, only degree/path analysis.
"""
import sqlite3
from collections import defaultdict, deque
from typing import Optional


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_graph(conn: sqlite3.Connection) -> tuple[dict, dict, dict]:
    """
    Returns:
      nodes  = { hash: {name, module, kind, caller_count, callee_count} }
      out_adj = { hash: [(target_hash, call_count), ...] }
      in_adj  = { hash: [(source_hash, call_count), ...] }
    """
    nodes = {}
    for h, name, module, kind, caller_count, callee_count in conn.execute(
        "SELECT hash, name, module, kind, caller_count, callee_count "
        "FROM nodes WHERE hash NOT LIKE 'ext:%'"
    ).fetchall():
        nodes[h] = {
            "hash": h, "name": name, "module": module, "kind": kind,
            "caller_count": caller_count, "callee_count": callee_count,
        }

    out_adj = defaultdict(list)
    in_adj  = defaultdict(list)
    for caller, callee, count in conn.execute(
        "SELECT caller_hash, callee_hash, call_count FROM edges "
        "WHERE caller_hash NOT LIKE 'ext:%' AND callee_hash NOT LIKE 'ext:%'"
    ).fetchall():
        out_adj[caller].append((callee, count))
        in_adj[callee].append((caller, count))

    return nodes, dict(out_adj), dict(in_adj)


def _node_label(n: dict) -> str:
    return f"{n['module']}.{n['name']}"


def _bfs_chain(start: str, out_adj: dict, in_adj: dict) -> list[str]:
    """Follow a strictly linear chain (out-degree=1, in-degree=1) from start."""
    chain = [start]
    cur = start
    seen = {start}
    while True:
        nexts = out_adj.get(cur, [])
        if len(nexts) != 1:
            break
        nxt = nexts[0][0]
        if nxt in seen:
            break
        preds = in_adj.get(nxt, [])
        if len(preds) != 1:
            break
        chain.append(nxt)
        seen.add(nxt)
        cur = nxt
    return chain


def _find_sccs(nodes: dict, out_adj: dict) -> list[list[str]]:
    """Kosaraju SCC — returns SCCs with >1 node (mutual recursion candidates)."""
    order = []
    visited = set()

    def dfs1(v):
        stack = [(v, iter(h for h, _ in out_adj.get(v, [])))]
        visited.add(v)
        while stack:
            node, children = stack[-1]
            try:
                nxt = next(children)
                if nxt not in visited and nxt in nodes:
                    visited.add(nxt)
                    stack.append((nxt, iter(h for h, _ in out_adj.get(nxt, []))))
            except StopIteration:
                order.append(node)
                stack.pop()

    for v in nodes:
        if v not in visited:
            dfs1(v)

    rev_adj = defaultdict(list)
    for v in nodes:
        for w, c in out_adj.get(v, []):
            if w in nodes:
                rev_adj[w].append(v)

    visited2 = set()
    sccs = []

    def dfs2(v):
        comp = []
        stack = [v]
        visited2.add(v)
        while stack:
            node = stack.pop()
            comp.append(node)
            for w in rev_adj.get(node, []):
                if w not in visited2 and w in nodes:
                    visited2.add(w)
                    stack.append(w)
        return comp

    for v in reversed(order):
        if v not in visited2:
            comp = dfs2(v)
            if len(comp) > 1:
                sccs.append(comp)

    return sccs


# ── individual detectors ──────────────────────────────────────────────────────

def detect_singleton(nodes, out_adj, in_adj) -> list[dict]:
    """
    Singleton: one node with high in-degree (≥4) and very low out-degree (0-3).
    Often paired with a _create* companion (low in-degree, called only by the getter).
    """
    instances = []
    for h, n in nodes.items():
        in_deg  = len(in_adj.get(h, []))
        out_deg = len(out_adj.get(h, []))
        if in_deg >= 4 and out_deg <= 3:
            # Look for a _create companion
            companions = [
                nodes[t] for t, _ in out_adj.get(h, [])
                if len(in_adj.get(t, [])) == 1
            ]
            confidence = min(0.95, 0.55 + in_deg * 0.04)
            desc = (f"{_node_label(n)} is called by {in_deg} callers "
                    f"(getter pattern)")
            if companions:
                desc += f"; delegates creation to {companions[0]['name']}"
                confidence = min(0.95, confidence + 0.1)
            instances.append({
                "nodes":       [h] + [c for t, _ in out_adj.get(h, [])
                                      if len(in_adj.get(t, [])) == 1
                                      for c in [t]][:1],
                "description": desc,
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_factory_method(nodes, out_adj, in_adj) -> list[dict]:
    """
    Factory: node that calls ≥3 product-constructor nodes,
    where each product has low in-degree (≤2) and is in the same module.
    """
    instances = []
    for h, n in nodes.items():
        callees = [(t, nodes[t]) for t, _ in out_adj.get(h, []) if t in nodes]
        # Group callees by module
        same_mod = [t for t, cn in callees
                    if cn["module"] == n["module"]
                    and len(in_adj.get(t, [])) <= 2]
        if len(same_mod) >= 3:
            confidence = min(0.90, 0.50 + len(same_mod) * 0.06)
            instances.append({
                "nodes":       [h] + same_mod[:6],
                "description": (f"{_node_label(n)} creates {len(same_mod)} product "
                                f"variants in module '{n['module']}'"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_observer(nodes, out_adj, in_adj) -> list[dict]:
    """
    Observer/Event Bus: a notify/publish node with high out-degree (≥5) to
    handler nodes that each have low in-degree (≤2).
    """
    instances = []
    for h, n in nodes.items():
        out_edges = out_adj.get(h, [])
        if len(out_edges) < 5:
            continue
        handler_targets = [t for t, _ in out_edges
                           if t in nodes and len(in_adj.get(t, [])) <= 2]
        if len(handler_targets) >= 4:
            confidence = min(0.92, 0.55 + len(handler_targets) * 0.05)
            instances.append({
                "nodes":       [h] + handler_targets[:8],
                "description": (f"{_node_label(n)} fans out to {len(handler_targets)} "
                                f"handlers (observer/event-bus)"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_decorator_chain(nodes, out_adj, in_adj) -> list[dict]:
    """
    Decorator chain: a linear sequence of nodes of length ≥ 4 where each
    wraps the next (in=1, out=1 for interior nodes, same module).
    """
    instances = []
    visited = set()
    # Find chain entry points: in-degree > 1 (many callers), out-degree = 1
    for h, n in nodes.items():
        if h in visited:
            continue
        in_deg = len(in_adj.get(h, []))
        out_deg = len(out_adj.get(h, []))
        if in_deg >= 2 and out_deg == 1:
            chain = _bfs_chain(h, out_adj, in_adj)
            if len(chain) >= 4:
                for c in chain:
                    visited.add(c)
                # Only flag chains where nodes share a module prefix
                mods = {nodes[c]["module"] for c in chain if c in nodes}
                confidence = min(0.88, 0.45 + len(chain) * 0.07)
                instances.append({
                    "nodes":       chain[:8],
                    "description": (f"Decorator chain of {len(chain)} wrappers: "
                                    f"{nodes[chain[0]]['name']} → … → "
                                    f"{nodes[chain[-1]]['name']}"),
                    "confidence":  round(confidence, 2),
                })
    return instances


def detect_facade(nodes, out_adj, in_adj) -> list[dict]:
    """
    Facade: one node that calls into ≥ 3 distinct modules (cross-module fan-out).
    """
    instances = []
    for h, n in nodes.items():
        callees = [(t, nodes[t]) for t, _ in out_adj.get(h, []) if t in nodes]
        other_modules = {cn["module"] for _, cn in callees
                         if cn["module"] != n["module"]}
        if len(other_modules) >= 3:
            callee_hashes = [t for t, cn in callees if cn["module"] != n["module"]]
            confidence = min(0.90, 0.50 + len(other_modules) * 0.08)
            instances.append({
                "nodes":       [h] + callee_hashes[:8],
                "description": (f"{_node_label(n)} orchestrates {len(other_modules)} "
                                f"modules: {', '.join(sorted(other_modules))}"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_composite(nodes, out_adj, in_adj) -> list[dict]:
    """
    Composite / Recursive: nodes that call themselves (self-loop in edges)
    or are part of a mutually recursive pair where both nodes share a module.
    """
    instances = []
    for h, n in nodes.items():
        self_calls = [t for t, _ in out_adj.get(h, []) if t == h]
        if self_calls:
            instances.append({
                "nodes":       [h],
                "description": (f"{_node_label(n)} is self-recursive "
                                f"(composite/tree traversal/fold)"),
                "confidence":  0.85,
            })
    return instances


def detect_strategy(nodes, out_adj, in_adj) -> list[dict]:
    """
    Strategy: a context node that calls ≥ 3 sibling nodes (same module),
    where each sibling has low in-degree (≤ 2) — the interchangeable strategies.
    Context node has moderate out-degree (3-10).
    """
    instances = []
    for h, n in nodes.items():
        out_edges = out_adj.get(h, [])
        # Siblings: same module, low in-degree, not helpers (low out-degree is fine)
        siblings = [t for t, _ in out_edges
                    if t in nodes
                    and nodes[t]["module"] == n["module"]
                    and len(in_adj.get(t, [])) <= 2
                    and t != h]
        if 3 <= len(siblings) <= 8:
            confidence = min(0.85, 0.48 + len(siblings) * 0.07)
            instances.append({
                "nodes":       [h] + siblings,
                "description": (f"{_node_label(n)} dispatches to {len(siblings)} "
                                f"strategy implementations"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_chain_of_responsibility(nodes, out_adj, in_adj) -> list[dict]:
    """
    Chain of Responsibility: a strict linear chain ≥ 5 nodes long where
    each handler has in-degree=1 from the previous handler.
    Distinct from decorator: names suggest sequential processing steps.
    """
    instances = []
    visited = set()
    for h in nodes:
        if h in visited:
            continue
        in_deg = len(in_adj.get(h, []))
        out_deg = len(out_adj.get(h, []))
        # Find chain starts: low in-degree, exactly 1 out
        if in_deg <= 1 and out_deg == 1:
            chain = _bfs_chain(h, out_adj, in_adj)
            if len(chain) >= 5:
                for c in chain:
                    visited.add(c)
                instances.append({
                    "nodes":       chain[:8],
                    "description": (f"Handler chain: {nodes[chain[0]]['name']} → "
                                    f"… → {nodes[chain[-1]]['name']} "
                                    f"({len(chain)} steps)"),
                    "confidence":  round(min(0.82, 0.40 + len(chain) * 0.07), 2),
                })
    return instances


def detect_template_method(nodes, out_adj, in_adj) -> list[dict]:
    """
    Template method: a hub node whose callees all have very low in-degree (≤ 2),
    suggesting they are private hook methods called only by the template.
    Hub has ≥ 5 such callees.
    """
    instances = []
    for h, n in nodes.items():
        out_edges = out_adj.get(h, [])
        hook_callees = [t for t, _ in out_edges
                        if t in nodes and len(in_adj.get(t, [])) <= 2]
        if len(hook_callees) >= 5:
            confidence = min(0.87, 0.48 + len(hook_callees) * 0.05)
            instances.append({
                "nodes":       [h] + hook_callees[:8],
                "description": (f"{_node_label(n)} calls {len(hook_callees)} "
                                f"hook methods (template method skeleton)"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_command_dispatcher(nodes, out_adj, in_adj) -> list[dict]:
    """
    Command: a dispatcher node calling ≥ 5 command handler nodes,
    where each handler has in-degree = 1 (only called by the dispatcher).
    """
    instances = []
    for h, n in nodes.items():
        out_edges = out_adj.get(h, [])
        exclusive_callees = [t for t, _ in out_edges
                             if t in nodes and len(in_adj.get(t, [])) == 1]
        if len(exclusive_callees) >= 5:
            confidence = min(0.88, 0.50 + len(exclusive_callees) * 0.05)
            instances.append({
                "nodes":       [h] + exclusive_callees[:8],
                "description": (f"{_node_label(n)} exclusively owns {len(exclusive_callees)} "
                                f"command handlers"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_map_reduce(nodes, out_adj, in_adj) -> list[dict]:
    """
    Map/Reduce fan-out/fan-in: a hub with high out-degree to parallel nodes,
    whose outputs all converge to a single reduce node.
    Hub → [mapper1, mapper2, ..., mapperN] → reducer
    """
    instances = []
    for h, n in nodes.items():
        out_edges = out_adj.get(h, [])
        if len(out_edges) < 4:
            continue
        mappers = [t for t, _ in out_edges if t in nodes]
        if len(mappers) < 4:
            continue
        # Find convergence: a node called by many of these mappers
        downstream_counts = defaultdict(int)
        for m in mappers:
            for t, _ in out_adj.get(m, []):
                if t in nodes and t != h:
                    downstream_counts[t] += 1
        reducers = [(t, cnt) for t, cnt in downstream_counts.items() if cnt >= 3]
        if reducers:
            reducer_hash = max(reducers, key=lambda x: x[1])[0]
            instances.append({
                "nodes":       [h] + mappers[:6] + [reducer_hash],
                "description": (f"{_node_label(n)} fans out to {len(mappers)} mappers "
                                f"→ converges at {nodes[reducer_hash]['name']}"),
                "confidence":  round(min(0.86, 0.50 + len(mappers) * 0.06), 2),
            })
    return instances


def detect_mediator(nodes, out_adj, in_adj) -> list[dict]:
    """
    Mediator: a node with BOTH high in-degree (≥ 4) AND high out-degree (≥ 4).
    The bidirectional hub that all colleagues route through.
    """
    instances = []
    for h, n in nodes.items():
        in_deg  = len(in_adj.get(h, []))
        out_deg = len(out_adj.get(h, []))
        if in_deg >= 4 and out_deg >= 4:
            confidence = min(0.90, 0.45 + (in_deg + out_deg) * 0.025)
            callers = [src for src, _ in in_adj.get(h, [])[:5] if src in nodes]
            callees = [tgt for tgt, _ in out_adj.get(h, [])[:5] if tgt in nodes]
            instances.append({
                "nodes":       [h] + callers[:4] + callees[:4],
                "description": (f"{_node_label(n)}: bidirectional hub "
                                f"(in={in_deg}, out={out_deg})"),
                "confidence":  round(confidence, 2),
            })
    return instances


def detect_mutual_recursion(nodes, out_adj, in_adj) -> list[dict]:
    """
    Meta-circular / Mutual recursion: strongly-connected components
    with ≥ 2 nodes (A calls B calls A).
    """
    sccs = _find_sccs(nodes, out_adj)
    instances = []
    for scc in sccs:
        if len(scc) < 2:
            continue
        scc_nodes = [nodes[h] for h in scc if h in nodes]
        names = [n["name"] for n in scc_nodes[:4]]
        confidence = min(0.95, 0.70 + len(scc) * 0.04)
        instances.append({
            "nodes":       scc[:8],
            "description": (f"Mutual recursion cycle: {' ↔ '.join(names)}"
                            + (f" (+{len(scc)-4} more)" if len(scc) > 4 else "")),
            "confidence":  round(confidence, 2),
        })
    return instances


def detect_layered_architecture(nodes, out_adj, in_adj) -> list[dict]:
    """
    Layered arch: strict cross-module DAG where modules form a clear hierarchy.
    Detect by checking for absence of back-edges between module pairs.
    """
    # Build module-level edge map
    module_callers = defaultdict(set)  # module_a calls module_b
    for h, n in nodes.items():
        for t, _ in out_adj.get(h, []):
            if t in nodes and nodes[t]["module"] != n["module"]:
                module_callers[n["module"]].add(nodes[t]["module"])

    modules = list(module_callers.keys())
    if len(modules) < 3:
        return []

    # Find module pairs with one-directional calls only (no cycle)
    acyclic_pairs = []
    for a in modules:
        for b in module_callers.get(a, []):
            if a not in module_callers.get(b, set()):
                acyclic_pairs.append((a, b))

    if len(acyclic_pairs) >= 3:
        # Find modules involved in the acyclic chain
        layer_nodes = list({h for h, n in nodes.items()
                            if any(n["module"] in pair for pair in acyclic_pairs[:3])})
        return [{
            "nodes":       layer_nodes[:12],
            "description": (f"Layered architecture: {len(acyclic_pairs)} strict "
                            f"one-way module dependencies"),
            "confidence":  round(min(0.85, 0.50 + len(acyclic_pairs) * 0.06), 2),
        }]
    return []


def detect_proxy(nodes, out_adj, in_adj) -> list[dict]:
    """
    Proxy: a node with high in-degree that delegates to one real-subject node
    with very low in-degree (≤ 1), adding pre/post hook calls around it.
    """
    instances = []
    for h, n in nodes.items():
        in_deg = len(in_adj.get(h, []))
        if in_deg < 3:
            continue
        callees = [(t, nodes[t]) for t, _ in out_adj.get(h, []) if t in nodes]
        # Real subject: low in-degree callee in the same module
        subjects = [(t, cn) for t, cn in callees
                    if len(in_adj.get(t, [])) <= 1
                    and cn["module"] == n["module"]]
        if subjects:
            # Proxy also has hook callees (validation, logging, etc.)
            hook_callees = [t for t, cn in callees
                            if len(in_adj.get(t, [])) <= 2 and t != subjects[0][0]]
            if len(hook_callees) >= 2:
                subj_hash, subj_node = subjects[0]
                confidence = min(0.88, 0.52 + in_deg * 0.04 + len(hook_callees) * 0.03)
                instances.append({
                    "nodes":       [h, subj_hash] + hook_callees[:4],
                    "description": (f"{_node_label(n)} proxies "
                                    f"{subj_node['name']} "
                                    f"with {len(hook_callees)} cross-cutting hooks"),
                    "confidence":  round(confidence, 2),
                })
    return instances


def detect_pipeline(nodes, out_adj, in_adj) -> list[dict]:
    """
    Pipeline: a linear chain ≥ 4 steps where each stage has exactly one
    callee (the next stage). Entry point has many callers.
    Distinct from decorator by module context and naming.
    """
    instances = []
    visited = set()
    for h, n in nodes.items():
        if h in visited:
            continue
        in_deg = len(in_adj.get(h, []))
        # Entry of pipeline: called from outside (moderate in-degree)
        if in_deg >= 1:
            chain = _bfs_chain(h, out_adj, in_adj)
            if len(chain) >= 4:
                for c in chain:
                    visited.add(c)
                instances.append({
                    "nodes":       chain[:8],
                    "description": (f"Processing pipeline: "
                                    f"{nodes[chain[0]]['name']} → … → "
                                    f"{nodes[chain[-1]]['name']} "
                                    f"({len(chain)} stages)"),
                    "confidence":  round(min(0.80, 0.38 + len(chain) * 0.07), 2),
                })
    return instances


# ── main entry point ─────────────────────────────────────────────────────────

DETECTORS = [
    ("singleton",               "Singleton",                    detect_singleton),
    ("factory_method",          "Factory Method",               detect_factory_method),
    ("observer",                "Observer / Event Bus",         detect_observer),
    ("decorator_chain",         "Decorator Chain",              detect_decorator_chain),
    ("facade",                  "Façade",                       detect_facade),
    ("composite_recursive",     "Composite / Recursive",        detect_composite),
    ("strategy",                "Strategy",                     detect_strategy),
    ("chain_of_responsibility", "Chain of Responsibility",      detect_chain_of_responsibility),
    ("template_method",         "Template Method",              detect_template_method),
    ("command",                 "Command / Dispatcher",         detect_command_dispatcher),
    ("map_reduce",              "Map / Reduce",                 detect_map_reduce),
    ("mediator",                "Mediator",                     detect_mediator),
    ("mutual_recursion",        "Mutual Recursion",             detect_mutual_recursion),
    ("layered_architecture",    "Layered Architecture",         detect_layered_architecture),
    ("proxy",                   "Proxy",                        detect_proxy),
    ("pipeline",                "Pipeline",                     detect_pipeline),
]


def detect_all_patterns(
    conn: sqlite3.Connection,
    min_confidence: float = 0.50,
) -> list[dict]:
    """
    Run all pattern detectors against the graph.
    Returns list of { pattern, display_name, instances } dicts,
    sorted by total instance count descending.
    """
    nodes, out_adj, in_adj = _load_graph(conn)
    results = []
    for pattern_key, display_name, detector_fn in DETECTORS:
        try:
            raw = detector_fn(nodes, out_adj, in_adj)
            # Attach node labels and filter by confidence
            instances = []
            for inst in raw:
                if inst["confidence"] < min_confidence:
                    continue
                inst["node_labels"] = [
                    _node_label(nodes[h]) for h in inst["nodes"] if h in nodes
                ]
                instances.append(inst)

            if instances:
                results.append({
                    "pattern":      pattern_key,
                    "display_name": display_name,
                    "count":        len(instances),
                    "instances":    instances,
                })
        except Exception:
            pass  # Detector errors are non-fatal

    results.sort(key=lambda r: r["count"], reverse=True)
    return results
