#!/usr/bin/env python3
import argparse
import asyncio
import json
import logging
import os
import signal
import sys
from ctypes import Structure, c_uint32, c_uint64, c_long, c_char, c_size_t, sizeof
from pathlib import Path
from typing import Dict, Set, Optional, List, Tuple

from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

if sys.platform.startswith("linux"):
    from bcc import BPF
else:
    logger.warning("Not running on Linux, BCC will not be available")


class EventData(Structure):
    _fields_ = [
        ("pid", c_uint32),
        ("tgid", c_uint32),
        ("timestamp", c_uint64),
        ("syscall", c_uint32),
        ("state", c_uint32),
        ("retval", c_long),
        ("comm", c_char * 16),
        ("filename", c_char * 256),
        ("count", c_size_t),
    ]


SYSCALL_NAMES = {0: "open", 1: "read", 2: "write", 3: "execve"}
STATE_NAMES = {0: "enter", 1: "exit"}

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


class SuspiciousActivity:
    def __init__(self, pid: int, comm: str, syscall: str, filename: str, reason: str):
        self.pid = pid
        self.comm = comm
        self.syscall = syscall
        self.filename = filename
        self.reason = reason
        self.timestamp = asyncio.get_event_loop().time()


class SyscallMonitor:
    def __init__(self, bpf_source_path: str):
        self.bpf_source_path = bpf_source_path
        self.bpf: Optional[BPF] = None
        self.target_pids: Set[int] = set()
        self.stopped_pids: Set[int] = set()
        self.ws_connections: Set[web.WebSocketResponse] = set()
        self.event_queue: asyncio.Queue = asyncio.Queue()
        self.alert_queue: asyncio.Queue = asyncio.Queue()
        self.suspicious_activities: List[SuspiciousActivity] = []
        self.running = False
        self.auto_stop_on_alert = True

    def load_bpf(self) -> None:
        if not sys.platform.startswith("linux"):
            logger.warning("Cannot load BPF: not running on Linux")
            return

        with open(self.bpf_source_path, "r") as f:
            bpf_source = f.read()

        self.bpf = BPF(text=bpf_source)
        logger.info("BPF program loaded successfully")

    def add_target_pid(self, pid: int) -> None:
        self.target_pids.add(pid)
        if self.bpf:
            self.bpf["target_pids"][c_uint32(pid)] = c_uint32(1)
        logger.info(f"Added target PID: {pid}")

    def remove_target_pid(self, pid: int) -> None:
        self.target_pids.discard(pid)
        self.stopped_pids.discard(pid)
        if self.bpf:
            try:
                del self.bpf["target_pids"][c_uint32(pid)]
            except KeyError:
                pass
        logger.info(f"Removed target PID: {pid}")

    def stop_process(self, pid: int) -> bool:
        if not sys.platform.startswith("linux"):
            logger.warning(f"Cannot stop PID {pid}: not running on Linux")
            return False
        try:
            os.kill(pid, signal.SIGSTOP)
            self.stopped_pids.add(pid)
            logger.warning(f"Sent SIGSTOP to PID {pid}")
            return True
        except ProcessLookupError:
            logger.warning(f"Process {pid} not found")
            return False
        except PermissionError:
            logger.error(f"Permission denied when stopping PID {pid}")
            return False
        except Exception as e:
            logger.error(f"Error stopping PID {pid}: {e}")
            return False

    def resume_process(self, pid: int) -> bool:
        if not sys.platform.startswith("linux"):
            logger.warning(f"Cannot resume PID {pid}: not running on Linux")
            return False
        try:
            os.kill(pid, signal.SIGCONT)
            self.stopped_pids.discard(pid)
            logger.info(f"Sent SIGCONT to PID {pid}")
            return True
        except ProcessLookupError:
            logger.warning(f"Process {pid} not found")
            return False
        except PermissionError:
            logger.error(f"Permission denied when resuming PID {pid}")
            return False
        except Exception as e:
            logger.error(f"Error resuming PID {pid}: {e}")
            return False

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

    def handle_event(self, cpu, data, size) -> None:
        if size >= sizeof(EventData):
            event = EventData.from_address(data)
            event_dict = {
                "pid": event.pid,
                "tgid": event.tgid,
                "timestamp": event.timestamp,
                "syscall": SYSCALL_NAMES.get(event.syscall, f"unknown_{event.syscall}"),
                "state": STATE_NAMES.get(event.state, f"unknown_{event.state}"),
                "retval": event.retval,
                "comm": event.comm.decode("utf-8", errors="replace").rstrip("\x00"),
                "filename": event.filename.decode("utf-8", errors="replace").rstrip("\x00"),
                "count": event.count,
            }

            activity = self.check_suspicious_activity(event_dict)
            if activity:
                self.suspicious_activities.append(activity)
                asyncio.run_coroutine_threadsafe(
                    self.alert_queue.put(activity),
                    asyncio.get_event_loop()
                )

                if self.auto_stop_on_alert and activity.pid in self.target_pids:
                    self.stop_process(activity.pid)

            asyncio.run_coroutine_threadsafe(
                self.event_queue.put(event_dict),
                asyncio.get_event_loop()
            )

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

    async def event_processor(self) -> None:
        while self.running:
            try:
                event = await self.event_queue.get()
                await self.broadcast_event(event)
                self.event_queue.task_done()
            except Exception as e:
                logger.error(f"Error processing event: {e}")

    async def alert_processor(self) -> None:
        while self.running:
            try:
                alert = await self.alert_queue.get()
                await self.broadcast_alert(alert)
                self.alert_queue.task_done()
            except Exception as e:
                logger.error(f"Error processing alert: {e}")

    def poll_perf_buffer(self, loop: asyncio.AbstractEventLoop) -> None:
        if self.bpf:
            self.bpf["events"].open_perf_buffer(
                self.handle_event, page_cnt=64
            )
            while self.running:
                try:
                    self.bpf.perf_buffer_poll(timeout=100)
                except Exception as e:
                    logger.error(f"Error polling perf buffer: {e}")

    async def start(self) -> None:
        self.running = True
        self.load_bpf()
        asyncio.create_task(self.event_processor())
        asyncio.create_task(self.alert_processor())

        if self.bpf and sys.platform.startswith("linux"):
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self.poll_perf_buffer, loop)

    async def stop(self) -> None:
        self.running = False
        for pid in list(self.stopped_pids):
            self.resume_process(pid)
        logger.info("Monitor stopped")


