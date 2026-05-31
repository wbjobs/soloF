import asyncio
import uuid
import threading
from datetime import datetime
from typing import Callable, Optional, Dict, Any
from collections import OrderedDict

from schemas import TaskInfo, TaskProgress, TaskStatus


class AsyncTaskManager:
    _instance = None
    _tasks: OrderedDict[str, TaskInfo] = OrderedDict()
    _task_locks: Dict[str, threading.Lock] = {}
    _event_listeners: Dict[str, list] = {}
    _max_tasks = 5
    _loop = None
    _thread_ident = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._tasks = OrderedDict()
            cls._task_locks = {}
            cls._event_listeners = {}
        return cls._instance

    @classmethod
    def set_loop(cls, loop):
        cls._loop = loop
        cls._thread_ident = threading.current_thread().ident

    def _get_event_loop(self):
        if self._loop is None or self._thread_ident != threading.current_thread().ident:
            try:
                return asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.new_event_loop()
        return self._loop

    def create_task(self, repo_path: str, branch: str = "main") -> TaskInfo:
        task_id = str(uuid.uuid4())
        now = datetime.now()

        task_info = TaskInfo(
            task_id=task_id,
            status="queued",
            repo_path=repo_path,
            branch=branch,
            created_at=now,
            progress=TaskProgress(
                current_file=0,
                total_files=0,
                phase="queued",
                message="任务已排队，等待执行..."
            )
        )

        with self._get_task_lock(task_id):
            self._tasks[task_id] = task_info
            self._trim_tasks()

        self._emit_event(task_id, "created", task_info.model_dump())
        return task_info

    def _get_task_lock(self, task_id: str) -> threading.Lock:
        if task_id not in self._task_locks:
            self._task_locks[task_id] = threading.Lock()
        return self._task_locks[task_id]

    def _trim_tasks(self):
        if len(self._tasks) > 100:
            old_tasks = list(self._tasks.keys())[:-50]
            for t_id in old_tasks:
                del self._tasks[t_id]
                self._task_locks.pop(t_id, None)
                self._event_listeners.pop(t_id, None)

    def get_task(self, task_id: str) -> Optional[TaskInfo]:
        with self._get_task_lock(task_id):
            return self._tasks.get(task_id)

    def list_tasks(self, skip: int = 0, limit: int = 50) -> list[TaskInfo]:
        tasks = list(self._tasks.values())
        tasks.reverse()
        return tasks[skip:skip + limit]

    def count_tasks(self) -> int:
        return len(self._tasks)

    def update_progress(self, task_id: str, progress: TaskProgress, status: str = None):
        task = self.get_task(task_id)
        if not task:
            return

        with self._get_task_lock(task_id):
            if status and status != task.status:
                task.status = status
                if status == "running" and task.started_at is None:
                    task.started_at = datetime.now()
                elif status in ["completed", "failed", "cancelled"]:
                    task.completed_at = datetime.now()

            task.progress = progress

        self._emit_event(task_id, "progress", {
            "status": task.status,
            "progress": progress.model_dump()
        })

    def update_status(self, task_id: str, status: str, message: str = None):
        task = self.get_task(task_id)
        if not task:
            return

        with self._get_task_lock(task_id):
            task.status = status
            if status == "running" and task.started_at is None:
                task.started_at = datetime.now()
            elif status in ["completed", "failed", "cancelled"]:
                task.completed_at = datetime.now()
            if message:
                task.progress.message = message

        self._emit_event(task_id, "status_change", {
            "status": status,
            "message": message
        })

    def set_result(self, task_id: str, result: dict):
        task = self.get_task(task_id)
        if not task:
            return

        with self._get_task_lock(task_id):
            task.result = result
            task.status = "completed"
            task.completed_at = datetime.now()
            task.progress.phase = "completed"
            task.progress.message = "分析完成"

        self._emit_event(task_id, "completed", {
            "result": result,
            "status": "completed"
        })

    def set_error(self, task_id: str, error: str):
        task = self.get_task(task_id)
        if not task:
            return

        with self._get_task_lock(task_id):
            task.error = error
            task.status = "failed"
            task.completed_at = datetime.now()
            task.progress.message = error

        self._emit_event(task_id, "failed", {
            "error": error,
            "status": "failed"
        })

    def cancel_task(self, task_id: str) -> bool:
        task = self.get_task(task_id)
        if not task or task.status in ["completed", "failed", "cancelled"]:
            return False

        self.update_status(task_id, "cancelled", "任务已取消")
        return True

    def add_listener(self, task_id: str, callback: Callable):
        if task_id not in self._event_listeners:
            self._event_listeners[task_id] = []
        self._event_listeners[task_id].append(callback)

    def remove_listener(self, task_id: str, callback: Callable):
        if task_id in self._event_listeners:
            try:
                self._event_listeners[task_id].remove(callback)
            except ValueError:
                pass

    def _emit_event(self, task_id: str, event_type: str, data: Dict[str, Any]):
        if task_id not in self._event_listeners:
            return

        loop = self._get_event_loop()

        for callback in self._event_listeners[task_id]:
            try:
                if asyncio.iscoroutinefunction(callback):
                    if loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            callback(task_id, event_type, data), loop
                        )
                    else:
                        asyncio.run(callback(task_id, event_type, data))
                else:
                    callback(task_id, event_type, data)
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.error(f"Error in event listener for task {task_id}: {e}")

    def run_async_task(self, task_id: str, coro) -> threading.Thread:
        loop = self._loop

        def thread_target():
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(coro)
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.error(f"Task {task_id} failed: {e}")
                self.set_error(task_id, str(e))

        thread = threading.Thread(
            target=thread_target,
            name=f"task-{task_id[:8]}",
            daemon=True
        )
        thread.start()
        return thread


task_manager = AsyncTaskManager()
