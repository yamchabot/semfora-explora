#!/usr/bin/env python3
"""
instrumentation.py — Layer 1: Layout metrics via D3 simulation

Reads a pre-generated scenario JSON from usersim/instrumentation/output/
and emits it as a usersim metrics document.  If the file is missing, runs
run_scenarios.js to regenerate all outputs first.

Usage (via usersim run):
    USERSIM_SCENARIO=chain_10 python3 usersim/instrumentation.py

Usage (regenerate all scenario files):
    node usersim/instrumentation/run_scenarios.js
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE    = Path(__file__).parent                       # usersim/
OUT_DIR = HERE / "instrumentation" / "output"         # usersim/instrumentation/output/
SCRIPT  = HERE / "instrumentation" / "run_scenarios.js"  # usersim/instrumentation/run_scenarios.js


def find_node() -> str:
    override = os.environ.get("NODE")
    if override and Path(override).is_file():
        return override
    found = shutil.which("node")
    if found:
        return found
    raise RuntimeError("node not found. Install Node.js or set NODE=/path/to/node.")


def run_js_if_needed(scenario: str) -> None:
    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        node = find_node()
        subprocess.run([node, str(SCRIPT)], check=True, cwd=str(SCRIPT.parent))


def main() -> None:
    scenario = os.environ.get("USERSIM_SCENARIO", "chain_10")

    run_js_if_needed(scenario)

    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        print(f"error: scenario file not found after running JS: {target}", file=sys.stderr)
        sys.exit(1)

    facts = json.loads(target.read_text())

    print(json.dumps({
        "schema":   "usersim.metrics.v1",
        "scenario": scenario,
        "metrics":  facts,
    }))


if __name__ == "__main__":
    main()
