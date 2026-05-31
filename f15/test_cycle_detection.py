#!/usr/bin/env python3
"""
循环依赖检测测试脚本
测试Kahn算法是否能正确检测DAG中的循环依赖
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.schemas import DAGConfig, Node, Edge, NodeConfig
from app.dag_validator import validate_workflow_dag, validate_dag_with_kahn


def create_test_dag(nodes_data, edges_data):
    """创建测试用的DAG配置"""
    nodes = []
    for node_id, label, node_type in nodes_data:
        nodes.append(Node(
            id=node_id,
            label=label,
            x=0,
            y=0,
            config=NodeConfig(type=node_type)
        ))
    
    edges = []
    for source, target in edges_data:
        edges.append(Edge(id=f'{source}_{target}', source=source, target=target))
    
    return DAGConfig(nodes=nodes, edges=edges)


def test_case_1_simple_cycle():
    """测试用例1: 简单循环 A -> B -> C -> A"""
    print("\n=== 测试用例1: 简单循环 A -> B -> C -> A ===")
    dag = create_test_dag(
        [('A', '节点A', 'shell'), ('B', '节点B', 'python'), ('C', '节点C', 'http')],
        [('A', 'B'), ('B', 'C'), ('C', 'A')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"循环路径: {result.cycle_path}")
    print(f"消息: {result.message}")
    assert result.has_cycle == True, "应该检测到循环"
    assert len(result.cycle_path) > 0, "应该返回循环路径"
    print("✓ 通过")


def test_case_2_no_cycle():
    """测试用例2: 无循环的DAG"""
    print("\n=== 测试用例2: 无循环的DAG ===")
    dag = create_test_dag(
        [('A', '节点A', 'shell'), ('B', '节点B', 'python'), ('C', '节点C', 'http')],
        [('A', 'B'), ('B', 'C')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"消息: {result.message}")
    assert result.has_cycle == False, "不应该检测到循环"
    print("✓ 通过")


def test_case_3_self_loop():
    """测试用例3: 自循环 A -> A"""
    print("\n=== 测试用例3: 自循环 A -> A ===")
    dag = create_test_dag(
        [('A', '节点A', 'shell')],
        [('A', 'A')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"循环路径: {result.cycle_path}")
    print(f"消息: {result.message}")
    assert result.has_cycle == True, "应该检测到自循环"
    print("✓ 通过")


def test_case_4_complex_graph():
    """测试用例4: 复杂图中的循环"""
    print("\n=== 测试用例4: 复杂图中的循环 ===")
    # A -> B -> C -> D
    #        ↓    ↑
    #        E -> F
    # C -> E -> F -> C 形成循环
    dag = create_test_dag(
        [('A', '节点A', 'shell'), ('B', '节点B', 'python'), ('C', '节点C', 'http'),
         ('D', '节点D', 'shell'), ('E', '节点E', 'python'), ('F', '节点F', 'http')],
        [('A', 'B'), ('B', 'C'), ('C', 'D'), ('B', 'E'), ('E', 'F'), ('C', 'E'), ('F', 'C')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"循环路径: {result.cycle_path}")
    print(f"消息: {result.message}")
    assert result.has_cycle == True, "应该检测到循环"
    print("✓ 通过")


def test_case_5_empty_dag():
    """测试用例5: 空DAG"""
    print("\n=== 测试用例5: 空DAG ===")
    dag = DAGConfig(nodes=[], edges=[])
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"消息: {result.message}")
    assert result.has_cycle == False, "空DAG不应该有循环"
    print("✓ 通过")


def test_case_6_single_node():
    """测试用例6: 单个节点无连接"""
    print("\n=== 测试用例6: 单个节点无连接 ===")
    dag = create_test_dag(
        [('A', '节点A', 'shell')],
        []
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"消息: {result.message}")
    assert result.has_cycle == False, "单个节点无循环"
    print("✓ 通过")


def test_case_7_parallel_dag():
    """测试用例7: 并行任务DAG"""
    print("\n=== 测试用例7: 并行任务DAG ===")
    dag = create_test_dag(
        [('A', '节点A', 'shell'), ('B', '节点B', 'python'), ('C', '节点C', 'http'), ('D', '节点D', 'shell')],
        [('A', 'B'), ('A', 'C'), ('B', 'D'), ('C', 'D')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"消息: {result.message}")
    assert result.has_cycle == False, "并行DAG应该无循环"
    print("✓ 通过")


def test_case_8_two_cycles():
    """测试用例8: 图中存在两个循环"""
    print("\n=== 测试用例8: 图中存在两个循环 ===")
    # A -> B -> A (第一个循环)
    # C -> D -> C (第二个循环)
    dag = create_test_dag(
        [('A', '节点A', 'shell'), ('B', '节点B', 'python'), 
         ('C', '节点C', 'http'), ('D', '节点D', 'shell')],
        [('A', 'B'), ('B', 'A'), ('C', 'D'), ('D', 'C')]
    )
    result = validate_workflow_dag(dag)
    print(f"检测结果: {'发现循环' if result.has_cycle else '无循环'}")
    print(f"循环路径: {result.cycle_path}")
    print(f"消息: {result.message}")
    assert result.has_cycle == True, "应该检测到循环"
    print("✓ 通过")


if __name__ == '__main__':
    print("=" * 50)
    print("开始测试循环依赖检测功能")
    print("=" * 50)
    
    try:
        test_case_1_simple_cycle()
        test_case_2_no_cycle()
        test_case_3_self_loop()
        test_case_4_complex_graph()
        test_case_5_empty_dag()
        test_case_6_single_node()
        test_case_7_parallel_dag()
        test_case_8_two_cycles()
        
        print("\n" + "=" * 50)
        print("所有测试通过! ✓")
        print("=" * 50)
    except AssertionError as e:
        print(f"\n测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
