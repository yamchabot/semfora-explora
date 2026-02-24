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
        )
    return HTMLResponse(content=REPORT_HTML.read_text(), status_code=200)


import asyncio, shutil, os

@app.post("/simulation-report/generate", include_in_schema=False)
async def regenerate_simulation_report():
    """Re-run the user simulation pipeline and regenerate the HTML report."""
    node = shutil.which("node") or os.environ.get("NODE", "node")
    cmd = ["python3", str(REPO_ROOT / "user_simulation" / "run.py")]
    env = {**os.environ, "NODE": node}
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(REPO_ROOT),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        if proc.returncode != 0:
            return JSONResponse({"ok": False, "error": stderr.decode()}, status_code=500)
        return JSONResponse({"ok": True, "output": stdout.decode().split("\n")[0]})
    except asyncio.TimeoutError:
        return JSONResponse({"ok": False, "error": "pipeline timed out (120s)"}, status_code=500)


# ── Serve React frontend (must be last) ──────────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(FRONTEND_DIST / "index.html")
