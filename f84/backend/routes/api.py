import logging
import os
from fastapi import APIRouter, HTTPException, Query

from schemas import (
    ReferenceResponse, CycleCheckResponse, ImpactResponse,
    GraphStats, TaskInfo, TaskListResponse,
    PredictionResponse, TrainingResult, TrainRequest
)
from neo4j_client import Neo4jClient
from task_manager import task_manager
from git_analyzer import get_or_create_predictor, clear_predictor_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["api"])


@router.get("/files")
async def list_files():
    files = Neo4jClient.get_all_files()
    return {"files": files, "total": len(files)}


@router.get("/files/{file_path:path}/references", response_model=ReferenceResponse)
async def get_file_references(
    file_path: str,
    recursive: bool = Query(default=False, description="Include transitive references")
):
    if recursive:
        refs = Neo4jClient.get_references_recursive(file_path)
        return ReferenceResponse(
            file=file_path,
            references=refs,
            total=len(refs)
        )
    else:
        refs = Neo4jClient.get_references(file_path)
        all_refs = []
        for r in refs:
            all_refs.append({
                "file": r["file"],
                "references": r["references"]
            })
        return ReferenceResponse(
            file=file_path,
            references=all_refs,
            total=len(all_refs)
        )


@router.get("/files/{file_path:path}/impact", response_model=ImpactResponse)
async def get_file_impact(file_path: str):
    impact = Neo4jClient.get_impact_analysis(file_path)
    return ImpactResponse(
        deleted_file=file_path,
        directly_impacted=impact["directly_impacted"],
        transitively_impacted=impact["transitively_impacted"],
        total_impacted=impact["total_impacted"]
    )


@router.get("/check-cycle", response_model=CycleCheckResponse)
async def check_cycle(
    file_a: str = Query(..., description="First file path"),
    file_b: str = Query(..., description="Second file path")
):
    result = Neo4jClient.check_cycle(file_a, file_b)
    cycle_path = []
    if result["has_cycle"]:
        cycle_path = result["path_a_to_b"] + result["path_b_to_a"][1:]
    return CycleCheckResponse(
        file_a=file_a,
        file_b=file_b,
        has_cycle=result["has_cycle"],
        cycle_path=cycle_path
    )


@router.get("/graph")
async def get_graph_data():
    return Neo4jClient.get_graph_data()


@router.get("/stats", response_model=GraphStats)
async def get_stats():
    stats = Neo4jClient.get_stats()
    return GraphStats(**stats)


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200)
):
    tasks = task_manager.list_tasks(skip=skip, limit=limit)
    total = task_manager.count_tasks()
    return TaskListResponse(
        tasks=tasks,
        total=total
    )


@router.get("/tasks/{task_id}", response_model=TaskInfo)
async def get_task(task_id: str):
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found")
    return task


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    success = task_manager.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="无法取消任务（已完成/失败/不存在")
    return {"task_id": task_id, "status": "cancelled", "message": "任务已取消"}


@router.post("/predict/train", response_model=TrainingResult)
async def train_prediction_model(request: TrainRequest):
    repo_path = os.path.abspath(request.repo_path)

    if not os.path.exists(repo_path):
        raise HTTPException(status_code=400, detail=f"Repository path not found: {repo_path}")

    try:
        analyzer = get_or_create_predictor(repo_path)
        result = analyzer.train_model(branch=request.branch, max_commits=request.max_commits)
        return result
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"GitPython not installed: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error training prediction model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predict/{file_path:path}", response_model=PredictionResponse)
async def predict_affected_files(
    file_path: str,
    repo_path: str = Query(..., description="Repository path"),
    top_n: int = Query(default=5, ge=1, le=20, description="Number of predictions to return"),
    use_dependency_graph: bool = Query(default=True, description="Combine with dependency graph")
):
    abs_repo_path = os.path.abspath(repo_path)

    if not os.path.exists(abs_repo_path):
        raise HTTPException(status_code=400, detail=f"Repository path not found: {abs_repo_path}")

    try:
        analyzer = get_or_create_predictor(abs_repo_path)

        if not analyzer.predictor.is_trained:
            raise HTTPException(
                status_code=400,
                detail="Model not trained. Call POST /api/predict/train first."
            )

        if use_dependency_graph:
            predictions = analyzer.predict_affected_files(
                file_path, top_n=top_n, neo4j_client=Neo4jClient
            )
        else:
            predictions = analyzer.get_prediction(file_path, top_n=top_n)

        return predictions
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error predicting affected files: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predict/model/status")
async def get_model_status(repo_path: str = Query(..., description="Repository path")):
    abs_repo_path = os.path.abspath(repo_path)
    analyzer = get_or_create_predictor(abs_repo_path)

    return {
        "repo_path": abs_repo_path,
        "is_trained": analyzer.predictor.is_trained,
        "total_commits": analyzer.predictor.total_commits,
        "total_files": analyzer.predictor.total_files,
        "total_co_change_patterns": sum(
            len(c) for c in analyzer.predictor.co_change_count.values()
        ) // 2 if analyzer.predictor.is_trained else 0
    }


@router.get("/predict/patterns")
async def get_co_change_patterns(
    repo_path: str = Query(..., description="Repository path"),
    min_count: int = Query(default=2, ge=1, description="Minimum co-change count"),
    limit: int = Query(default=100, ge=1, le=1000, description="Maximum patterns to return")
):
    abs_repo_path = os.path.abspath(repo_path)
    analyzer = get_or_create_predictor(abs_repo_path)

    if not analyzer.predictor.is_trained:
        raise HTTPException(
            status_code=400,
            detail="Model not trained. Call POST /api/predict/train first."
        )

    patterns = analyzer.predictor.get_co_change_patterns(min_count=min_count)
    return {
        "patterns": patterns[:limit],
        "total": len(patterns),
        "min_count": min_count
    }


@router.post("/predict/cache/clear")
async def clear_predictor_cache_endpoint():
    clear_predictor_cache()
    return {"status": "cleared", "message": "Predictor cache cleared"}
