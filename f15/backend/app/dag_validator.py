from typing import List, Dict, Set, Tuple, Optional
from collections import deque
from app.schemas import DAGConfig


class CycleDetectResult:
    def __init__(self, has_cycle: bool, cycle_path: List[str] = None, message: str = None):
        self.has_cycle = has_cycle
        self.cycle_path = cycle_path or []
        self.message = message or ""


def build_adjacency_list(edges: List[Tuple[str, str]]) -> Dict[str, List[str]]:
    adj: Dict[str, List[str]] = {}
    for source, target in edges:
        if source not in adj:
            adj[source] = []
        adj[source].append(target)
    return adj


def find_cycle_path_dfs(node: str, adj: Dict[str, List[str]], 
                        visited: Set[str], recursion_stack: Set[str], 
                        path: List[str]) -> Optional[List[str]]:
    visited.add(node)
    recursion_stack.add(node)
    path.append(node)
    
    for neighbor in adj.get(node, []):
        if neighbor not in visited:
            result = find_cycle_path_dfs(neighbor, adj, visited, recursion_stack, path)
            if result:
                return result
        elif neighbor in recursion_stack:
            cycle_start = path.index(neighbor)
            cycle_path = path[cycle_start:] + [neighbor]
            return cycle_path
    
    path.pop()
    recursion_stack.remove(node)
    return None


def validate_dag_with_kahn(nodes: List[str], edges: List[Tuple[str, str]]) -> CycleDetectResult:
    if not nodes:
        return CycleDetectResult(False, [], "空DAG")
    
    in_degree: Dict[str, int] = {node: 0 for node in nodes}
    adj: Dict[str, List[str]] = {node: [] for node in nodes}
    
    for source, target in edges:
        if source not in in_degree:
            in_degree[source] = 0
        if target not in in_degree:
            in_degree[target] = 0
        if source not in adj:
            adj[source] = []
        adj[source].append(target)
        in_degree[target] += 1
    
    queue = deque([node for node in nodes if in_degree.get(node, 0) == 0])
    visited_count = 0
    
    while queue:
        node = queue.popleft()
        visited_count += 1
        
        for neighbor in adj.get(node, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
    
    if visited_count != len(nodes):
        all_adj = build_adjacency_list(edges)
        for node in nodes:
            if node not in all_adj:
                all_adj[node] = []
        
        visited: Set[str] = set()
        recursion_stack: Set[str] = set()
        path: List[str] = []
        
        for node in nodes:
            if node not in visited:
                cycle_path = find_cycle_path_dfs(node, all_adj, visited, recursion_stack, path)
                if cycle_path:
                    cycle_str = " → ".join(cycle_path)
                    return CycleDetectResult(
                        True, 
                        cycle_path, 
                        f"检测到循环依赖: {cycle_str}"
                    )
        
        return CycleDetectResult(
            True, 
            [], 
            "存在循环依赖，但未能定位具体路径"
        )
    
    return CycleDetectResult(False, [], "DAG验证通过")


def validate_workflow_dag(dag_config: DAGConfig) -> CycleDetectResult:
    nodes = [node.id for node in dag_config.nodes]
    edges = [(edge.source, edge.target) for edge in dag_config.edges]
    
    if not nodes:
        return CycleDetectResult(False, [], "空工作流")
    
    return validate_dag_with_kahn(nodes, edges)
