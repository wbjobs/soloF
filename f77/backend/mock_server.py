#!/usr/bin/env python3
import argparse
import asyncio
import json
import logging
import random
import sys
from pathlib import Path
from typing import Dict, Set, Optional, List

from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

SENSITIVE_FILES = [
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "/root",
    "/etc/ssh",
    "/var/log",
    "/proc/kcore",
    "/dev/mem",
    "/etc/crontab",
]

SENSITIVE_EXECUTABLES = [
    "/bin/su",
    "/usr/bin/sudo",
    "/usr/bin/passwd",
    "/usr/sbin/visudo",
    "/usr/sbin/cron",
]

NORMAL_FILES = [
    "/tmp/test.txt",
    "/home/user/data.csv",
    "/home/user/doc.txt",
    "/var/tmp/cache.dat",
]


class SuspiciousActivity:
    def __init__(self, pid: int, comm: str, syscall: str, filename: str, reason: str):
        self.pid = pid
        self.comm = comm
        self.syscall = syscall
        self.filename = filename
        self.reason = reason
        self.timestamp = asyncio.get_event_loop().time()


class MockSyscallMonitor:
    def __init__(self):
        self.target_pids: Set[int] = set()
        self.stopped_pids: Set[int] = set()
        self.ws_connections: Set[web.WebSocketResponse] = set()
        self.running = False
        self.auto_stop_on_alert = True
        self.syscall_names = ["open", "read", "write", "execve"]
        self.commands = ["bash", "cat", "vim", "python3", "node"]
        self.alert_queue: asyncio.Queue = asyncio.Queue()

    def add_target_pid(self, pid: int) -> None:
        self.target_pids.add(pid)
        logger.info(f"Added target PID: {pid}")

    def remove_target_pid(self, pid: int) -> None:
        self.target_pids.discard(pid)
        self.stopped_pids.discard(pid)
        logger.info(f"Removed target PID: {pid}")

    def stop_process(self, pid: int) -> bool:
        logger.warning(f"[MOCK] Would send SIGSTOP to PID {pid}")
        self.stopped_pids.add(pid)
        return True

    def resume_process(self, pid: int) -> bool:
        logger.info(f"[MOCK] Would send SIGCONT to PID {pid}")
        self.stopped_pids.discard(pid)
        return True

    def check_suspicious_activity(self, event_dict: Dict) -> Optional[SuspiciousActivity]:
        syscall = event_dict["syscall"]
        filename = event_dict.get("filename", "")
        state = event_dict["state"]

        if state != "enter":
            return None

        if syscall == "open" and filename:
            for sensitive in SENSITIVE_FILES:
                if filename.startswith(sensitive):
                    return SuspiciousActivity(
                        pid=event_dict["tgid"],
                        comm=event_dict["comm"],
                        syscall=syscall,
                        filename=filename,
                        reason=f"尝试访问敏感文件: {sensitive}"
                    )

        if syscall == "write" and filename:
            for sensitive in SENSITIVE_FILES:
                if filename.startswith(sensitive):
                    return SuspiciousActivity(
                        pid=event_dict["tgid"],
                        comm=event_dict["comm"],
                        syscall=syscall,
                        filename=filename,
                        reason=f"尝试写入敏感文件: {sensitive}"
                    )

        if syscall == "execve" and filename:
            for sensitive in SENSITIVE_EXECUTABLES:
                if filename == sensitive:
                    return SuspiciousActivity(
                        pid=event_dict["tgid"],
                        comm=event_dict["comm"],
                        syscall=syscall,
                        filename=filename,
                        reason=f"尝试执行敏感程序: {sensitive}"
                    )

        return None

    def generate_mock_event(self) -> Dict:
        pid = random.choice(list(self.target_pids)) if self.target_pids else random.randint(1000, 9999)
        syscall = random.choice(self.syscall_names)
        state = random.choice(["enter", "exit"])

        filename = ""
        if syscall == "open" and state == "enter":
            if random.random() < 0.3:
                filename = random.choice(SENSITIVE_FILES)
            else:
                filename = random.choice(NORMAL_FILES)
        elif syscall == "execve" and state == "enter":
            if random.random() < 0.2:
                filename = random.choice(SENSITIVE_EXECUTABLES)
            else:
                filename = "/bin/ls"

        return {
            "pid": pid,
            "tgid": pid,
            "timestamp": asyncio.get_event_loop().time() * 1e9,
            "syscall": syscall,
            "state": state,
            "retval": random.randint(-1, 1024) if state == "exit" else 0,
            "comm": random.choice(self.commands),
            "filename": filename,
            "count": random.randint(0, 4096) if state == "enter" and syscall in ["read", "write"] else 0,
        }

    async def broadcast_event(self, event: Dict) -> None:
        if not self.ws_connections:
            return

        message = json.dumps({"type": "syscall_event", "data": event})
        disconnected = set()

        for ws in self.ws_connections:
            try:
                if not ws.closed:
                    await ws.send_str(message)
            except Exception as e:
                logger.error(f"Error sending to WebSocket: {e}")
                disconnected.add(ws)

        for ws in disconnected:
            self.ws_connections.discard(ws)

    async def broadcast_alert(self, activity: SuspiciousActivity) -> None:
        if not self.ws_connections:
            return

        alert = {
            "type": "suspicious_alert",
            "data": {
                "pid": activity.pid,
                "comm": activity.comm,
                "syscall": activity.syscall,
                "filename": activity.filename,
                "reason": activity.reason,
                "timestamp": activity.timestamp,
                "stopped": activity.pid in self.stopped_pids,
            }
        }
        message = json.dumps(alert)
        disconnected = set()

        for ws in self.ws_connections:
            try:
                if not ws.closed:
                    await ws.send_str(message)
            except Exception as e:
                logger.error(f"Error sending alert to WebSocket: {e}")
                disconnected.add(ws)

        for ws in disconnected:
            self.ws_connections.discard(ws)

    async def alert_processor(self) -> None:
        while self.running:
            try:
                alert = await self.alert_queue.get()
                await self.broadcast_alert(alert)
                self.alert_queue.task_done()
            except Exception as e:
                logger.error(f"Error processing alert: {e}")

    async def event_generator(self) -> None:
        while self.running:
            if self.target_pids:
                active_pids = [pid for pid in self.target_pids if pid not in self.stopped_pids]
                if active_pids:
                    event = self.generate_mock_event()
                    activity = self.check_suspicious_activity(event)
                    if activity:
                        await self.alert_queue.put(activity)
                        if self.auto_stop_on_alert and activity.pid in self.target_pids:
                            self.stop_process(activity.pid)
                    await self.broadcast_event(event)
            await asyncio.sleep(random.uniform(0.1, 0.5))

    async def start(self) -> None:
        self.running = True
        asyncio.create_task(self.event_generator())
        asyncio.create_task(self.alert_processor())
        logger.info("Mock monitor started")

    async def stop(self) -> None:
        self.running = False
        logger.info("Mock monitor stopped")


