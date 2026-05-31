from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class NodeConfig(BaseModel):
    type: str
    script: Optional[str] = None
    url: Optional[str] = None
    method: Optional[str] = "GET"
    headers: Optional[Dict[str, str]] = None
    body: Optional[Dict[str, Any]] = None

class Node(BaseModel):
    id: str
    label: str
    x: int
    y: int
    config: NodeConfig

class Edge(BaseModel):
    id: str
    source: str
    target: str

class DAGConfig(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    max_parallel_tasks: Optional[int] = 0

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    dag_config: DAGConfig
    schedule: Optional[str] = None

class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    dag_config: Optional[DAGConfig] = None
    schedule: Optional[str] = None
    is_active: Optional[int] = None

class WorkflowResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    dag_config: DAGConfig
    schedule: Optional[str]
    is_active: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class TaskExecutionResponse(BaseModel):
    id: int
    node_id: str
    task_id: str
    task_name: Optional[str]
    task_type: Optional[str]
    status: str
    result: Optional[str]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    retry_count: int
    
    class Config:
        from_attributes = True

class WorkflowExecutionResponse(BaseModel):
    id: int
    workflow_id: int
    execution_id: str
    status: str
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    created_at: datetime
    tasks: List[TaskExecutionResponse]
    
    class Config:
        from_attributes = True

class ExecuteRequest(BaseModel):
    workflow_id: int