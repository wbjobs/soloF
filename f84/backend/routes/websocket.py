import logging
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from typing import Dict, Set

from schemas import TaskInfo, ProgressUpdate
from task_manager import task_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

_active_connections: Dict[str, Set[WebSocket]] = {}


def _send_to_websocket_sync(ws: WebSocket, message: dict):
    try:
        loop = asyncio.get_event_loop()
        asyncio.run_coroutine_threadsafe(ws.send_json(message), loop)
    except Exception as e:
        logger.error(f"Failed to send message to websocket: {e}")


@router.websocket("/ws/tasks/{task_id}")
async def websocket_task(websocket: WebSocket, task_id: str):
    await websocket.accept()

    task = task_manager.get_task(task_id)
    if not task:
        await websocket.send_json({
            "type": "error",
            "message": f"任务 {task_id} 不存在"
        })
        await websocket.close()
        return

    async def event_listener(listener_task_id: str, event_type: str, data: dict):
        try:
            message = {
                "type": event_type,
                "task_id": listener_task_id,
                "data": data
            }
            await websocket.send_json(message)
        except Exception as e:
            logger.debug(f"WebSocket send failed: {e}")

    task_manager.add_listener(task_id, event_listener)

    try:
        await websocket.send_json({
            "type": "init",
            "task": task.model_dump(mode="json")
        })

        while True:
            try:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    if message.get("action") == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif message.get("action") == "cancel":
                            success = task_manager.cancel_task(task_id)
                            await websocket.send_json({
                                "type": "cancelled" if success else "error",
                                "success": success
                            })
                except json.JSONDecodeError:
                    pass
            except WebSocketDisconnect:
                break

    except WebSocketDisconnect:
        pass
    finally:
        task_manager.remove_listener(task_id, event_listener)


@router.websocket("/ws/tasks")
async def websocket_all_tasks(websocket: WebSocket):
    await websocket.accept()

    listening_to: Set[str] = set()

    async def global_listener(listener_task_id: str, event_type: str, data: dict):
        try:
            message = {
                "type": event_type,
                "task_id": listener_task_id,
                "data": data
            }
            await websocket.send_json(message)
        except Exception as e:
            logger.debug(f"WebSocket send failed: {e}")

    try:
        await websocket.send_json({
            "type": "init",
            "message": "Listening to all task updates"
        })

        while True:
            try:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    action = message.get("action")

                    if action == "ping":
                        await websocket.send_json({"type": "pong"})

                    elif action == "subscribe":
                        task_id = message.get("task_id")
                        if task_id and task_id not in listening_to:
                            task_manager.add_listener(task_id, global_listener)
                            listening_to.add(task_id)
                            task = task_manager.get_task(task_id)
                            if task:
                                await websocket.send_json({
                                    "type": "task_info",
                                    "task_id": task_id,
                                    "task": task.model_dump(mode="json")
                                })

                    elif action == "unsubscribe":
                        task_id = message.get("task_id")
                        if task_id and task_id in listening_to:
                            task_manager.remove_listener(task_id, global_listener)
                            listening_to.discard(task_id)

                    elif action == "subscribe_all":
                        for task_id in list(listening_to):
                            task_manager.remove_listener(task_id, global_listener)
                        listening_to.clear()
                        all_tasks = task_manager.list_tasks()
                        for task in all_tasks:
                            task_manager.add_listener(task.task_id, global_listener)
                            listening_to.add(task.task_id)
                        await websocket.send_json({
                            "type": "subscribed_all",
                            "count": len(all_tasks),
                            "tasks": [t.model_dump(mode="json") for t in all_tasks]
                        })

                    elif action == "cancel":
                        task_id = message.get("task_id")
                        if task_id:
                            success = task_manager.cancel_task(task_id)
                            await websocket.send_json({
                                "type": "cancelled" if success else "error",
                                "task_id": task_id,
                                "success": success
                            })

                except json.JSONDecodeError:
                    pass
            except WebSocketDisconnect:
                break

    except WebSocketDisconnect:
        pass
    finally:
        for task_id in listening_to:
            task_manager.remove_listener(task_id, global_listener)
