import uuid
from datetime import datetime
from typing import Dict, List, Set
from collections import deque
from app.celery_app import celery, redis_client
from app.tasks.task_types import execute_shell, execute_python, execute_http
from app.models import WorkflowExecution, TaskExecution
from app.database import SessionLocal
import json

class WorkflowExecutor:
    def __init__(self, workflow_id: int, dag_config: dict):
        self.workflow_id = workflow_id
        self.dag_config = dag_config
        self.execution_id = str(uuid.uuid4())
        self.nodes: Dict[str, dict] = {node['id']: node for node in dag_config['nodes']}
        self.edges: List[dict] = dag_config['edges']
        self.in_degree: Dict[str, int] = {}
        self.adj_list: Dict[str, List[str]] = {}
        self._build_graph()
    
    def _build_graph(self):
        for node_id in self.nodes:
            self.in_degree[node_id] = 0
            self.adj_list[node_id] = []
        
        for edge in self.edges:
            source = edge['source']
            target = edge['target']
            self.adj_list[source].append(target)
            self.in_degree[target] += 1
    
    def _get_ready_tasks(self, completed_tasks: Set[str]) -> List[str]:
        ready = []
        for node_id in self.nodes:
            if node_id in completed_tasks:
                continue
            deps_count = sum(1 for edge in self.edges if edge['target'] == node_id and edge['source'] not in completed_tasks)
            if deps_count == 0:
                ready.append(node_id)
        return ready
    
    def _create_task_execution(self, db, workflow_exec_id: int, node_id: str, task_id: str):
        node = self.nodes[node_id]
        execution = TaskExecution(
            workflow_execution_id=workflow_exec_id,
            node_id=node_id,
            task_id=task_id,
            task_name=node.get('label'),
            task_type=node.get('config', {}).get('type'),
            status='PENDING'
        )
        db.add(execution)
        db.commit()
        return execution
    
    def _execute_task(self, node_id: str, workflow_exec_id: int):
        node = self.nodes[node_id]
        config = node.get('config', {})
        task_type = config.get('type')
        
        task_id = str(uuid.uuid4())
        
        db = SessionLocal()
        try:
            self._create_task_execution(db, workflow_exec_id, node_id, task_id)
        finally:
            db.close()
        
        if task_type == 'shell':
            script = config.get('script', '')
            task = execute_shell.apply_async(args=[script], task_id=task_id)
        elif task_type == 'python':
            script = config.get('script', '')
            task = execute_python.apply_async(args=[script], task_id=task_id)
        elif task_type == 'http':
            url = config.get('url', '')
            method = config.get('method', 'GET')
            headers = config.get('headers')
            body = config.get('body')
            task = execute_http.apply_async(args=[url, method, headers, body], task_id=task_id)
        else:
            raise ValueError(f"Unknown task type: {task_type}")
        
        return task_id
    
    def execute(self):
        db = SessionLocal()
        try:
            workflow_exec = WorkflowExecution(
                workflow_id=self.workflow_id,
                execution_id=self.execution_id,
                status='RUNNING',
                start_time=datetime.utcnow()
            )
            db.add(workflow_exec)
            db.commit()
            db.refresh(workflow_exec)
            workflow_exec_id = workflow_exec.id
            
            execution_data = {
                'workflow_id': self.workflow_id,
                'execution_id': self.execution_id,
                'workflow_exec_id': workflow_exec_id,
                'dag_config': self.dag_config,
                'completed_tasks': [],
                'pending_tasks': [],
                'status': 'RUNNING'
            }
            redis_client.set(f"execution:{self.execution_id}", json.dumps(execution_data))
            
            ready_tasks = self._get_ready_tasks(set())
            for node_id in ready_tasks:
                task_id = self._execute_task(node_id, workflow_exec_id)
                execution_data['pending_tasks'].append({'node_id': node_id, 'task_id': task_id})
            
            redis_client.set(f"execution:{self.execution_id}", json.dumps(execution_data))
            
            return self.execution_id
        finally:
            db.close()

def check_and_schedule_next_tasks(execution_id: str):
    data = redis_client.get(f"execution:{execution_id}")
    if not data:
        return
    
    exec_data = json.loads(data)
    dag_config = exec_data['dag_config']
    completed_tasks = set(exec_data['completed_tasks'])
    workflow_exec_id = exec_data['workflow_exec_id']
    
    nodes: Dict[str, dict] = {node['id']: node for node in dag_config['nodes']}
    edges: List[dict] = dag_config['edges']
    
    pending_node_ids = [t['node_id'] for t in exec_data['pending_tasks']]
    all_completed = True
    
    for pending in exec_data['pending_tasks']:
        task_id = pending['task_id']
        result = celery.AsyncResult(task_id)
        
        if result.ready():
            if result.successful():
                completed_tasks.add(pending['node_id'])
            else:
                pass
        else:
            all_completed = False
    
    exec_data['completed_tasks'] = list(completed_tasks)
    exec_data['pending_tasks'] = [t for t in exec_data['pending_tasks'] if t['node_id'] not in completed_tasks]
    
    for node_id in nodes:
        if node_id in completed_tasks:
            continue
        if node_id in pending_node_ids:
            continue
        
        deps_count = sum(1 for edge in edges if edge['target'] == node_id and edge['source'] not in completed_tasks)
        if deps_count == 0:
            task_id = _execute_task_internal(node_id, workflow_exec_id, nodes[node_id])
            exec_data['pending_tasks'].append({'node_id': node_id, 'task_id': task_id})
            all_completed = False
    
    if all_completed and len(exec_data['pending_tasks']) == 0:
        exec_data['status'] = 'COMPLETED'
        db = SessionLocal()
        try:
            workflow_exec = db.query(WorkflowExecution).filter(WorkflowExecution.execution_id == execution_id).first()
            if workflow_exec:
                workflow_exec.status = 'COMPLETED'
                workflow_exec.end_time = datetime.utcnow()
                db.commit()
        finally:
            db.close()
    
    redis_client.set(f"execution:{execution_id}", json.dumps(exec_data))

def _execute_task_internal(node_id: str, workflow_exec_id: int, node: dict) -> str:
    config = node.get('config', {})
    task_type = config.get('type')
    task_id = str(uuid.uuid4())
    
    db = SessionLocal()
    try:
        execution = TaskExecution(
            workflow_execution_id=workflow_exec_id,
            node_id=node_id,
            task_id=task_id,
            task_name=node.get('label'),
            task_type=task_type,
            status='PENDING'
        )
        db.add(execution)
        db.commit()
    finally:
        db.close()
    
    if task_type == 'shell':
        execute_shell.apply_async(args=[config.get('script', '')], task_id=task_id)
    elif task_type == 'python':
        execute_python.apply_async(args=[config.get('script', '')], task_id=task_id)
    elif task_type == 'http':
        execute_http.apply_async(
            args=[config.get('url', ''), config.get('method', 'GET'), config.get('headers'), config.get('body')],
            task_id=task_id
        )
    
    return task_id