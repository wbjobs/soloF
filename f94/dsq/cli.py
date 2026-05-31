import argparse
import json
import sys
import os
import time
import subprocess
import signal
from typing import Dict, List, Optional

from .coordinator import QueryCoordinator
from .config import load_nodes


def format_result(result: Dict) -> str:
    data = result.get("result", {})
    plan = result.get("query_plan", {})
    node_results = result.get("node_results", {})
    warnings = result.get("warnings", [])
    failed_nodes = result.get("failed_nodes", [])
    successful_nodes = result.get("successful_nodes", [])

    output = []

    if warnings:
        output.append("⚠️  WARNINGS:")
        for w in warnings:
            output.append(f"  ! {w}")
        output.append("")
        output.append(f"⚠️  PARTIAL RESULT: Only {len(successful_nodes)} of {len(successful_nodes) + len(failed_nodes)} nodes returned data")
        output.append("")

    if isinstance(data, dict):
        output.append("Result:")
        for key, value in data.items():
            if isinstance(value, float):
                output.append(f"  {key}: {value:.4f}")
            else:
                output.append(f"  {key}: {value}")
    elif isinstance(data, list):
        if not data:
            output.append("Result: (empty set)")
        else:
            output.append(f"Result: {len(data)} row(s)")
            columns = list(data[0].keys())
            col_widths = {col: max(len(col), max(len(str(row.get(col, ""))) for row in data)) for col in columns}
            header = " | ".join(col.ljust(col_widths[col]) for col in columns)
            separator = "-+-".join("-" * col_widths[col] for col in columns)
            output.append("")
            output.append(header)
            output.append(separator)
            for row in data:
                output.append(" | ".join(str(row.get(col, "")).ljust(col_widths[col]) for col in columns))
    else:
        output.append(f"Result: {data}")

    output.append("")
    output.append("=== Query Execution Details ===")
    output.append(f"SQL: {result.get('sql', '')}")
    output.append(f"Merge Strategy: {plan.get('merge_strategy', '')}")
    output.append(f"Aggregate Query: {plan.get('has_aggregate', False)}")
    output.append(f"Successful nodes: {len(successful_nodes)}")
    if failed_nodes:
        output.append(f"Failed nodes: {len(failed_nodes)} ({', '.join(failed_nodes)})")

    output.append("")
    output.append("=== Node Results ===")
    for node_id, node_result in node_results.items():
        if node_result.get("type") == "aggregate":
            agg = node_result.get("aggregate", {})
            agg_str = ", ".join(f"{k}={v}" for k, v in agg.items())
            output.append(f"  ✓ {node_id}: aggregate({agg_str}), rows_scanned={node_result.get('rows_scanned', 0)}")
        else:
            output.append(f"  ✓ {node_id}: {node_result.get('count', 0)} row(s)")

    if failed_nodes:
        output.append("")
        output.append("=== Failed Nodes ===")
        for node_id in failed_nodes:
            output.append(f"  ✗ {node_id}: skipped due to error/timeout")

    return "\n".join(output)


