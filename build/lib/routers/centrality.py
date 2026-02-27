from fastapi import APIRouter, HTTPException, Query

from db import get_db
from queries.centrality import fetch_graph_for_centrality, fetch_blast_radius_data
from analytics.centrality import compute_centrality, compute_blast_radius

router = APIRouter()


@router.get("/api/repos/{repo_id}/centrality")
def centrality(repo_id: str, top_n: int = Query(30, le=100)):
    conn = get_db(repo_id)
    nodes, edges = fetch_graph_for_centrality(conn)
    conn.close()
    return {"nodes": compute_centrality(nodes, edges, top_n)}


@router.get("/api/repos/{repo_id}/blast-radius/{node_hash}")
def blast_radius(repo_id: str, node_hash: str, max_depth: int = Query(5, le=10)):
    conn = get_db(repo_id)
    target, reverse_adj, all_nodes = fetch_blast_radius_data(conn, node_hash)
    conn.close()
    if not target:
        raise HTTPException(status_code=404, detail="Node not found")
    return compute_blast_radius(node_hash, target, reverse_adj, all_nodes, max_depth)