async def handle_websocket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    monitor: MockSyscallMonitor = request.app["monitor"]
    monitor.ws_connections.add(ws)
    logger.info("WebSocket client connected")

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "add_pid":
                        pid = data.get("pid")
                        if isinstance(pid, int):
                            monitor.add_target_pid(pid)
                            await ws.send_json({
                                "type": "pid_added",
                                "pid": pid,
                                "success": True
                            })
                    elif data.get("type") == "remove_pid":
                        pid = data.get("pid")
                        if isinstance(pid, int):
                            monitor.remove_target_pid(pid)
                            await ws.send_json({
                                "type": "pid_removed",
                                "pid": pid,
                                "success": True
                            })
                    elif data.get("type") == "list_pids":
                        await ws.send_json({
                            "type": "pid_list",
                            "pids": list(monitor.target_pids),
                            "stopped_pids": list(monitor.stopped_pids)
                        })
                    elif data.get("type") == "resume_pid":
                        pid = data.get("pid")
                        if isinstance(pid, int):
                            success = monitor.resume_process(pid)
                            await ws.send_json({
                                "type": "pid_resumed",
                                "pid": pid,
                                "success": success
                            })
                    elif data.get("type") == "stop_pid":
                        pid = data.get("pid")
                        if isinstance(pid, int):
                            success = monitor.stop_process(pid)
                            await ws.send_json({
                                "type": "pid_stopped",
                                "pid": pid,
                                "success": success
                            })
                except json.JSONDecodeError:
                    logger.error("Invalid JSON received")
            elif msg.type == WSMsgType.ERROR:
                logger.error(f"WebSocket error: {ws.exception()}")
    finally:
        monitor.ws_connections.discard(ws)
        logger.info("WebSocket client disconnected")

    return ws


