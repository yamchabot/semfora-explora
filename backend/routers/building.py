from fastapi import APIRouter, Query
from pydantic import BaseModel

from db import get_db, read_lb_config
from queries.building import fetch_building_data, fetch_diff_building_data
from analytics.building import assign_layers, compute_diff_building

router = APIRouter()


@router.get("/api/repos/{repo_id}/building")
def building_view(repo_id: str, max_nodes: int = Query(120, le=300)):
    conn = get_db(repo_id)
    data      = fetch_building_data(conn, max_nodes)
    lb_config = read_lb_config(repo_id)
    conn.close()
    return assign_layers(data["nodes"], data["edges"], lb_config)


class DiffRequest(BaseModel):
    repo_a: str
    repo_b: str


@router.post("/api/diff-building")
def diff_building(req: DiffRequest, max_nodes: int = Query(120, le=300)):
    conn_a = get_db(req.repo_a)
    conn_b = get_db(req.repo_b)
    data_a    = fetch_diff_building_data(conn_a, max_nodes)
    data_b    = fetch_diff_building_data(conn_b, max_nodes)
    lb_config = read_lb_config(req.repo_b.split("@")[0])
    conn_a.close()
    conn_b.close()
    return compute_diff_building(
        data_a["nodes"], data_b["nodes"],
        data_a["edges"], data_b["edges"],
        lb_config,
    )
