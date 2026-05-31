import redis
import json
from typing import Optional, Dict, Any
from app.core.config import get_settings

settings = get_settings()


class RedisService:
    def __init__(self):
        self.client = redis.from_url(settings.REDIS_URL)
    
    def set_task_status(self, task_id: str, status: str, progress: int = 0, message: str = "", data: Optional[Dict] = None):
        task_data = {
            "task_id": task_id,
            "status": status,
            "progress": progress,
            "message": message,
            "data": data or {}
        }
        key = f"task:{task_id}"
        self.client.setex(key, 86400, json.dumps(task_data))
    
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        key = f"task:{task_id}"
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None
    
    def update_task_progress(self, task_id: str, progress: int, message: str = ""):
        task_data = self.get_task_status(task_id)
        if task_data:
            task_data["progress"] = progress
            if message:
                task_data["message"] = message
            key = f"task:{task_id}"
            self.client.setex(key, 86400, json.dumps(task_data))
    
    def delete_task_status(self, task_id: str):
        key = f"task:{task_id}"
        self.client.delete(key)


redis_service = RedisService()
