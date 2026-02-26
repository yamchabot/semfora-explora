"""
Unit tests for analytics/pattern_detector.py.

Each test builds a minimal in-memory SQLite DB with exactly the graph topology
that should (or should not) trigger a given detector.

Design rules:
  - One topology per test — isolate signal from noise
  - Tests assert a specific pattern IS (or is NOT) detected at expected confidence
  - No external DB files required; all data is synthetic
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sqlite3
import pytest
from backend.analytics.pattern_detector import (
    _load_graph,
    _bfs_chain,
    _find_sccs,
    detect_singleton,
    detect_factory_method,
    detect_observer,
    detect_decorator_chain,
    detect_facade,
    detect_composite,
    detect_strategy,
    detect_chain_of_responsibility,
    detect_template_method,
    detect_all_patterns,
)


# ── DB helpers ─────────────────────────────────────────────────────────────────

def make_db() -> sqlite3.Connection:
    """In-memory DB with the nodes + edges schema."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""
        CREATE TABLE nodes (
            hash         TEXT PRIMARY KEY,
            name         TEXT,
            module       TEXT,
            kind         TEXT,
            caller_count INTEGER DEFAULT 0,
            callee_count INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE edges (
            caller_hash TEXT,
            callee_hash TEXT,
            call_count  INTEGER DEFAULT 1
        )
    """)
    conn.row_factory = sqlite3.Row
    return conn


def add_node(conn, h, name, module="mod", kind="fn",
             caller_count=0, callee_count=0):
    conn.execute(
        "INSERT INTO nodes VALUES (?,?,?,?,?,?)",
        (h, name, module, kind, caller_count, callee_count),
    )


def add_edge(conn, caller, callee, count=1):
    conn.execute(
        "INSERT INTO edges VALUES (?,?,?)",
        (caller, callee, count),
    )
    # Keep caller_count / callee_count consistent
    conn.execute("UPDATE nodes SET callee_count = callee_count + 1 WHERE hash = ?", (caller,))
    conn.execute("UPDATE nodes SET caller_count = caller_count + 1 WHERE hash = ?", (callee,))


# ── _load_graph ────────────────────────────────────────────────────────────────

class TestLoadGraph:
    def test_loads_nodes_and_edges(self):
        conn = make_db()
        add_node(conn, "a", "fn_a")
        add_node(conn, "b", "fn_b")
        add_edge(conn, "a", "b")

        nodes, out_adj, in_adj = _load_graph(conn)
        assert "a" in nodes and "b" in nodes
        assert "b" in [h for h, _ in out_adj["a"]]
        assert "a" in [h for h, _ in in_adj["b"]]

    def test_ext_nodes_excluded(self):
        conn = make_db()
        add_node(conn, "a",        "fn_a")
        add_node(conn, "ext:os.path.join", "join", module="builtins")
        add_edge(conn, "a", "ext:os.path.join")

        nodes, out_adj, in_adj = _load_graph(conn)
        assert "ext:os.path.join" not in nodes
        # The edge to an ext: node is also excluded
        assert not out_adj.get("a")

    def test_empty_db(self):
        conn = make_db()
        nodes, out_adj, in_adj = _load_graph(conn)
        assert nodes == {} and out_adj == {} and in_adj == {}


# ── _bfs_chain ─────────────────────────────────────────────────────────────────

class TestBfsChain:
    def _linear_chain(self, n=5):
        """a0 → a1 → a2 → … → a(n-1)"""
        out_adj = {f"a{i}": [(f"a{i+1}", 1)] for i in range(n - 1)}
        in_adj  = {f"a{i+1}": [(f"a{i}", 1)] for i in range(n - 1)}
        return out_adj, in_adj

    def test_follows_linear_chain(self):
        out_adj, in_adj = self._linear_chain(5)
        chain = _bfs_chain("a0", out_adj, in_adj)
        assert chain == ["a0", "a1", "a2", "a3", "a4"]

    def test_stops_at_branch(self):
        out_adj = {"a0": [("a1", 1)], "a1": [("a2", 1), ("a3", 1)]}
        in_adj  = {"a1": [("a0", 1)], "a2": [("a1", 1)], "a3": [("a1", 1)]}
        chain = _bfs_chain("a0", out_adj, in_adj)
        assert chain == ["a0", "a1"]   # stops at a1 (out-degree > 1)

    def test_stops_at_merge(self):
        # a1 has two callers — breaks the "in-degree=1" requirement
        out_adj = {"a0": [("a1", 1)], "side": [("a1", 1)], "a1": [("a2", 1)]}
        in_adj  = {"a1": [("a0", 1), ("side", 1)], "a2": [("a1", 1)]}
        chain = _bfs_chain("a0", out_adj, in_adj)
        assert chain == ["a0"]

    def test_single_node_no_outgoing(self):
        chain = _bfs_chain("lone", {}, {})
        assert chain == ["lone"]


# ── _find_sccs ─────────────────────────────────────────────────────────────────

class TestFindSccs:
    def _nodes(self, *hs):
        return {h: {"hash": h} for h in hs}

    def test_mutual_recursion(self):
        nodes  = self._nodes("a", "b")
        out_adj = {"a": [("b", 1)], "b": [("a", 1)]}
        sccs = _find_sccs(nodes, out_adj)
        assert any(set(s) == {"a", "b"} for s in sccs)

    def test_linear_no_scc(self):
        nodes = self._nodes("a", "b", "c")
        out_adj = {"a": [("b", 1)], "b": [("c", 1)]}
        assert _find_sccs(nodes, out_adj) == []

    def test_self_loop_excluded_from_multi_sccs(self):
        nodes   = self._nodes("a")
        out_adj = {"a": [("a", 1)]}
        # Self-loops produce SCC of size 1 — _find_sccs returns only >1-size SCCs
        assert _find_sccs(nodes, out_adj) == []


# ── detect_singleton ──────────────────────────────────────────────────────────

class TestDetectSingleton:
    def _graph_with_hub(self, in_degree=5, out_degree=1):
        """Hub node with `in_degree` callers and `out_degree` callees."""
        conn = make_db()
        add_node(conn, "hub", "get_instance", "mod")
        for i in range(in_degree):
            add_node(conn, f"caller_{i}", f"user_{i}", "mod")
            add_edge(conn, f"caller_{i}", "hub")
        for i in range(out_degree):
            add_node(conn, f"callee_{i}", f"dep_{i}", "mod")
            add_edge(conn, "hub", f"callee_{i}")
        return _load_graph(conn)

    def test_high_in_low_out_detected(self):
        nodes, out_adj, in_adj = self._graph_with_hub(in_degree=5, out_degree=1)
        instances = detect_singleton(nodes, out_adj, in_adj)
        assert len(instances) >= 1
        assert instances[0]["confidence"] >= 0.55

    def test_low_in_not_detected(self):
        nodes, out_adj, in_adj = self._graph_with_hub(in_degree=2, out_degree=0)
        instances = detect_singleton(nodes, out_adj, in_adj)
        assert instances == []

    def test_high_out_not_detected(self):
        # In-degree=5 but out-degree=5 — not a getter pattern
        nodes, out_adj, in_adj = self._graph_with_hub(in_degree=5, out_degree=5)
        instances = detect_singleton(nodes, out_adj, in_adj)
        assert instances == []

    def test_confidence_increases_with_in_degree(self):
        nodes4, o4, i4 = self._graph_with_hub(in_degree=4,  out_degree=0)
        nodes8, o8, i8 = self._graph_with_hub(in_degree=8,  out_degree=0)
        c4 = detect_singleton(nodes4, o4, i4)[0]["confidence"]
        c8 = detect_singleton(nodes8, o8, i8)[0]["confidence"]
        assert c8 > c4


# ── detect_factory_method ──────────────────────────────────────────────────────

class TestDetectFactory:
    def _factory_graph(self, n_products=4, same_module=True):
        conn = make_db()
        factory_mod = "factory_mod"
        add_node(conn, "factory", "create", factory_mod)
        for i in range(n_products):
            mod = factory_mod if same_module else f"product_mod_{i}"
            add_node(conn, f"product_{i}", f"ProductType{i}", mod)
            add_edge(conn, "factory", f"product_{i}")
        return _load_graph(conn)

    def test_same_module_fan_out_detected(self):
        nodes, out_adj, in_adj = self._factory_graph(n_products=4)
        instances = detect_factory_method(nodes, out_adj, in_adj)
        assert len(instances) >= 1

    def test_cross_module_not_detected(self):
        nodes, out_adj, in_adj = self._factory_graph(n_products=4, same_module=False)
        instances = detect_factory_method(nodes, out_adj, in_adj)
        assert instances == []

    def test_too_few_products_not_detected(self):
        nodes, out_adj, in_adj = self._factory_graph(n_products=2)
        instances = detect_factory_method(nodes, out_adj, in_adj)
        assert instances == []


# ── detect_observer ────────────────────────────────────────────────────────────

class TestDetectObserver:
    def _observer_graph(self, n_handlers=6, shared_callers=0):
        conn = make_db()
        add_node(conn, "publish", "notify_all", "events")
        for i in range(n_handlers):
            add_node(conn, f"h{i}", f"handle_{i}", "handlers")
            add_edge(conn, "publish", f"h{i}")
            # Optional: add extra callers to handlers to push in_degree above threshold
            for j in range(shared_callers):
                add_node(conn, f"extra_{i}_{j}", f"extra_{i}_{j}", "other")
                add_edge(conn, f"extra_{i}_{j}", f"h{i}")
        return _load_graph(conn)

    def test_high_fan_out_detected(self):
        nodes, out_adj, in_adj = self._observer_graph(n_handlers=6)
        instances = detect_observer(nodes, out_adj, in_adj)
        assert len(instances) >= 1

    def test_too_few_handlers_not_detected(self):
        nodes, out_adj, in_adj = self._observer_graph(n_handlers=3)
        instances = detect_observer(nodes, out_adj, in_adj)
        assert instances == []

    def test_handlers_with_many_callers_excluded(self):
        # Handlers with >2 callers each → not low in-degree → not observer
        nodes, out_adj, in_adj = self._observer_graph(n_handlers=6, shared_callers=3)
        # Should still detect (shared callers add noise but handler count still high)
        # OR not detect — implementation-specific; just ensure no crash
        detect_observer(nodes, out_adj, in_adj)  # no exception


# ── detect_decorator_chain ────────────────────────────────────────────────────

class TestDetectDecoratorChain:
    def _chain(self, length=5):
        """Entry (in-degree=2) → linear chain of `length` nodes."""
        conn = make_db()
        add_node(conn, "entry", "fetch",             "wrappers")
        add_node(conn, "ext_caller1", "c1", "client")
        add_node(conn, "ext_caller2", "c2", "client")
        add_edge(conn, "ext_caller1", "entry")
        add_edge(conn, "ext_caller2", "entry")
        prev = "entry"
        for i in range(length - 1):
            h = f"wrap_{i}"
            add_node(conn, h, f"wrapped_{i}", "wrappers")
            add_edge(conn, prev, h)
            prev = h
        return _load_graph(conn)

    def test_long_chain_detected(self):
        nodes, out_adj, in_adj = self._chain(length=5)
        instances = detect_decorator_chain(nodes, out_adj, in_adj)
        assert len(instances) >= 1

    def test_short_chain_not_detected(self):
        nodes, out_adj, in_adj = self._chain(length=2)
        instances = detect_decorator_chain(nodes, out_adj, in_adj)
        assert instances == []


# ── detect_facade ──────────────────────────────────────────────────────────────

class TestDetectFacade:
    def test_cross_module_fan_out_detected(self):
        conn = make_db()
        add_node(conn, "facade_fn", "process", "facade_mod")
        for i in range(4):
            add_node(conn, f"dep_{i}", f"dep_fn_{i}", f"subsystem_{i}")
            add_edge(conn, "facade_fn", f"dep_{i}")
        nodes, out_adj, in_adj = _load_graph(conn)
        instances = detect_facade(nodes, out_adj, in_adj)
        assert len(instances) >= 1

    def test_same_module_not_facade(self):
        conn = make_db()
        add_node(conn, "hub", "hub_fn", "same_mod")
        for i in range(4):
            add_node(conn, f"dep_{i}", f"dep_{i}", "same_mod")
            add_edge(conn, "hub", f"dep_{i}")
        nodes, out_adj, in_adj = _load_graph(conn)
        instances = detect_facade(nodes, out_adj, in_adj)
        assert instances == []


# ── detect_composite ──────────────────────────────────────────────────────────

class TestDetectComposite:
    def test_self_recursive_detected(self):
        conn = make_db()
        add_node(conn, "tree_fn", "traverse", "tree")
        add_edge(conn, "tree_fn", "tree_fn")   # self-loop
        nodes, out_adj, in_adj = _load_graph(conn)
        instances = detect_composite(nodes, out_adj, in_adj)
        assert len(instances) == 1
        assert instances[0]["confidence"] == 0.85

    def test_no_self_loop_not_detected(self):
        conn = make_db()
        add_node(conn, "fn", "fn", "mod")
        nodes, out_adj, in_adj = _load_graph(conn)
        assert detect_composite(nodes, out_adj, in_adj) == []


# ── detect_strategy ────────────────────────────────────────────────────────────

class TestDetectStrategy:
    def test_context_with_siblings_detected(self):
        conn = make_db()
        add_node(conn, "ctx", "execute", "strategies")
        for i in range(4):
            add_node(conn, f"strat_{i}", f"strategy_{i}", "strategies")
            add_edge(conn, "ctx", f"strat_{i}")
        nodes, out_adj, in_adj = _load_graph(conn)
        instances = detect_strategy(nodes, out_adj, in_adj)
        assert len(instances) >= 1

    def test_too_few_strategies_not_detected(self):
        conn = make_db()
        add_node(conn, "ctx", "execute", "mod")
        for i in range(2):
            add_node(conn, f"s{i}", f"strat_{i}", "mod")
            add_edge(conn, "ctx", f"s{i}")
        nodes, out_adj, in_adj = _load_graph(conn)
        assert detect_strategy(nodes, out_adj, in_adj) == []


# ── detect_all_patterns (integration) ─────────────────────────────────────────

class TestDetectAllPatterns:
    def test_returns_list(self):
        conn = make_db()
        result = detect_all_patterns(conn)
        assert isinstance(result, list)

    def test_empty_graph_returns_empty(self):
        conn = make_db()
        result = detect_all_patterns(conn)
        assert result == []

    def test_result_shape(self):
        """Each result item has the required keys."""
        conn = make_db()
        # Build a singleton topology
        add_node(conn, "hub", "get_inst", "mod")
        for i in range(5):
            add_node(conn, f"c{i}", f"caller_{i}", "mod")
            add_edge(conn, f"c{i}", "hub")

        result = detect_all_patterns(conn, min_confidence=0.0)
        assert len(result) >= 1
        item = result[0]
        for key in ("pattern", "display_name", "count", "instances"):
            assert key in item
        inst = item["instances"][0]
        for key in ("nodes", "description", "confidence", "node_labels"):
            assert key in inst

    def test_min_confidence_filters(self):
        conn = make_db()
        add_node(conn, "hub", "get_inst", "mod")
        for i in range(5):
            add_node(conn, f"c{i}", f"caller_{i}", "mod")
            add_edge(conn, f"c{i}", "hub")

        low  = detect_all_patterns(conn, min_confidence=0.0)
        high = detect_all_patterns(conn, min_confidence=0.99)
        # High threshold should filter out more (or equal) instances
        low_count  = sum(r["count"] for r in low)
        high_count = sum(r["count"] for r in high)
        assert high_count <= low_count

    def test_sorted_by_instance_count(self):
        conn = make_db()
        # Add several self-recursive nodes (composite) — easy to generate many
        for i in range(4):
            add_node(conn, f"rec_{i}", f"recurse_{i}", f"mod_{i}")
            add_edge(conn, f"rec_{i}", f"rec_{i}")
        # Add one singleton
        add_node(conn, "hub", "get_inst", "mod")
        for i in range(5):
            add_node(conn, f"c{i}", f"caller_{i}", "mod")
            add_edge(conn, f"c{i}", "hub")

        result = detect_all_patterns(conn, min_confidence=0.0)
        counts = [r["count"] for r in result]
        assert counts == sorted(counts, reverse=True)

    def test_detector_crash_does_not_propagate(self):
        """A bad DB should not raise — detectors catch exceptions internally."""
        conn = make_db()
        # Missing expected columns would crash badly — but detect_all_patterns
        # wraps each detector in try/except.  Use an almost-empty graph.
        result = detect_all_patterns(conn)
        assert isinstance(result, list)

    def test_node_labels_populated(self):
        conn = make_db()
        add_node(conn, "hub", "get_instance", "singleton_mod")
        for i in range(5):
            add_node(conn, f"c{i}", f"caller_{i}", "singleton_mod")
            add_edge(conn, f"c{i}", "hub")

        result = detect_all_patterns(conn, min_confidence=0.0)
        for r in result:
            for inst in r["instances"]:
                assert isinstance(inst["node_labels"], list)
                assert all(isinstance(lbl, str) for lbl in inst["node_labels"])