async def handle_add_pid(request: web.Request) -> web.Response:
    monitor: MockSyscallMonitor = request.app["monitor"]
    try:
        data = await request.json()
        pid = data.get("pid")
        if isinstance(pid, int):
            monitor.add_target_pid(pid)
            return web.json_response({"success": True, "pid": pid})
        return web.json_response({"success": False, "error": "Invalid PID"}, status=400)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_remove_pid(request: web.Request) -> web.Response:
    monitor: MockSyscallMonitor = request.app["monitor"]
    try:
        data = await request.json()
        pid = data.get("pid")
        if isinstance(pid, int):
            monitor.remove_target_pid(pid)
            return web.json_response({"success": True, "pid": pid})
        return web.json_response({"success": False, "error": "Invalid PID"}, status=400)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_list_pids(request: web.Request) -> web.Response:
    monitor: MockSyscallMonitor = request.app["monitor"]
    return web.json_response({
        "pids": list(monitor.target_pids),
        "stopped_pids": list(monitor.stopped_pids)
    })


async def handle_resume_pid(request: web.Request) -> web.Response:
    monitor: MockSyscallMonitor = request.app["monitor"]
    try:
        data = await request.json()
        pid = data.get("pid")
        if isinstance(pid, int):
            success = monitor.resume_process(pid)
            return web.json_response({"success": success, "pid": pid})
        return web.json_response({"success": False, "error": "Invalid PID"}, status=400)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_stop_pid(request: web.Request) -> web.Response:
    monitor: MockSyscallMonitor = request.app["monitor"]
    try:
        data = await request.json()
        pid = data.get("pid")
        if isinstance(pid, int):
            success = monitor.stop_process(pid)
            return web.json_response({"success": success, "pid": pid})
        return web.json_response({"success": False, "error": "Invalid PID"}, status=400)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "platform": sys.platform, "mode": "mock"})


async def on_startup(app: web.Application) -> None:
    monitor: MockSyscallMonitor = app["monitor"]
    await monitor.start()


async def on_cleanup(app: web.Application) -> None:
    monitor: MockSyscallMonitor = app["monitor"]
    await monitor.stop()


def main():
    parser = argparse.ArgumentParser(description="Mock eBPF Syscall Monitor with Anomaly Detection")
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host to bind WebSocket server"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Port to bind WebSocket server"
    )
    parser.add_argument(
        "--pid",
        type=int,
        action="append",
        default=[],
        help="Initial target PID(s) to monitor"
    )
    parser.add_argument(
        "--no-auto-stop",
        action="store_true",
        help="Disable automatic process stopping on suspicious activity"
    )

    args = parser.parse_args()

    app = web.Application()
    monitor = MockSyscallMonitor()
    monitor.auto_stop_on_alert = not args.no_auto_stop

    for pid in args.pid:
        monitor.add_target_pid(pid)

    app["monitor"] = monitor

    app.router.add_get("/ws", handle_websocket)
    app.router.add_post("/api/pids", handle_add_pid)
    app.router.add_delete("/api/pids", handle_remove_pid)
    app.router.add_get("/api/pids", handle_list_pids)
    app.router.add_post("/api/pids/resume", handle_resume_pid)
    app.router.add_post("/api/pids/stop", handle_stop_pid)
    app.router.add_get("/health", handle_health)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    logger.info(f"Starting mock server on {args.host}:{args.port}")
    logger.info(f"Auto-stop on alert: {monitor.auto_stop_on_alert}")
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
