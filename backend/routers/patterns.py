"""
GET /api/repos/{repo_id}/patterns
Detects classic programming patterns in the call graph.
"""
from fastapi import APIRouter, Query
from db import get_db
from analytics.pattern_detector import detect_all_patterns

router = APIRouter()


@router.get("/api/repos/{repo_id}/patterns")
def get_patterns(
    repo_id: str,
    min_confidence: float = Query(0.60, ge=0.0, le=1.0),
    kinds: str = Query(""),
):
    with get_db(repo_id) as conn:
        results = detect_all_patterns(conn, min_confidence=min_confidence)

    return {
        "repo_id":  repo_id,
        "patterns": results,
        "total_pattern_types": len(results),
        "total_instances": sum(r["count"] for r in results),
    }
