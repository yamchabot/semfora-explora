"""
instrumentation.py — collect metrics from your application.

Run by usersim via the command in usersim.yaml.  Write JSON to stdout.
USERSIM_SCENARIO env var is set to the current scenario name.

Replace the stub below with real measurements from your app.
"""
import json
import os
import sys

scenario = os.environ.get("USERSIM_SCENARIO", "default")

# TODO: replace with real measurements
metrics = {
    "response_time_ms": 120,
    "error_count":      0,
    "service_up":       True,
}

json.dump({
    "schema":   "usersim.metrics.v1",
    "scenario": scenario,
    "metrics":  metrics,
}, sys.stdout)
