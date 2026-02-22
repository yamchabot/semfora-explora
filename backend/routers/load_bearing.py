from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from db import get_db, read_lb_config, write_lb_config
from queries.load_bearing import fetch_lb_candidates
from analytics.load_bearing import analyze_load_bearing

router = APIRouter()


@router.get("/api/repos/{repo_id}/load-bearing")
def load_bearing(repo_id: str, threshold: int = Query(3, le=50)):
    conn       = get_db(repo_id)
    candidates = fetch_lb_candidates(conn, threshold)
    lb_config  = read_lb_config(repo_id)
    conn.close()
    result = analyze_load_bearing(candidates, lb_config)
    result["threshold_modules"] = threshold
    return result


@router.get("/api/repos/{repo_id}/load-bearing/config")
def get_lb_config(repo_id: str):
    return read_lb_config(repo_id)


class LBDeclareRequest(BaseModel):
    hash:   Optional[str]  = None
    module: Optional[str]  = None
    remove: bool           = False


@router.post("/api/repos/{repo_id}/load-bearing/declare")
def declare_lb(repo_id: str, req: LBDeclareRequest):
    config = read_lb_config(repo_id)
    if req.hash:
        if req.remove:
            config["declared_nodes"] = [h for h in config["declared_nodes"] if h != req.hash]
        elif req.hash not in config["declared_nodes"]:
            config["declared_nodes"].append(req.hash)
    if req.module:
        if req.remove:
            config["declared_modules"] = [m for m in config["declared_modules"] if m != req.module]
        elif req.module not in config["declared_modules"]:
            config["declared_modules"].append(req.module)
    write_lb_config(repo_id, config)
    return {"ok": True, "config": config}
