"""
Semfora Explorer — FastAPI app entry point.

All business logic lives in:
  analytics/  — pure functions (query-free, testable in isolation)
  queries/    — DB I/O, returns plain Python data structures
  routers/    — thin HTTP handlers (call query → call analytics → return)
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from routers import (
    repos, dead_code, cycles, coupling, building,
    triage, centrality, communities, module_graph,
    load_bearing, graph, search, explore,
)

app = FastAPI(title="Semfora Explorer API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ──────────────────────────────────────────────────────────
app.include_router(repos.router)
app.include_router(dead_code.router)
app.include_router(cycles.router)
app.include_router(coupling.router)
app.include_router(building.router)
app.include_router(triage.router)
app.include_router(centrality.router)
app.include_router(communities.router)
app.include_router(module_graph.router)
app.include_router(load_bearing.router)
app.include_router(graph.router)
app.include_router(search.router)
app.include_router(explore.router)

# ── User simulation report ───────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).parent.parent
REPORT_HTML = REPO_ROOT / "user_simulation_report.html"

_NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

@app.get("/simulation-report", response_class=HTMLResponse, include_in_schema=False)
async def serve_simulation_report():
    """Serve the self-contained user-simulation HTML report."""
    if not REPORT_HTML.exists():
        return HTMLResponse(
            content=(
                "<html><body style='font-family:sans-serif;padding:2rem'>"
                "<h2>Report not generated yet</h2>"
                "<p>POST to <code>/simulation-report/generate</code> to run the pipeline.</p>"
                "</body></html>"
            ),
            status_code=404,
            headers=_NO_CACHE,
        )
    return HTMLResponse(content=REPORT_HTML.read_text(), status_code=200, headers=_NO_CACHE)


import asyncio, shutil, os

@app.get("/simulation-report/generate", response_class=HTMLResponse, include_in_schema=False)
async def regenerate_simulation_report_browser():
    """Browser-friendly GET: renders a page that auto-triggers the pipeline."""
    return HTMLResponse(headers=_NO_CACHE, content="""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Regenerating…</title>
<style>
  body{font-family:sans-serif;background:#0d1117;color:#e6edf3;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  .box{text-align:center;max-width:400px;}
  h2{margin-bottom:12px;} p{color:#8b949e;font-size:14px;margin-top:8px;}
  .spinner{font-size:48px;display:block;margin-bottom:16px;}
</style></head><body>
<div class="box">
  <span class="spinner" id="icon">⏳</span>
  <h2 id="msg">Running user simulation…</h2>
  <p id="sub">This takes ~10 seconds. You'll be redirected when it's done.</p>
</div>
<script>
(async () => {
  try {
    const r = await fetch('/simulation-report/generate', {method:'POST'});
    const d = await r.json();
    if (d.ok) {
      document.getElementById('icon').textContent = '✅';
      document.getElementById('msg').textContent  = 'Done!';
      document.getElementById('sub').textContent  = 'Redirecting to report…';
      setTimeout(() => location.href = '/simulation-report', 600);
    } else {
      document.getElementById('icon').textContent = '❌';
      document.getElementById('msg').textContent  = 'Pipeline failed';
      document.getElementById('sub').textContent  = d.error || 'unknown error';
    }
  } catch(e) {
    document.getElementById('icon').textContent = '❌';
    document.getElementById('msg').textContent  = 'Request failed';
    document.getElementById('sub').textContent  = e.message;
  }
})();
</script></body></html>""")


import logging as _logging
_log = _logging.getLogger("simulation")

@app.post("/simulation-report/generate", include_in_schema=False)
async def regenerate_simulation_report():
    """Re-run the user simulation pipeline and regenerate the HTML report."""
    # Try: $NODE env var → system PATH → known sandbox location
    node = (os.environ.get("NODE")
            or shutil.which("node")
            or "/workspace/node-v22.13.0-linux-arm64/bin/node")
    cmd = ["python3", str(REPO_ROOT / "user_simulation" / "run.py")]
    env = {**os.environ, "NODE": node}
    _log.info("generate: starting pipeline node=%s", node)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(REPO_ROOT),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        rc = proc.returncode
        out_str = stdout.decode()
        err_str = stderr.decode()
        _log.info("generate: rc=%d stdout=%r stderr=%r", rc, out_str[-200:], err_str[-200:])
        # exit 0 = all happy, exit 1 = some unhappy — both mean the pipeline ran ok
        if rc > 1:
            return JSONResponse({"ok": False, "error": err_str or out_str}, status_code=500)
        out_lines = out_str.strip().split("\n")
        summary = next((l for l in out_lines if "satisfied" in l), out_lines[0] if out_lines else "done")
        return JSONResponse({"ok": True, "output": summary.strip()})
    except asyncio.TimeoutError:
        _log.error("generate: timed out")
        return JSONResponse({"ok": False, "error": "pipeline timed out (120s)"}, status_code=500)
    except Exception as e:
        _log.exception("generate: unexpected error: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Serve React frontend (must be last) ──────────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(FRONTEND_DIST / "index.html")
