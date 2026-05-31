import uuid
import json
import threading
from datetime import datetime
from typing import Dict, List, Set, Deque
from collections import deque
from app.celery_app import celery, redis_client
from app.tasks.task_types import execute_shell, execute_python, execute_http
from app.models import WorkflowExecution, TaskExecution
from app.database import SessionLocal, get_db
from sqlalchemy.orm import Session


class WorkflowExecutorV2:
    """
    支持并行度控制的工作流执行器
    使用信号量机制控制最大并行任务数
    """
    
    def __init__(self, workflow_id: int, dag_config: dict, max_parallel_tasks: int = 0):
        self.workflow_id = workflow_id
        self.dag_config = dag_config
        self.max_parallel_tasks = max_parallel_tasks if max_parallel_tasks > 0 else len(dag_config.get('nodes', []))
        
        self.execution_id = str(uuid.uuid4())
        self.nodes: Dict[str, dict] = {node['id']: node for node in dag_config.get('nodes', [])}
        self.edges: List[dict] = dag_config.get('edges', [])
        
        self.in_degree: Dict[str, int] = {}
        self.adj_list: Dict[str, List[str]] = {}
        self._build_graph()
        
        self.waiting_queue: Deque[str] = deque()
        self.running_tasks: Set[str] = set()
        self.completed_tasks: Set[str] = set()
        self.failed_tasks: Set[str] = set()
        
        self._lock = threading.Lock()
        
    def _build_graph(self):
        """构建有向无环图"""
        for node_id in self.nodes:
            self.in_degree[node_id] = 0
            self.adj_list[node_id] = []
        
        for edge in self.edges:
            source = edge['source']
            target = edge['target']
            if source in self.adj_list and target in self.in_degree:
                self.adj_list[source].append(target)
                self.in_degree[target] += 1
    
    def _get_ready_tasks(self) -> List[str]:
        """获取所有就绪的任务（入度为0且未执行）"""
        ready = []
        for node_id in self.nodes:
            if node_id in self.completed_tasks:
                continue
            if node_id in self.running_tasks:
                continue
            if node_id in self.waiting_queue:
                continue
            
            deps_count = sum(1 for edge in self.edges 
                             if edge['target'] == node_id 
                             and edge['source'] not in self.completed_tasks)
            if deps_count == 0:
                ready.append(node_id)
        return ready
    
    def _create_task_execution(self, db: Session, workflow_exec_id: int, node_id: str, task_id: str) -> TaskExecution:
        """创建任务执行记录"""
        node = self.nodes[node_id]
        execution = TaskExecution(
            workflow_execution_id=workflow_exec_id,
            node_id=node_id,
            task_id=task_id,
            task_name=node.get('label', ''),
            task_type=node.get('config', {}).get('type', ''),
            status='PENDING'
        )
        db.add(execution)
        db.commit()
        return execution
    
    def _execute_task(self, node_id: str, workflow_exec_id: int) -> str:
        """执行单个任务"""
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
    
    def _save_state(self):
        """保存执行状态到Redis"""
        state = {
            'workflow_id': self.workflow_id,
            'execution_id': self.execution_id,
            'max_parallel_tasks': self.max_parallel_tasks,
            'waiting_queue': list(self.waiting_queue),
            'running_tasks': list(self.running_tasks),
            'completed_tasks': list(self.completed_tasks),
            'failed_tasks': list(self.failed_tasks),
            'in_degree': self.in_degree,
        }
        redis_client.set(f"execution_state:{self.execution_id}", json.dumps(state))
    
    def _load_state(self):
        """从Redis加载执行状态"""
        data = redis_client.get(f"execution_state:{self.execution_id}")
        if data:
            state = json.loads(data)
            self.waiting_queue = deque(state.get('waiting_queue', []))
            self.running_tasks = set(state.get('running_tasks', []))
            self.completed_tasks = set(state.get('completed_tasks', []))
            self.failed_tasks = set(state.get('failed_tasks', []))
            self.in_degree = state.get('in_degree', {})
    
    def _dispatch_tasks(self, workflow_exec_id: int) -> int:
        """
        调度任务：根据并行度从等待队列中取出任务执行
        返回实际调度的任务数
        """
        dispatched = 0
        available_slots = self.max_parallel_tasks - len(self.running_tasks)
        
        while available_slots > 0 and self.waiting_queue:
            node_id = self.waiting_queue.popleft()
            task_id = self._execute_task(node_id, workflow_exec_id)
            self.running_tasks.add(node_id)
            available_slots -= 1
            dispatched += 1
            print(f"[Workflow {self.execution_id}] 调度任务: {node_id} -> {task_id}")
        
        return dispatched
    
    def execute(self) -> str:
        """启动工作流执行"""
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
            
            ready_tasks = self._get_ready_tasks()
            for node_id in ready_tasks:
                self.waiting_queue.append(node_id)
            
            print(f"[Workflow {self.execution_id}] 初始就绪任务数: {len(self.waiting_queue)}")
            print(f"[Workflow {self.execution_id}] 最大并行度: {self.max_parallel_tasks}")
            
            self._dispatch_tasks(workflow_exec_id)
            self._save_state()
            
            return self.execution_id
        finally:
            db.close()
    
    def check_and_schedule(self) -> bool:
        """
        检查任务状态并调度下一批任务
        返回是否还有任务在执行或等待
        """
        self._load_state()
        
        db = SessionLocal()
        try:
            workflow_exec = db.query(WorkflowExecution).filter(
                WorkflowExecution.execution_id == self.execution_id
            ).first()
            if not workflow_exec:
                return False
            
            workflow_exec_id = workflow_exec.id
            
            completed_in_this_round = []
            
            for node_id in list(self.running_tasks):
                task_exec = db.query(TaskExecution).filter(
                    TaskExecution.workflow_execution_id == workflow_exec_id,
                    TaskExecution.node_id == node_id
                ).first()
                
                if task_exec:
                    result = celery.AsyncResult(task_exec.task_id)
                    
                    if result.ready():
                        self.running_tasks.remove(node_id)
                        if result.successful():
                            self.completed_tasks.add(node_id)
                            task_exec.status = 'SUCCESS'
                            completed_in_this_round.append(node_id)
                            print(f"[Workflow {self.execution_id}] 任务完成: {node_id}")
                        else:
                            self.failed_tasks.add(node_id)
                            task_exec.status = 'FAILURE'
                            print(f"[Workflow {self.execution_id}] 任务失败: {node_id}")
                        
                        if result.result:
                            task_exec.result = json.dumps(result.result)
                        task_exec.end_time = datetime.utcnow()
                        db.commit()
            
            for completed_node in completed_in_this_round:
                for neighbor in self.adj_list.get(completed_node, []):
                    self.in_degree[neighbor] -= 1
                    if self.in_degree[neighbor] == 0:
                        if neighbor not in self.completed_tasks and \
                           neighbor not in self.running_tasks and \
                           neighbor not in self.waiting_queue:
                            self.waiting_queue.append(neighbor)
                            print(f"[Workflow {self.execution_id}] 任务进入等待队列: {neighbor}")
            
            dispatched = self._dispatch_tasks(workflow_exec_id)
            if dispatched > 0:
                print(f"[Workflow {self.execution_id}] 本轮调度任务数: {dispatched}, 等待队列剩余: {len(self.waiting_queue)}")
            
            all_done = len(self.running_tasks) == 0 and len(self.waiting_queue) == 0
            
            if all_done:
                workflow_exec.end_time = datetime.utcnow()
                if len(self.failed_tasks) > 0:
                    workflow_exec.status = 'FAILURE'
                else:
                    workflow_exec.status = 'COMPLETED'
                db.commit()
                print(f"[Workflow {self.execution_id}] 工作流执行完成: {workflow_exec.status}")
                redis_client.delete(f"execution_state:{self.execution_id}")
                return False
            
            self._save_state()
            return True
            
        finally:
            db.close()


def get_executor_state(execution_id: str) -> dict:
    """获取执行器状态"""
    data = redis_client.get(f"execution_state:{execution_id}")
    if data:
        return json.loads(data)
    return None


def check_execution_progress(execution_id: str) -> bool:
    """检查执行进度并继续调度任务"""
    state = get_executor_state(execution_id)
    if not state:
        return False
    
    db = SessionLocal()
    try:
        workflow_exec = db.query(WorkflowExecution).filter(
            WorkflowExecution.execution_id == execution_id
        ).first()
        if not workflow_exec:
            return False
        
        workflow = db.query(Workflow).filter(
            Workflow.id == workflow_exec.workflow_id
        ).first()
        if not workflow:
            return False
        
        executor = WorkflowExecutorV2(
            workflow.id,
            workflow.dag_config,
            state.get('max_parallel_tasks', 0)
        )
        executor.execution_id = execution_id
        executor._load_state()
        
        return executor.check_and_schedule()
    finally:
        db.close()
