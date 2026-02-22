"""
Dead code analysis — pure functions only.

Input:  flat lists/dicts of node data (no DB connections)
Output: structured analysis result
"""
from __future__ import annotations

_ENTRYPOINT_NAMES = {
    "main", "setup", "teardown", "configure", "run", "start", "init",
    "handler", "handle", "on_event", "register", "create_app", "app",
    "cli", "command", "callback", "entry", "entrypoint", "wsgi", "asgi",
    "lambda_handler", "index",
}
_FRAMEWORK_PATTERNS = {"test_", "Test", "Spec", "Fixture", "conftest", "setUp", "tearDown"}
_FRAMEWORK_PATH_SEGMENTS = {"test", "spec", "fixture", "conftest", "__init__", "setup.py", "manage.py"}


def classify_node(node: dict) -> str:
    """
    Return 'safe' | 'review' | 'caution' for an unreachable node.

    safe    — high confidence the symbol is genuinely unused
    review  — probably unused but worth a manual check
    caution — likely a false positive (entrypoint, framework hook, public API)
    """
    name = node.get("name", "")
    fp   = node.get("file_path", "") or ""
    kind = node.get("kind", "")

    if name.lower() in _ENTRYPOINT_NAMES:
        return "caution"
    if any(name.startswith(p) or name.endswith(p) for p in _FRAMEWORK_PATTERNS):
        return "caution"
    if any(seg in fp.lower() for seg in _FRAMEWORK_PATH_SEGMENTS):
        return "caution"
    if kind == "class":
        return "caution"

    is_private = name.startswith("_") or name.startswith("__")
    if is_private and (node.get("complexity") or 0) <= 8:
        return "safe"

    return "review"


def analyze_dead_code(candidates: list[dict], total_symbols: int) -> dict:
    """
    Given a list of zero-caller candidate nodes and the total symbol count,
    return a structured dead-code report with confidence tiers and file groupings.

    candidates   — nodes pre-filtered to caller_count=0, kind in (function/method/class)
    total_symbols — total non-external symbol count in the repo
    """
    nodes = [dict(n) for n in candidates]
    for n in nodes:
        n["confidence"] = classify_node(n)

    by_file: dict[str, list] = {}
    for n in nodes:
        by_file.setdefault(n.get("file_path") or "unknown", []).append(n)

    file_groups = [
        {
            "file":          f,
            "dead_count":    len(ns),
            "safe_count":    sum(1 for n in ns if n["confidence"] == "safe"),
            "review_count":  sum(1 for n in ns if n["confidence"] == "review"),
            "caution_count": sum(1 for n in ns if n["confidence"] == "caution"),
            "nodes":         ns,
        }
        for f, ns in sorted(by_file.items(), key=lambda x: -len(x[1]))
    ]

    dead_count = len(nodes)
    return {
        "total_dead":    dead_count,
        "dead_ratio":    dead_count / total_symbols if total_symbols else 0,
        "safe_count":    sum(1 for n in nodes if n["confidence"] == "safe"),
        "review_count":  sum(1 for n in nodes if n["confidence"] == "review"),
        "caution_count": sum(1 for n in nodes if n["confidence"] == "caution"),
        "file_groups":   file_groups,
    }
