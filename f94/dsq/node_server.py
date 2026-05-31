import csv
import json
import os
import time
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request

from .expression import ExpressionEvaluator, safe_convert


class DataNode:
    def __init__(self, node_id: str, data_file: str):
        self.node_id = node_id
        self.data_file = data_file
        self.rows: List[Dict[str, Any]] = []
        self._load_data()

    def _load_data(self):
        if not os.path.exists(self.data_file):
            raise FileNotFoundError(f"Data file not found: {self.data_file}")

        with open(self.data_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            self.rows = []
            for row in reader:
                converted_row = {k: safe_convert(v) for k, v in row.items()}
                self.rows.append(converted_row)

    def _filter_rows(self, where_condition: Optional[str]) -> List[Dict[str, Any]]:
        if not where_condition:
            return self.rows

        filtered = []
        for row in self.rows:
            try:
                if ExpressionEvaluator.evaluate(where_condition, row):
                    filtered.append(row)
            except Exception as e:
                raise ValueError(f"Error evaluating expression '{where_condition}': {e}")
        return filtered

    def execute_query(
        self,
        select_items: List[Dict[str, str]],
        where_condition: Optional[str],
        is_aggregate: bool
    ) -> Dict[str, Any]:
        filtered_rows = self._filter_rows(where_condition)

        if is_aggregate:
            return self._execute_aggregate(select_items, filtered_rows)
        else:
            return self._execute_select(select_items, filtered_rows)

    def _execute_select(
        self,
        select_items: List[Dict[str, str]],
        rows: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        result_rows = []
        for row in rows:
            result_row = {}
            for item in select_items:
                col_name = item["name"]
                alias = item.get("alias", col_name)
                if col_name == "*":
                    result_row = row.copy()
                else:
                    if col_name not in row:
                        raise ValueError(f"Column '{col_name}' not found")
                    result_row[alias] = row[col_name]
            result_rows.append(result_row)

        return {
            "node_id": self.node_id,
            "type": "select",
            "rows": result_rows,
            "count": len(result_rows)
        }

    def _execute_aggregate(
        self,
        select_items: List[Dict[str, str]],
        rows: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        aggregates: Dict[str, Any] = {}

        for item in select_items:
            agg_func = item.get("func", "").upper()
            agg_arg = item.get("arg", "")
            alias = item.get("alias", f"{agg_func}({agg_arg})")

            if agg_func == "COUNT":
                if agg_arg == "*":
                    aggregates[alias] = len(rows)
                else:
                    count = 0
                    for row in rows:
                        if agg_arg in row and row[agg_arg] is not None:
                            count += 1
                    aggregates[alias] = count

            elif agg_func == "SUM":
                total = 0
                for row in rows:
                    if agg_arg in row and row[agg_arg] is not None:
                        total += row[agg_arg]
                aggregates[alias] = total

            elif agg_func == "AVG":
                total = 0
                count = 0
                for row in rows:
                    if agg_arg in row and row[agg_arg] is not None:
                        total += row[agg_arg]
                        count += 1
                aggregates[alias] = total / count if count > 0 else 0

            else:
                raise ValueError(f"Unsupported aggregate function: {agg_func}")

        return {
            "node_id": self.node_id,
            "type": "aggregate",
            "aggregate": aggregates,
            "rows_scanned": len(rows)
        }


def create_app(node_id: str, data_file: str) -> Flask:
    app = Flask(__name__)
    data_node = DataNode(node_id, data_file)

    @app.route("/health")
    def health():
        return jsonify({"status": "ok", "node_id": node_id, "rows_loaded": len(data_node.rows)})

    @app.route("/query", methods=["POST"])
    def query():
        try:
            payload = request.get_json()
            if not payload:
                return jsonify({"error": "Empty request body"}), 400

            select_items = payload.get("select_items", [])
            where_condition = payload.get("where_condition")
            is_aggregate = payload.get("is_aggregate", False)

            simulate_delay = payload.get("simulate_delay", 0)
            if simulate_delay > 0:
                time.sleep(simulate_delay / 1000.0)

            result = data_node.execute_query(select_items, where_condition, is_aggregate)
            return jsonify(result)

        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": f"Internal error: {e}"}), 500

    @app.route("/schema")
    def schema():
        if data_node.rows:
            sample_row = data_node.rows[0]
            columns = {}
            for col_name, value in sample_row.items():
                columns[col_name] = type(value).__name__
            return jsonify({
                "node_id": node_id,
                "columns": columns,
                "row_count": len(data_node.rows)
            })
        return jsonify({"node_id": node_id, "columns": {}, "row_count": 0})

    return app


def run_node(node_id: str, host: str, port: int, data_file: str):
    app = create_app(node_id, data_file)
    print(f"Starting node {node_id} on {host}:{port}, data file: {data_file}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 5:
        print("Usage: python node_server.py <node_id> <host> <port> <data_file>")
        sys.exit(1)

    node_id, host, port_str, data_file = sys.argv[1:5]
    port = int(port_str)
    run_node(node_id, host, port, data_file)
