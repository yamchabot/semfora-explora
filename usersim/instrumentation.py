#!/usr/bin/env python3
"""
instrumentation.py — Layer 1: Layout metrics via D3 simulation

Runs the JS scenario suite (run_scenarios.js) and outputs one scenario's
raw layout measurements as a usersim metrics document.

USERSIM_SCENARIO env var selects which scenario to emit.  When run
without usersim, run_scenarios.js can also be invoked directly — it
writes all scenarios to instrumentation/output/*.json.

Usage (via usersim run):
    USERSIM_SCENARIO=chain_10 python3 usersim/instrumentation.py

Usage (generate all scenarios at once):
    node usersim/instrumentation/run_scenarios.js
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE      = Path(__file__).parent
OUT_DIR   = HERE / "instrumentation" / "output"
SCRIPT    = HERE / "instrumentation" / "run_scenarios.js"


def find_node() -> str:
    override = os.environ.get("NODE")
    if override and Path(override).is_file():
        return override
    found = shutil.which("node")
    if found:
        return found
    raise RuntimeError("node not found.  Install Node.js or set NODE=/path/to/node.")


def run_js_if_needed(scenario: str) -> None:
    """Run run_scenarios.js if the target output file is missing."""
    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        node = find_node()
        subprocess.run([node, str(SCRIPT)], check=True, cwd=str(HERE.parent))


def main() -> None:
    scenario = os.environ.get("USERSIM_SCENARIO", "chain_10")

    run_js_if_needed(scenario)

    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        print(f"error: scenario file not found: {target}", file=sys.stderr)
        sys.exit(1)

    facts = json.loads(target.read_text())

    # Emit usersim metrics document
    doc = {
        "schema":   "usersim.metrics.v1",
        "scenario": scenario,
        "metrics":  facts,
    }
    print(json.dumps(doc))


if __name__ == "__main__":
    main()
