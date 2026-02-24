#!/usr/bin/env python3
"""
run.py  —  Single runner for user simulation tests

Three steps, one command:

  1. Instrumentation  — calls node to run D3 simulations and write facts JSON
  2. Perceptions      — derives domain boolean observations from each facts file
  3. Judgement        — checks each person's Z3 formula against each scenario

Usage:
  python3 user_simulation/run.py               # standalone — print results table
  python3 -m pytest user_simulation/           # via pytest — fixture + pipeline tests

Node binary is resolved from PATH, or override with NODE= env var:
  NODE=/usr/local/bin/node python3 user_simulation/run.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE      = Path(__file__).parent
REPO_ROOT = HERE.parent

# Make `user_simulation` importable regardless of where the script is invoked from
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
INSTR_DIR = HERE / "instrumentation"
OUT_DIR   = INSTR_DIR / "output"


# ── Step 1: Instrumentation ───────────────────────────────────────────────────

def find_node() -> str:
    """Resolve the node binary from NODE env var or PATH."""
    override = os.environ.get("NODE")
    if override and Path(override).is_file():
        return override
    found = shutil.which("node")
    if found:
        return found
    raise RuntimeError(
        "node not found. Install Node.js or set NODE=/path/to/node"
    )


def run_instrumentation(node: str = None) -> dict[str, dict]:
    """
    Run the JS instrumentation runner via node.
    Returns a dict of {scenario_name: facts_dict}.
    """
    node = node or find_node()
    script = INSTR_DIR / "run_scenarios.js"

    subprocess.run(
        [node, str(script)],
        check=True,
        cwd=str(HERE),  # node_modules symlink lives here
    )

    return load_facts()


def load_facts() -> dict[str, dict]:
    """Load all scenario JSON files from instrumentation/output/."""
    if not OUT_DIR.exists():
        raise RuntimeError(f"No output directory found at {OUT_DIR}. Run instrumentation first.")
    return {
        p.stem: json.loads(p.read_text())
        for p in sorted(OUT_DIR.glob("*.json"))
    }


# ── Steps 2 + 3: Perceptions → Judgement ─────────────────────────────────────

def run_pipeline(facts_by_scenario: dict[str, dict]):
    """
    For each scenario: compute perceptions + reasons, check all people.
    Returns {scenario_name: [CheckResult, ...]}
    """
    from user_simulation.perceptions import compute_perceptions, compute_reasons
    from user_simulation.judgement   import check_all
    from user_simulation.users       import ALL

    results = {}
    for name, facts in facts_by_scenario.items():
        perceptions = compute_perceptions(facts)
        reasons     = compute_reasons(facts, perceptions)
        results[name] = check_all(ALL, perceptions, reasons)
    return results


# ── Reporting ─────────────────────────────────────────────────────────────────

def print_report(results_by_scenario: dict):
    """
    Print results grouped by person, not by scenario.
    Satisfied people get one line. Unhappy people get a narrative block
    with deduplicated unmet needs and a list of which scenarios they failed.
    """
    from user_simulation.perceptions import DESCRIPTIONS
    from user_simulation.users import ALL

    scenarios = list(results_by_scenario.keys())

    # Transpose: one dict per person, keyed by scenario name
    # results_by_scenario[scenario] is a list in ALL order
    by_person: list[dict[str, object]] = [
        {s: results_by_scenario[s][i] for s in scenarios}
        for i in range(len(ALL))
    ]

    # Header
    total_checks = len(ALL) * len(scenarios)
    total_happy  = sum(
        1 for pr in by_person
        for r in pr.values() if r.satisfied
    )
    print(f"\n{'─' * 60}")
    print(f"  {total_happy}/{total_checks} person×scenario checks satisfied")
    print(f"  scenarios: {', '.join(scenarios)}")
    print(f"{'─' * 60}\n")

    for i, person_results in enumerate(by_person):
        person = ALL[i]
        pro    = person.pronoun
        Pro    = pro.capitalize()
        sv     = "" if pro == "they" else "s"

        failing = {s: r for s, r in person_results.items() if not r.satisfied}

        if not failing:
            print(f"✅  {person.name} ({person.role}) — satisfied in all scenarios\n")
            continue

        # Deduplicate failed_vars across all failing scenarios, preserving first-seen order
        seen   = set()
        fields = []
        for r in failing.values():
            for f in r.failed_vars:
                if f not in seen:
                    seen.add(f)
                    fields.append(f)

        # For each field, pick the reason with the worst measurement
        # (longest detail string is a reasonable proxy for most informative)
        best_reasons: dict[str, str] = {}
        for r in failing.values():
            for field, detail in r.reasons.items():
                if field not in best_reasons or len(detail) > len(best_reasons[field]):
                    best_reasons[field] = detail

        goal_lc = person.goal[0].lower() + person.goal[1:]
        failing_names = ", ".join(failing.keys())

        print(f"❌  {person.name} ({person.role}) is unhappy. "
              f"{Pro} want{sv} to {goal_lc}")

        if fields:
            print(f"    {Pro} can't do that because {pro} need{sv}:")
            for field in fields:
                desc   = DESCRIPTIONS.get(field, field)
                detail = best_reasons.get(field, "")
                line   = f"      • {desc}"
                if detail:
                    line += f"\n        ({detail})"
                print(line)
        else:
            print(f"    {Pro} can't do that. (check {pro} formula for complex conditions)")

        print(f"    Unhappy in: {failing_names}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    print("Step 1: running instrumentation (node)…")
    facts = run_instrumentation()
    print(f"        loaded {len(facts)} scenario(s): {', '.join(facts)}\n")

    print("Step 2+3: perceptions → judgement…")
    results = run_pipeline(facts)

    print_report(results)

    any_fail = any(
        not r.satisfied
        for scenario_results in results.values()
        for r in scenario_results
    )
    sys.exit(1 if any_fail else 0)


if __name__ == "__main__":
    main()
