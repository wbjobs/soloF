import os
import logging
import asyncio
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks

from schemas import WebhookPayload, BuildRequest, BuildResponse, TaskInfo, TaskListResponse
from neo4j_client import Neo4jClient
from task_manager import task_manager
from extractor import run_extraction_async

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/git-push")
async def git_push_webhook(payload: WebhookPayload, request: Request, background_tasks: BackgroundTasks):
    event_type = request.headers.get("X-GitHub-Event", "push")
    if event_type != "push":
        return {"status": "ignored", "reason": f"Event type '{event_type}' not handled"}

    repo_name = payload.repository.get("full_name", "unknown")
    ref = payload.ref or ""
    branch = ref.replace("refs/heads/", "") if ref else "main"

    repo_url = payload.repository.get("ssh_url") or payload.repository.get("clone_url")
    repo_path = os.path.join(settings.REPOS_DIR, repo_name.replace("/", "_"))

    commit_count = len(payload.commits)
    logger.info(f"Received push event for {repo_name}, branch: {branch}, commits: {commit_count}")

    task = task_manager.create_task(repo_path, branch)

    background_tasks.add_task(
        run_extraction_async,
        task.task_id,
        repo_path,
        task_manager
    )

    return BuildResponse(
        task_id=task.task_id,
        status="queued",
        message=f"分析任务已排队，共 {commit_count} 个提交。通过 WebSocket /ws/tasks/{task.task_id} 获取实时进度"
    )


@router.post("/build", response_model=BuildResponse)
async def build_graph(request: BuildRequest, background_tasks: BackgroundTasks):
    repo_path = os.path.abspath(request.repo_path)

    if not os.path.exists(repo_path):
        raise HTTPException(status_code=400, detail=f"Repository path not found: {repo_path}")

    Neo4jClient.clear_graph()

    task = task_manager.create_task(repo_path, request.branch)

    background_tasks.add_task(
        run_extraction_async,
        task.task_id,
        repo_path,
        task_manager
    )

    return BuildResponse(
        task_id=task.task_id,
        status="queued",
        message=f"分析任务已排队。通过 WebSocket /ws/tasks/{task.task_id} 获取实时进度"
    )


@router.post("/clear")
async def clear_graph():
    Neo4jClient.clear_graph()
    return {"status": "cleared"}


from config import settings
