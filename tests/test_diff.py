"""
Unit tests for analytics/diff.py — pure functions only, no DB required.

Tests cover:
  - _content_hash: hash extraction for normal, ext:, and compound hashes
  - compute_diff_status_map: added / removed / modified / unchanged node detection
  - compute_diff: summary statistics
  - compute_diff_graph: structural subgraph output shape
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from backend.analytics.diff import (
    _content_hash,
    compute_diff_status_map,
    compute_diff,
    compute_diff_graph,
)


# ── helpers ────────────────────────────────────────────────────────────────────

def make_node(name, module, content="abc123", module_hash="mod99"):
    return {
        "name":         name,
        "module":       module,
        "hash":         f"{module_hash}:{content}",
        "kind":         "fn",
        "caller_count": 1,
        "callee_count": 1,
    }


def make_edge(caller_hash, callee_hash, call_count=1):
    return {"caller_hash": caller_hash, "callee_hash": callee_hash,
            "call_count": call_count}


def make_mod_edge(from_mod, to_mod, count=1):
    return {"caller_module": from_mod, "callee_module": to_mod,
            "edge_count": count}


# ── _content_hash ──────────────────────────────────────────────────────────────

class TestContentHash:
    def test_standard_compound_hash(self):
        node = {"hash": "modpart:contentpart"}
        assert _content_hash(node) == "contentpart"

    def test_ext_prefix_returned_whole(self):
        # External symbols are compared by full string
        node = {"hash": "ext:os.path.join"}
        assert _content_hash(node) == "ext:os.path.join"

    def test_single_segment_no_colon(self):
        # No colon → the hash IS the content hash
        node = {"hash": "deadbeef"}
        assert _content_hash(node) == "deadbeef"

    def test_missing_hash_key(self):
        node = {}
        assert _content_hash(node) == ""

    def test_multiple_colons_takes_last(self):
        # Only first ":" splits; rest of string is the content hash
        node = {"hash": "a:b:c"}
        assert _content_hash(node) == "b:c"


# ── compute_diff_status_map ────────────────────────────────────────────────────

class TestComputeDiffStatusMap:
    def test_added_node(self):
        a = []
        b = [make_node("new_fn", "mod_a")]
        result = compute_diff_status_map(a, b)
        assert result == {"mod_a::new_fn": "added"}

    def test_removed_node(self):
        a = [make_node("old_fn", "mod_a")]
        b = []
        result = compute_diff_status_map(a, b)
        assert result == {"mod_a::old_fn": "removed"}

    def test_unchanged_node_excluded(self):
        n = make_node("fn", "mod", content="same")
        result = compute_diff_status_map([n], [n])
        assert result == {}

    def test_modified_node_content_change(self):
        a = [make_node("fn", "mod", content="old_content")]
        b = [make_node("fn", "mod", content="new_content")]
        result = compute_diff_status_map(a, b)
        assert result == {"mod::fn": "modified"}

    def test_module_rename_not_flagged_as_modified(self):
        # Same name/module/content — only module_hash changed (file moved)
        a = [make_node("fn", "mod", content="same", module_hash="hash_a")]
        b = [make_node("fn", "mod", content="same", module_hash="hash_b")]
        result = compute_diff_status_map(a, b)
        assert result == {}  # content unchanged → not modified

    def test_mixed_changes(self):
        a = [
            make_node("kept",    "mod", content="same"),
            make_node("removed", "mod", content="x"),
            make_node("changed", "mod", content="old"),
        ]
        b = [
            make_node("kept",   "mod", content="same"),
            make_node("added",  "mod", content="y"),
            make_node("changed","mod", content="new"),
        ]
        result = compute_diff_status_map(a, b)
        assert result.get("mod::removed") == "removed"
        assert result.get("mod::added")   == "added"
        assert result.get("mod::changed") == "modified"
        assert "mod::kept" not in result

    def test_empty_both(self):
        assert compute_diff_status_map([], []) == {}

    def test_uses_module_and_name_as_key(self):
        a = [make_node("fn", "module_a")]
        b = [make_node("fn", "module_b")]
        result = compute_diff_status_map(a, b)
        assert "module_a::fn" in result
        assert result["module_a::fn"] == "removed"
        assert result["module_b::fn"] == "added"


# ── compute_diff ───────────────────────────────────────────────────────────────

class TestComputeDiff:
    def _nodes(self):
        return [
            make_node("fn_a", "mod", content="aaa"),
            make_node("fn_b", "mod", content="bbb"),
            make_node("fn_c", "mod", content="ccc"),
        ]

    def test_identical_snapshots_similarity_one(self):
        nodes = self._nodes()
        result = compute_diff(nodes, nodes, [], [])
        assert result["similarity"] == 1.0
        assert result["nodes_added"]   == 0
        assert result["nodes_removed"] == 0
        assert result["nodes_common"]  == 3

    def test_empty_a_all_added(self):
        nodes = self._nodes()
        result = compute_diff([], nodes, [], [])
        assert result["nodes_added"]   == 3
        assert result["nodes_removed"] == 0
        assert result["similarity"]    == 0.0

    def test_empty_b_all_removed(self):
        nodes = self._nodes()
        result = compute_diff(nodes, [], [], [])
        assert result["nodes_added"]   == 0
        assert result["nodes_removed"] == 3
        assert result["similarity"]    == 0.0

    def test_partial_overlap(self):
        a = [make_node("fn_a", "m"), make_node("fn_b", "m")]
        b = [make_node("fn_b", "m"), make_node("fn_c", "m")]
        result = compute_diff(a, b, [], [])
        assert result["nodes_added"]   == 1   # fn_c
        assert result["nodes_removed"] == 1   # fn_a
        assert result["nodes_common"]  == 1   # fn_b
        assert result["similarity"]    == pytest.approx(1 / 3, abs=0.01)

    def test_module_edge_changes(self):
        nodes = self._nodes()
        me_a = [make_mod_edge("mod_a", "mod_b", 3)]
        me_b = [make_mod_edge("mod_b", "mod_c", 2)]
        result = compute_diff(nodes, nodes, me_a, me_b)
        assert len(result["module_edges_added"])   == 1
        assert len(result["module_edges_removed"]) == 1

    def test_result_shape(self):
        nodes = self._nodes()
        result = compute_diff(nodes, nodes, [], [])
        for key in ("similarity", "nodes_added", "nodes_removed",
                    "nodes_common", "added", "removed",
                    "module_edges_added", "module_edges_removed"):
            assert key in result


# ── compute_diff_graph ─────────────────────────────────────────────────────────

class TestComputeDiffGraph:
    def _setup(self):
        na = make_node("fn_a", "mod", content="aaa")
        nb = make_node("fn_b", "mod", content="bbb")
        nc = make_node("fn_c", "mod", content="ccc")
        return na, nb, nc

    def test_added_node_appears_in_output(self):
        na, nb, _ = self._setup()
        result = compute_diff_graph([na], [na, nb], [], [])
        vids = {n["id"] for n in result["nodes"]}
        assert "fn_b::mod" in vids

    def test_removed_node_appears_in_output(self):
        na, nb, _ = self._setup()
        result = compute_diff_graph([na, nb], [na], [], [])
        vids = {n["id"] for n in result["nodes"]}
        assert "fn_b::mod" in vids

    def test_status_field_on_nodes(self):
        na, nb, _ = self._setup()
        result = compute_diff_graph([na], [na, nb], [], [])
        statuses = {n["id"]: n["status"] for n in result["nodes"]}
        assert statuses.get("fn_b::mod") == "added"

    def test_modified_status(self):
        na = make_node("fn", "mod", content="old")
        nb = make_node("fn", "mod", content="new")
        result = compute_diff_graph([na], [nb], [], [])
        statuses = {n["id"]: n["status"] for n in result["nodes"]}
        assert statuses.get("fn::mod") == "modified"

    def test_no_changes_empty_output(self):
        na, _, _ = self._setup()
        result = compute_diff_graph([na], [na], [], [])
        # Only unchanged context — no changed nodes → no nodes in subgraph
        assert len(result["nodes"]) == 0

    def test_edge_status(self):
        na = make_node("fn_a", "mod", content="same")
        nb = make_node("fn_b", "mod", content="old")
        nc = make_node("fn_b", "mod", content="new")  # fn_b modified

        ea = [make_edge(na["hash"], nb["hash"])]
        eb = [make_edge(na["hash"], nc["hash"])]

        result = compute_diff_graph([na, nb], [na, nc], ea, eb)
        assert "stats" in result
        assert "edges" in result
        assert "nodes" in result

    def test_result_keys(self):
        na, nb, _ = self._setup()
        result = compute_diff_graph([na], [na, nb], [], [])
        for key in ("nodes", "edges", "stats"):
            assert key in result
        for key in ("added", "removed", "modified", "context"):
            assert key in result["stats"]