def run_query(
    sql: str,
    config_path: str = "nodes.yaml",
    timeout: int = 30,
    node_delays: Optional[Dict[str, int]] = None
):
    try:
        coordinator = QueryCoordinator(config_path=config_path, timeout=timeout)
        if node_delays:
            for node_id, delay in node_delays.items():
                coordinator.set_node_delay(node_id, delay)
        result = coordinator.execute(sql)
        print(format_result(result))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def start_nodes(config_path: str = "nodes.yaml"):
    nodes = load_nodes(config_path)
    processes = []

    print("Starting nodes...")
    for node in nodes:
        data_file = os.path.abspath(node.data_file)
        cmd = [
            sys.executable, "-m", "dsq.node_server",
            node.id, node.host, str(node.port), data_file
        ]
        print(f"  {node.id}: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        processes.append((node.id, process))

    pid_file = os.path.join(os.path.dirname(os.path.abspath(config_path)), ".node_pids")
    with open(pid_file, "w") as f:
        for node_id, process in processes:
            f.write(f"{node_id},{process.pid}\n")

    print(f"\nStarted {len(processes)} node(s). PID file: {pid_file}")
    print("Waiting for nodes to initialize...")
    time.sleep(2)

    for node_id, process in processes:
        if process.poll() is not None:
            print(f"Warning: Node {node_id} exited with code {process.returncode}")
            output, _ = process.communicate()
            if output:
                print(output.decode("utf-8", errors="replace"))

    print("Nodes started. Use 'dsq stop-nodes' to stop them.")


def stop_nodes(config_path: str = "nodes.yaml"):
    pid_file = os.path.join(os.path.dirname(os.path.abspath(config_path)), ".node_pids")

    if not os.path.exists(pid_file):
        print("No PID file found. Are nodes running?")
        return

    stopped = 0
    with open(pid_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(",", 1)
            if len(parts) != 2:
                continue
            node_id, pid_str = parts
            try:
                pid = int(pid_str)
                if os.name == 'nt':
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
                else:
                    os.kill(pid, signal.SIGTERM)
                print(f"Stopped {node_id} (PID: {pid})")
                stopped += 1
            except Exception as e:
                print(f"Failed to stop {node_id} (PID: {pid}): {e}")

    os.remove(pid_file)
    print(f"Stopped {stopped} node(s).")


def check_nodes(config_path: str = "nodes.yaml"):
    import requests
    nodes = load_nodes(config_path)

    print("Node status:")
    for node in nodes:
        try:
            response = requests.get(f"{node.url}/health", timeout=2)
            if response.status_code == 200:
                data = response.json()
                print(f"  {node.id}: ONLINE (port {node.port}, {data.get('rows_loaded', 0)} rows)")
            else:
                print(f"  {node.id}: ERROR (HTTP {response.status_code})")
        except Exception as e:
            print(f"  {node.id}: OFFLINE ({e})")


def main():
    VALID_COMMANDS = {"query", "start-nodes", "stop-nodes", "check-nodes"}

    config_path = "nodes.yaml"
    timeout = 30.0
    node_delays: Dict[str, int] = {}
    filtered_args = []
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--config" and i + 1 < len(sys.argv):
            config_path = sys.argv[i + 1]
            i += 2
        elif arg.startswith("--config="):
            config_path = arg.split("=", 1)[1]
            i += 1
        elif arg == "--timeout" and i + 1 < len(sys.argv):
            timeout = float(sys.argv[i + 1])
            i += 2
        elif arg.startswith("--timeout="):
            timeout = float(arg.split("=", 1)[1])
            i += 1
        elif arg.startswith("--delay-") and "=" in arg and i + 1 >= 0:
            parts = arg.split("=", 1)
            node_id = parts[0][len("--delay-"):]
            delay = int(parts[1])
            node_delays[node_id] = delay
            i += 1
        else:
            filtered_args.append(arg)
            i += 1

    if not filtered_args:
        print("Usage: dsq \"<SQL query>\"")
        print("   or: dsq <command> [options]")
        print("")
        print("Commands:")
        print("  query <sql>      Execute a SQL query")
        print("  start-nodes      Start all data nodes")
        print("  stop-nodes       Stop all data nodes")
        print("  check-nodes      Check status of all data nodes")
        print("")
        print("Options:")
        print("  --config PATH       Path to nodes configuration file")
        print("  --timeout SEC       Request timeout in seconds (default: 30)")
        print("  --delay-<node>=MS   Simulate delay (ms) for a specific node (for testing)")
        sys.exit(1)

    first_arg = filtered_args[0]

    if first_arg == "query":
        if len(filtered_args) < 2:
            print("Error: query command requires a SQL argument")
            sys.exit(1)
        sql = " ".join(filtered_args[1:])
        run_query(sql, config_path, timeout, node_delays)
    elif first_arg == "start-nodes":
        start_nodes(config_path)
    elif first_arg == "stop-nodes":
        stop_nodes(config_path)
    elif first_arg == "check-nodes":
        check_nodes(config_path)
    else:
        sql = " ".join(filtered_args)
        if sql.startswith('"') and sql.endswith('"'):
            sql = sql[1:-1]
        run_query(sql, config_path, timeout, node_delays)


if __name__ == "__main__":
    main()
