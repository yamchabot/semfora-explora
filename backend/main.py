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
from fastapi.responses import FileResponse
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

# ── Serve React frontend (must be last) ──────────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(FRONTEND_DIST / "index.html")
