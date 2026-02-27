"""
GitHub repo import — clone, index, export, enrich in a background thread.

Endpoints:
  POST /api/import          { "url": "https://github.com/owner/repo" }
  GET  /api/import/{job_id}  → { job_id, status, message, progress, repo_id }

Status progression:  queued → cloning → indexing → exporting → enriching → done
                     (any step can transition to "error")
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# In-memory job store (process lifetime; fine for a dev tool)
jobs: dict[str, dict] = {}

# ── Constants ─────────────────────────────────────────────────────────────────
SEMFORA_ENGINE = Path("/workspace/semfora-engine/target/release/semfora-engine")
BACKEND_DIR    = Path(__file__).parent.parent
DATA_DIR       = BACKEND_DIR.parent / "data"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_github_url(url: str) -> tuple[str, str, str | None]:
    """
    Parse a GitHub URL and return (owner, repo_name, ref_or_None).

    Accepted forms:
      https://github.com/owner/repo
      https://github.com/owner/repo.git
      https://github.com/owner/repo/tree/branch-or-tag
      https://github.com/owner/repo/commit/sha
    """
    url = url.strip().rstrip("/")
    m = re.match(
        r"https?://github\.com/([^/]+)/([^/\s]+?)"
        r"(?:\.git)?(?:/(?:tree|commit|blob)/([^/\s]+))?$",
        url,
    )
    if not m:
        raise ValueError(
            f"Unrecognised GitHub URL: {url!r}\n"
            "Expected: https://github.com/owner/repo  (optionally /tree/branch)"
        )
    owner = m.group(1)
    repo  = m.group(2)
    ref   = m.group(3)   # None, or a branch/tag/commit sha
    return owner, repo, ref


def _run_import(job_id: str, url: str) -> None:
    def upd(status: str, message: str, progress: int = 0) -> None:
        jobs[job_id].update({"status": status, "message": message, "progress": progress})

    tmpdir: str | None = None
    try:
        owner, repo, ref = _parse_github_url(url)

        # Derive a stable repo_id (used as the DB filename stem)
        tag    = ref or "HEAD"
        tag    = tag[:12] if len(tag) == 40 else tag   # shorten full SHAs
        repo_id = f"{repo}@{tag}"
        db_path = DATA_DIR / f"{repo_id}.db"

        jobs[job_id]["repo_id"] = repo_id

        # ── Step 1: Clone ──────────────────────────────────────────────────
        upd("cloning", f"Cloning {owner}/{repo}…", 10)
        tmpdir = tempfile.mkdtemp(prefix="semfora_import_")

        clone_cmd = ["git", "clone", "--depth=1"]
        # Only pass --branch for branch/tag refs, not for commit SHAs
        if ref and not re.fullmatch(r"[0-9a-f]{7,40}", ref):
            clone_cmd += ["--branch", ref]
        clone_cmd += [f"https://github.com/{owner}/{repo}.git", tmpdir]

        res = subprocess.run(clone_cmd, capture_output=True, text=True, timeout=180)
        if res.returncode != 0:
            raise RuntimeError(f"git clone failed:\n{res.stderr[-400:]}")

        # For commit SHAs we can't pass --branch; fetch the commit explicitly
        if ref and re.fullmatch(r"[0-9a-f]{7,40}", ref):
            subprocess.run(
                ["git", "fetch", "--depth=1", "origin", ref],
                cwd=tmpdir, capture_output=True, timeout=60,
            )
            subprocess.run(
                ["git", "checkout", ref],
                cwd=tmpdir, capture_output=True, timeout=30,
            )

        # ── Step 2: Generate semantic index ───────────────────────────────
        upd("indexing", "Generating semantic index…", 35)
        res = subprocess.run(
            [str(SEMFORA_ENGINE), "index", "generate", tmpdir],
            capture_output=True, text=True, timeout=600, cwd=tmpdir,
        )
        if res.returncode != 0:
            raise RuntimeError(f"Index generation failed:\n{res.stderr[-400:]}")

        # ── Step 3: Export to SQLite ───────────────────────────────────────
        upd("exporting", "Exporting to SQLite…", 65)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        res = subprocess.run(
            [str(SEMFORA_ENGINE), "index", "export", str(db_path)],
            capture_output=True, text=True, timeout=180, cwd=tmpdir,
        )
        if res.returncode != 0:
            raise RuntimeError(f"Export failed:\n{res.stderr[-400:]}")

        if not db_path.exists():
            raise RuntimeError("Export command succeeded but no .db file was created.")

        # ── Step 4: Enrich ─────────────────────────────────────────────────
        upd("enriching", "Running enrichment analysis…", 80)
        res = subprocess.run(
            ["python3", str(BACKEND_DIR / "enrich.py"), str(db_path)],
            capture_output=True, text=True, timeout=600,
        )
        if res.returncode != 0:
            # Enrichment failure is non-fatal — base DB is still usable
            jobs[job_id]["enrich_warning"] = res.stderr[-200:]

        upd("done", f"Import complete — {repo_id}", 100)

    except Exception as exc:
        jobs[job_id].update({"status": "error", "message": str(exc)})
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


# ── Endpoints ─────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    url: str


@router.post("/api/import")
def start_import(req: ImportRequest):
    """Kick off an async import job and return a job_id to poll."""
    # Basic URL validation before starting the thread
    try:
        _parse_github_url(req.url)
    except ValueError as exc:
        return {"error": str(exc)}

    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {
        "status":   "queued",
        "message":  "Job queued…",
        "progress": 0,
        "repo_id":  None,
    }
    thread = threading.Thread(
        target=_run_import, args=(job_id, req.url), daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}


@router.get("/api/import/{job_id}")
def get_import_status(job_id: str):
    """Poll a running import job."""
    if job_id not in jobs:
        return {"status": "not_found", "message": "Unknown job ID"}
    return {"job_id": job_id, **jobs[job_id]}
