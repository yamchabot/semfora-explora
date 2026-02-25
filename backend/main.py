"""
Semfora Explora — FastAPI app entry point.

All business logic lives in:
  analytics/  — pure functions (query-free, testable in isolation)
  queries/    — DB I/O, returns plain Python data structures
  routers/    — thin HTTP handlers (call query → call analytics → return)
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from routers import (
    repos, dead_code, cycles, coupling, building,
    triage, centrality, communities, module_graph,
    load_bearing, graph, search, explore, import_repo, patterns,
)

app = FastAPI(title="Semfora Explora API", version="0.2.0")

import sqlite3 as _sqlite3

@app.exception_handler(_sqlite3.DatabaseError)
async def _db_error_handler(request: Request, exc: _sqlite3.DatabaseError):
    msg = str(exc)
    if "malformed" in msg or "disk image" in msg:
        detail = (
            "This database is corrupted (SQLite B-tree integrity failure). "
            "Re-export the repo: semfora-engine query callgraph --export data/<repo>.db"
        )
        status = 422
    elif "no such table" in msg:
        detail = f"Database is missing expected table ({msg}). The repo may need re-export or enrichment."
        status = 422
    else:
        detail = f"Database error: {msg}"
        status = 500
    return JSONResponse(status_code=status, content={"error": "database_error", "detail": detail})

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
app.include_router(import_repo.router)
app.include_router(patterns.router)

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


# ── Windows 95 Desktop ───────────────────────────────────────────────────────
WIN95_HTML = Path(__file__).parent / "win95.html"

WIN98_PATH = Path(__file__).parent.parent.parent / "win98-desktop"

# Mount win98 static asset directories (must be before SPA catch-all)
if WIN98_PATH.exists():
    # Mount win98 static dirs — exclude my-documents (handled dynamically below)
    for _d in ["src","lib","programs","desktop","my-pictures",
               "network-neighborhood","audio","images","font","help"]:
        _p = WIN98_PATH / _d
        if _p.exists():
            app.mount(f"/{_d}", StaticFiles(directory=_p), name=f"win98-{_d}")

@app.get("/win95", response_class=HTMLResponse, include_in_schema=False)
async def serve_win95():
    """Serve the win98-desktop — workspace files live-mounted via /workspace-bfs/."""
    if not WIN98_PATH.exists():
        return HTMLResponse("<h2>win98-desktop not found at " + str(WIN98_PATH) + "</h2>", status_code=404)
    return HTMLResponse(content=(WIN98_PATH / "index.html").read_text(), headers=_NO_CACHE)

@app.get("/classic.css", include_in_schema=False)
async def win98_classic_css():
    return FileResponse(WIN98_PATH / "classic.css")

@app.get("/layout.css", include_in_schema=False)
async def win98_layout_css():
    return FileResponse(WIN98_PATH / "layout.css")

@app.get("/filesystem-index.json", include_in_schema=False)
async def win98_fs_index_dynamic():
    """Merge static win98 index with live /workspace tree so BrowserFS sees both."""
    import json as _json

    # Load static win98 index
    static_index = _json.loads((WIN98_PATH / "filesystem-index.json").read_text())

    # Build live workspace sub-tree
    def live_tree(path: Path, depth: int = 0) -> dict:
        if depth > 5:
            return {}
        result = {}
        skip = {'node_modules', 'venv', 'venv2', '__pycache__', '.git',
                'dist', 'build', '.pytest_cache', 'output', 'data',
                'code-server', 'zig-linux-aarch64-0.14.0', 'win98-desktop',
                'node-v22.13.0-linux-arm64', '.cargo', '.rustup', '.npm', '.nvm'}
        try:
            for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if child.name.startswith('.') or child.name in skip:
                    continue
                if child.is_file():
                    try:
                        if child.stat().st_size > 512 * 1024:
                            continue
                        if child.suffix.lower() in {'.pyc','.db','.sqlite','.jpg','.png',
                            '.gif','.ico','.woff','.woff2','.ttf','.exe','.bin',
                            '.so','.tar','.gz','.xz','.tgz','.zip','.lock'}:
                            continue
                    except OSError:
                        continue
                    result[child.name] = None  # BrowserFS: null = file
                else:
                    sub = live_tree(child, depth + 1)
                    if sub is not None:
                        result[child.name] = sub
        except PermissionError:
            pass
        return result

    workspace_tree = live_tree(WORKSPACE_ROOT)

    # Inject into my-documents/Yamcha's Workspace
    if "my-documents" not in static_index:
        static_index["my-documents"] = {}
    static_index["my-documents"]["Yamcha's Workspace"] = workspace_tree

    return JSONResponse(static_index, headers={"Cache-Control": "no-store"})


@app.get("/download/my-documents/{file_path:path}", include_in_schema=False)
async def download_workspace_file(file_path: str):
    """Serve a workspace file as a browser download (Content-Disposition: attachment)."""
    WORKSPACE_PREFIX = "Yamcha's Workspace/"
    if not file_path.startswith(WORKSPACE_PREFIX):
        raise HTTPException(status_code=404, detail="Only Yamcha's Workspace files can be downloaded")
    rel = file_path[len(WORKSPACE_PREFIX):]
    try:
        p = _safe_path("/workspace/" + rel)
        if not p.exists() or p.is_dir():
            raise HTTPException(status_code=404)
        return FileResponse(
            p,
            filename=p.name,
            headers={"Content-Disposition": f'attachment; filename="{p.name}"'},
        )
    except ValueError:
        raise HTTPException(status_code=403)


@app.get("/my-documents/{file_path:path}", include_in_schema=False)
async def serve_workspace_file(file_path: str):
    """Serve workspace files when BrowserFS requests them via XHR.
    BrowserFS fetches /my-documents/Yamcha's Workspace/SOUL.md →
    we map that to /workspace/SOUL.md.
    """
    from fastapi.responses import PlainTextResponse
    WORKSPACE_PREFIX = "Yamcha's Workspace/"
    if not file_path.startswith(WORKSPACE_PREFIX):
        # Serve static win98 my-documents files
        p = WIN98_PATH / "my-documents" / file_path
        if p.exists() and p.is_file():
            return FileResponse(p)
        raise HTTPException(status_code=404)
    # Strip "Yamcha's Workspace/" prefix and map to /workspace/
    rel = file_path[len(WORKSPACE_PREFIX):]
    try:
        p = _safe_path("/workspace/" + rel)
        if not p.exists() or p.is_dir():
            raise HTTPException(status_code=404)
        content = p.read_text(encoding="utf-8", errors="replace")
        ext = p.suffix.lower().lstrip('.')
        ct = {"py":"text/plain","js":"text/javascript","json":"application/json",
              "html":"text/html","css":"text/css","md":"text/plain",
              "sh":"text/plain","txt":"text/plain"}.get(ext, "text/plain")
        return PlainTextResponse(content, media_type=ct)
    except ValueError:
        raise HTTPException(status_code=403)

import subprocess, sys, platform, shutil as _shutil

WORKSPACE_ROOT = Path("/workspace")

def _safe_path(raw: str) -> Path:
    """Resolve path and ensure it stays within WORKSPACE_ROOT."""
    p = Path(raw).resolve()
    try:
        p.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise ValueError(f"Access denied: {raw}")
    return p

@app.get("/api/win95/ls", include_in_schema=False)
async def win95_ls(path: str = "/workspace"):
    """List directory contents for the Win95 file explorer."""
    try:
        p = _safe_path(path)
        if not p.exists():
            return JSONResponse({"error": f"Path not found: {path}"})
        if not p.is_dir():
            return JSONResponse({"error": f"Not a directory: {path}"})
        entries = []
        for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            try:
                stat = child.stat()
                entries.append({
                    "name": child.name,
                    "type": "dir" if child.is_dir() else "file",
                    "size": stat.st_size if child.is_file() else 0,
                })
            except (PermissionError, OSError):
                pass
        # Build top-level tree (dirs under workspace)
        tree = []
        try:
            tree = sorted([c.name for c in WORKSPACE_ROOT.iterdir() if c.is_dir()], key=str.lower)
        except Exception:
            pass
        return JSONResponse({"entries": entries, "tree": tree})
    except ValueError as e:
        return JSONResponse({"error": str(e)})
    except Exception as e:
        return JSONResponse({"error": str(e)})

@app.get("/api/win95/cat", include_in_schema=False)
async def win95_cat(path: str):
    """Read file contents for the Win95 Notepad."""
    try:
        p = _safe_path(path)
        if not p.exists():
            return JSONResponse({"error": f"File not found: {path}"})
        if p.is_dir():
            return JSONResponse({"error": f"Is a directory: {path}"})
        # Reject huge files
        size = p.stat().st_size
        if size > 512 * 1024:
            return JSONResponse({"error": f"File too large to display ({size//1024} KB)"})
        # Try to read as text
        try:
            content = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return JSONResponse({"error": "Binary file — cannot display as text"})
        return JSONResponse({"content": content, "size": size})
    except ValueError as e:
        return JSONResponse({"error": str(e)})
    except Exception as e:
        return JSONResponse({"error": str(e)})

@app.get("/workspace-bfs/index.json", include_in_schema=False)
async def workspace_bfs_index():
    """BrowserFS-compatible live directory index of /workspace."""
    def build_index(path: Path, depth: int = 0) -> dict | None:
        if path.is_file():
            return None  # BrowserFS uses null for files
        if depth > 4:
            return {}
        result = {}
        try:
            for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if child.name.startswith('.'):
                    continue
                # Skip bulky binary/build dirs
                skip = {'node_modules', 'venv', 'venv2', '__pycache__', '.git',
                        'dist', 'build', '.pytest_cache', 'output', 'data',
                        'code-server', 'zig-linux-aarch64-0.14.0',
                        'node-v22.13.0-linux-arm64', 'win98-desktop'}
                if child.name in skip:
                    continue
                # Skip large binary files
                if child.is_file():
                    try:
                        if child.stat().st_size > 512 * 1024:
                            continue
                        ext = child.suffix.lower()
                        if ext in {'.pyc', '.db', '.sqlite', '.jpg', '.png',
                                   '.gif', '.ico', '.woff', '.woff2', '.ttf',
                                   '.exe', '.bin', '.so', '.tar', '.gz', '.xz',
                                   '.tgz', '.zip', '.lock'}:
                            continue
                    except OSError:
                        continue
                result[child.name] = build_index(child, depth + 1)
        except PermissionError:
            pass
        return result

    index = build_index(WORKSPACE_ROOT)
    return JSONResponse(index, headers={"Access-Control-Allow-Origin": "*"})


@app.get("/workspace-bfs/{path:path}", include_in_schema=False)
async def workspace_bfs_file(path: str):
    """Serve a workspace file for BrowserFS XmlHttpRequest backend."""
    from fastapi.responses import PlainTextResponse
    try:
        p = _safe_path("/workspace/" + path)
        if not p.exists() or p.is_dir():
            return JSONResponse({"error": "not found"}, status_code=404)
        if p.stat().st_size > 512 * 1024:
            return JSONResponse({"error": "too large"}, status_code=413)
        content = p.read_text(encoding="utf-8", errors="replace")
        # Guess content type
        ext = p.suffix.lower()
        ct = {"py": "text/plain", "js": "text/javascript", "json": "application/json",
              "html": "text/html", "css": "text/css", "md": "text/plain",
              "sh": "text/plain", "txt": "text/plain"}.get(ext.lstrip('.'), "text/plain")
        return PlainTextResponse(content, media_type=ct,
                                 headers={"Access-Control-Allow-Origin": "*"})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/win95/sysinfo", include_in_schema=False)
async def win95_sysinfo():
    """Return basic system info for the About dialog."""
    import os as _os
    info = {}
    try: info["hostname"] = platform.node()
    except: pass
    try: info["os"] = platform.system() + " " + platform.release()
    except: pass
    try: info["python"] = sys.version.split()[0]
    except: pass
    info["workspace"] = str(WORKSPACE_ROOT)
    try:
        fc = sum(1 for _ in WORKSPACE_ROOT.iterdir() if _.is_file())
        info["file_count"] = f"{fc} (top-level)"
    except: pass
    try:
        usage = _shutil.disk_usage(str(WORKSPACE_ROOT))
        info["disk_free"] = f"{usage.free // (1024**3)} GB"
    except: pass
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if "MemTotal" in line:
                    kb = int(line.split()[1])
                    info["ram"] = f"{kb // 1024} MB total"
                    break
    except: pass
    try:
        r = subprocess.run(
            ["git", "-C", str(WORKSPACE_ROOT / "semfora-explora"), "branch", "--show-current"],
            capture_output=True, text=True, timeout=3
        )
        info["git_branch"] = r.stdout.strip() or "?"
    except: pass
    return JSONResponse(info)

# ── Serve React frontend (must be last) ──────────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(FRONTEND_DIST / "index.html")
