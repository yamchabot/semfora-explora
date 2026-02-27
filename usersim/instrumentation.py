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
    node usersim/instrumentation.py
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE      = Path(__file__).parent
OUT_DIR   = HERE / "output"
SCRIPT    = HERE / "run_scenarios.js"


def find_node() -> str:
    """Resolve the node binary from NODE env var or PATH."""
    override = os.environ.get("NODE")
    if override and Path(override).is_file():
        return override
    found = shutil.which("node")
    if found:
        return found
    raise RuntimeError("node not found.  Install Node.js or set NODE=/path/to/node.")


def run_js_if_needed(script: Path, scenario: str) -> None:
    """Run the JS script if the target output file is missing."""
    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        node = find_node()
        subprocess.run([node, str(script)], check=True, cwd=str(script.parent))


def main() -> None:
    scenario = os.environ.get("USERSIM_SCENARIO", "chain_10") # Default to a common scenario

    # Ensure the output directory and the specific scenario file exist
    run_js_if_needed(SCRIPT.parent, scenario) # Pass the script's parent directory to ensure correct cwd

    target = OUT_DIR / f"{scenario}.json"
    if not target.exists():
        print(f"error: scenario file not found: {target}", file=sys.stderr)
        sys.exit(1)

    try:
        facts = json.loads(target.read_text())
    except json.JSONDecodeError as e:
        print(f"error: Invalid JSON in {target}: {e}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print(f"error: Output file not found after running script: {target}", file=sys.stderr)
        sys.exit(1)


    # Emit usersim metrics document
    doc = {
        "schema":   "usersim.metrics.v1",
        "scenario": scenario,
        "metrics":  facts,
    }
    print(json.dumps(doc))


if __name__ == "__main__":
    main()