async def handle_websocket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    monitor: SyscallMonitor = request.app["monitor"]
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
    monitor: SyscallMonitor = request.app["monitor"]
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
    monitor: SyscallMonitor = request.app["monitor"]
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
    monitor: SyscallMonitor = request.app["monitor"]
    return web.json_response({
        "pids": list(monitor.target_pids),
        "stopped_pids": list(monitor.stopped_pids)
    })


async def handle_resume_pid(request: web.Request) -> web.Response:
    monitor: SyscallMonitor = request.app["monitor"]
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
    monitor: SyscallMonitor = request.app["monitor"]
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
    return web.json_response({"status": "ok", "platform": sys.platform})


async def on_startup(app: web.Application) -> None:
    monitor: SyscallMonitor = app["monitor"]
    asyncio.create_task(monitor.start())


async def on_cleanup(app: web.Application) -> None:
    monitor: SyscallMonitor = app["monitor"]
    await monitor.stop()


def main():
    parser = argparse.ArgumentParser(description="eBPF Syscall Monitor with Anomaly Detection")
    parser.add_argument(
        "--bpf-source",
        type=str,
        default=str(Path(__file__).parent.parent / "ebpf" / "syscall_trace.c"),
        help="Path to BPF source file"
    )
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
    monitor = SyscallMonitor(args.bpf_source)
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

    logger.info(f"Starting server on {args.host}:{args.port}")
    logger.info(f"Auto-stop on alert: {monitor.auto_stop_on_alert}")
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
