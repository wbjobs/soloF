from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from app.database import engine, get_db, Base
from app.models import Workflow, WorkflowExecution, TaskExecution
from app.schemas import (
    WorkflowCreate, WorkflowUpdate, WorkflowResponse,
    WorkflowExecutionResponse, ExecuteRequest
)
from app.workflow_executor import WorkflowExecutor, check_and_schedule_next_tasks
from app.workflow_executor_v2 import WorkflowExecutorV2, check_execution_progress, get_executor_state
from app.celery_app import celery, redis_client
from app.dag_validator import validate_workflow_dag
import json

Base.metadata.create_all(bind=engine)

app = FastAPI(title="分布式任务调度系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "分布式任务调度系统 API"}

@app.post("/workflows", response_model=WorkflowResponse)
def create_workflow(workflow: WorkflowCreate, db: Session = Depends(get_db)):
    result = validate_workflow_dag(workflow.dag_config)
    if result.has_cycle:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "循环依赖检测失败",
                "message": result.message,
                "cycle_path": result.cycle_path
            }
        )
    
    db_workflow = Workflow(
        name=workflow.name,
        description=workflow.description,
        dag_config=workflow.dag_config.model_dump(),
        schedule=workflow.schedule
    )
    db.add(db_workflow)
    db.commit()
    db.refresh(db_workflow)
    return db_workflow

@app.get("/workflows", response_model=List[WorkflowResponse])
def list_workflows(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    workflows = db.query(Workflow).offset(skip).limit(limit).all()
    return workflows

@app.get("/workflows/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow

@app.put("/workflows/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(workflow_id: int, workflow_update: WorkflowUpdate, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    if workflow_update.dag_config:
        result = validate_workflow_dag(workflow_update.dag_config)
        if result.has_cycle:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "循环依赖检测失败",
                    "message": result.message,
                    "cycle_path": result.cycle_path
                }
            )
    
    update_data = workflow_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == 'dag_config' and value:
            value = value.model_dump()
        setattr(workflow, key, value)
    
    workflow.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(workflow)
    return workflow

@app.delete("/workflows/{workflow_id}")
def delete_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(workflow)
    db.commit()
    return {"message": "Workflow deleted"}

@app.post("/execute")
def execute_workflow(request: ExecuteRequest, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == request.workflow_id).first()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    from app.schemas import DAGConfig
    dag_config = DAGConfig(**workflow.dag_config)
    result = validate_workflow_dag(dag_config)
    if result.has_cycle:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "循环依赖检测失败",
                "message": result.message,
                "cycle_path": result.cycle_path
            }
        )
    
    max_parallel_tasks = workflow.dag_config.get('max_parallel_tasks', 0)
    executor = WorkflowExecutorV2(workflow.id, workflow.dag_config, max_parallel_tasks)
    execution_id = executor.execute()
    
    return {
        "execution_id": execution_id, 
        "status": "started",
        "max_parallel_tasks": executor.max_parallel_tasks
    }

@app.get("/executions", response_model=List[WorkflowExecutionResponse])
def list_executions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    executions = db.query(WorkflowExecution).order_by(WorkflowExecution.created_at.desc()).offset(skip).limit(limit).all()
    return executions

@app.get("/executions/{execution_id}", response_model=WorkflowExecutionResponse)
def get_execution(execution_id: str, db: Session = Depends(get_db)):
    execution = db.query(WorkflowExecution).filter(WorkflowExecution.execution_id == execution_id).first()
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    
    check_execution_progress(execution_id)
    
    db.refresh(execution)
    return execution


@app.get("/executions/{execution_id}/state")
def get_execution_state(execution_id: str):
    """获取执行器内部状态（并行度、运行中任务、等待队列等）"""
    state = get_executor_state(execution_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Execution state not found")
    return {
        "execution_id": execution_id,
        "max_parallel_tasks": state.get("max_parallel_tasks", 0),
        "running_tasks": state.get("running_tasks", []),
        "waiting_queue": state.get("waiting_queue", []),
        "completed_tasks": state.get("completed_tasks", []),
        "failed_tasks": state.get("failed_tasks", []),
        "in_degree": state.get("in_degree", {})
    }


@app.post("/executions/{execution_id}/poll")
def poll_execution(execution_id: str):
    """主动触发任务调度轮询"""
    has_more = check_execution_progress(execution_id)
    state = get_executor_state(execution_id)
    return {
        "execution_id": execution_id,
        "has_more": has_more,
        "state": state
    }

@app.get("/executions/{execution_id}/tasks")
def get_execution_tasks(execution_id: str, db: Session = Depends(get_db)):
    execution = db.query(WorkflowExecution).filter(WorkflowExecution.execution_id == execution_id).first()
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    
    tasks = db.query(TaskExecution).filter(TaskExecution.workflow_execution_id == execution.id).all()
    
    for task in tasks:
        result = celery.AsyncResult(task.task_id)
        task.status = result.state
        if result.ready() and result.result:
            task.result = json.dumps(result.result)
    
    db.commit()
    return tasks

@app.get("/tasks/{task_id}/status")
def get_task_status(task_id: str):
    result = celery.AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": result.state,
        "result": result.result if result.ready() else None
    }

@app.get("/health")
def health_check():
    try:
        redis_client.ping()
        return {"status": "healthy", "redis": "connected", "celery": "configured"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unavailable: {str(e)}")