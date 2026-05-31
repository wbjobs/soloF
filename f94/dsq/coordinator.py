import json
import concurrent.futures
import warnings
from typing import Any, Dict, List, Tuple

import requests

from .config import NodeConfig, load_nodes
from .sql_parser import ParsedQuery, SQLParser
from .query_planner import QueryPlan, QueryPlanner, ResultMerger, SubQuery


class QueryCoordinator:
    def __init__(self, config_path: str = "nodes.yaml", timeout: float = 30.0):
        self.nodes: List[NodeConfig] = load_nodes(config_path)
        self.timeout = timeout
        self._node_map: Dict[str, NodeConfig] = {n.id: n for n in self.nodes}
        self.warnings: List[str] = []
        self.node_delays: Dict[str, int] = {}

    def set_node_delay(self, node_id: str, delay_ms: int):
        self.node_delays[node_id] = delay_ms

    def execute(self, sql: str) -> Any:
        self.warnings = []
        parsed_query = SQLParser.parse(sql)

        available_nodes = self._check_available_nodes()
        if not available_nodes:
            raise RuntimeError("No nodes available to execute query")

        node_ids = [n.id for n in available_nodes]
        query_plan = QueryPlanner.plan(parsed_query, node_ids)

        node_results, failed_nodes = self._execute_sub_queries(query_plan.sub_queries)

        if failed_nodes:
            for node_id, error in failed_nodes.items():
                self.warnings.append(f"Node {node_id} skipped: {error}")

        if not node_results:
            raise RuntimeError("All nodes failed, no results available")

        final_result = ResultMerger.merge(query_plan, node_results)

        return {
            "sql": sql,
            "result": final_result,
            "query_plan": self._plan_to_dict(query_plan),
            "node_results": node_results,
            "warnings": self.warnings,
            "failed_nodes": list(failed_nodes.keys()),
            "successful_nodes": list(node_results.keys())
        }

    def _check_available_nodes(self) -> List[NodeConfig]:
        available = []
        for node in self.nodes:
            try:
                response = requests.get(f"{node.url}/health", timeout=self.timeout)
                if response.status_code == 200:
                    available.append(node)
                else:
                    self.warnings.append(
                        f"Node {node.id} skipped: health check failed (HTTP {response.status_code})"
                    )
            except requests.exceptions.RequestException as e:
                self.warnings.append(
                    f"Node {node.id} skipped: health check failed ({type(e).__name__})"
                )
        return available

    def _execute_sub_queries(
        self, sub_queries: List[SubQuery]
    ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        results: Dict[str, Any] = {}
        failed: Dict[str, str] = {}

        def execute_sub_query(sub_query: SubQuery) -> Tuple[str, Any, bool]:
            node = self._node_map[sub_query.node_id]
            payload = {
                "select_items": sub_query.select_items,
                "where_condition": sub_query.where_condition,
                "is_aggregate": sub_query.is_aggregate,
                "simulate_delay": self.node_delays.get(sub_query.node_id, 0)
            }

            try:
                response = requests.post(
                    f"{node.url}/query",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=self.timeout
                )
                if response.status_code != 200:
                    error = response.json().get("error", f"HTTP {response.status_code}")
                    return sub_query.node_id, error, False
                return sub_query.node_id, response.json(), True
            except requests.exceptions.Timeout:
                return sub_query.node_id, "request timed out", False
            except requests.exceptions.RequestException as e:
                return sub_query.node_id, f"{type(e).__name__}", False

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(self.nodes)) as executor:
            future_to_node = {
                executor.submit(execute_sub_query, sq): sq.node_id
                for sq in sub_queries
            }

            for future in concurrent.futures.as_completed(future_to_node):
                node_id, result, success = future.result()
                if success:
                    results[node_id] = result
                else:
                    failed[node_id] = result

        return results, failed

    @staticmethod
    def _plan_to_dict(query_plan: QueryPlan) -> Dict[str, Any]:
        return {
            "table": query_plan.original_query.table_name,
            "has_aggregate": query_plan.original_query.has_aggregate,
            "merge_strategy": query_plan.merge_strategy,
            "sub_query_count": len(query_plan.sub_queries),
            "sub_queries": [
                {
                    "node_id": sq.node_id,
                    "is_aggregate": sq.is_aggregate,
                    "where_condition": sq.where_condition,
                    "select_items": sq.select_items
                }
                for sq in query_plan.sub_queries
            ]
        }
