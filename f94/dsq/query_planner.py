from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .sql_parser import ParsedQuery, SelectItem


@dataclass
class SubQuery:
    node_id: str
    select_items: List[Dict[str, str]]
    where_condition: Optional[str]
    is_aggregate: bool


@dataclass
class QueryPlan:
    original_query: ParsedQuery
    sub_queries: List[SubQuery]
    merge_strategy: str
    merge_context: Dict[str, Any] = field(default_factory=dict)


class QueryPlanner:
    @classmethod
    def plan(cls, parsed_query: ParsedQuery, node_ids: List[str]) -> QueryPlan:
        if parsed_query.has_aggregate:
            return cls._plan_aggregate(parsed_query, node_ids)
        else:
            return cls._plan_non_aggregate(parsed_query, node_ids)

    @classmethod
    def _plan_aggregate(cls, parsed_query: ParsedQuery, node_ids: List[str]) -> QueryPlan:
        sub_select_items = []
        merge_context = {}

        for i, item in enumerate(parsed_query.select_items):
            if not item.is_aggregate:
                continue

            agg_func = item.agg_func
            agg_arg = item.agg_arg

            if agg_func == "COUNT":
                sub_select_items.append({
                    "type": "aggregate",
                    "func": "COUNT",
                    "arg": agg_arg,
                    "alias": f"_cnt_{i}"
                })
                merge_context[f"_cnt_{i}"] = {
                    "op": "sum",
                    "target_alias": item.display_name
                }

            elif agg_func == "SUM":
                sub_select_items.append({
                    "type": "aggregate",
                    "func": "SUM",
                    "arg": agg_arg,
                    "alias": f"_sum_{i}"
                })
                merge_context[f"_sum_{i}"] = {
                    "op": "sum",
                    "target_alias": item.display_name
                }

            elif agg_func == "AVG":
                sub_select_items.append({
                    "type": "aggregate",
                    "func": "SUM",
                    "arg": agg_arg,
                    "alias": f"_sum_{i}"
                })
                sub_select_items.append({
                    "type": "aggregate",
                    "func": "COUNT",
                    "arg": agg_arg,
                    "alias": f"_cnt_{i}"
                })
                merge_context[f"_avg_{i}"] = {
                    "op": "avg",
                    "sum_alias": f"_sum_{i}",
                    "cnt_alias": f"_cnt_{i}",
                    "target_alias": item.display_name
                }

        sub_queries = []
        for node_id in node_ids:
            sub_queries.append(SubQuery(
                node_id=node_id,
                select_items=sub_select_items,
                where_condition=parsed_query.where_condition,
                is_aggregate=True
            ))

        return QueryPlan(
            original_query=parsed_query,
            sub_queries=sub_queries,
            merge_strategy="aggregate",
            merge_context=merge_context
        )

    @classmethod
    def _plan_non_aggregate(cls, parsed_query: ParsedQuery, node_ids: List[str]) -> QueryPlan:
        sub_select_items = []
        for item in parsed_query.select_items:
            sub_select_items.append({
                "type": "column",
                "name": item.column_name,
                "alias": item.display_name
            })

        sub_queries = []
        for node_id in node_ids:
            sub_queries.append(SubQuery(
                node_id=node_id,
                select_items=sub_select_items,
                where_condition=parsed_query.where_condition,
                is_aggregate=False
            ))

        return QueryPlan(
            original_query=parsed_query,
            sub_queries=sub_queries,
            merge_strategy="union",
            merge_context={
                "columns": [item.display_name for item in parsed_query.select_items]
            }
        )


class ResultMerger:
    @staticmethod
    def merge(query_plan: QueryPlan, node_results: Dict[str, Any]) -> Any:
        if query_plan.merge_strategy == "union":
            return ResultMerger._merge_union(query_plan, node_results)
        elif query_plan.merge_strategy == "aggregate":
            return ResultMerger._merge_aggregate(query_plan, node_results)
        else:
            raise ValueError(f"Unknown merge strategy: {query_plan.merge_strategy}")

    @staticmethod
    def _merge_union(query_plan: QueryPlan, node_results: Dict[str, Any]) -> List[Dict]:
        all_rows = []
        for node_id, result in node_results.items():
            if "rows" in result:
                all_rows.extend(result["rows"])
        return all_rows

    @staticmethod
    def _merge_aggregate(query_plan: QueryPlan, node_results: Dict[str, Any]) -> Dict:
        merged = {}

        for key, strategy in query_plan.merge_context.items():
            target_name = strategy["target_alias"]

            if strategy["op"] == "sum":
                alias = key
                total = 0
                for node_id, result in node_results.items():
                    if "aggregate" in result and alias in result["aggregate"]:
                        total += result["aggregate"][alias]
                merged[target_name] = total

            elif strategy["op"] == "avg":
                sum_alias = strategy["sum_alias"]
                cnt_alias = strategy["cnt_alias"]
                total_sum = 0
                total_cnt = 0
                for node_id, result in node_results.items():
                    if "aggregate" in result:
                        total_sum += result["aggregate"].get(sum_alias, 0)
                        total_cnt += result["aggregate"].get(cnt_alias, 0)
                merged[target_name] = total_sum / total_cnt if total_cnt > 0 else 0

        return merged
