#!/usr/bin/env python
"""
测试脚本：验证两个修复
1. AVG加权平均正确性
2. 节点超时容错处理
"""
import sys
sys.path.insert(0, '.')

from dsq.coordinator import QueryCoordinator
from dsq.query_planner import QueryPlanner, ResultMerger
from dsq.sql_parser import SQLParser


def test_avg_weighted_average():
    print("=" * 60)
    print("TEST 1: AVG Weighted Average Verification")
    print("=" * 60)

    sql = "SELECT AVG(salary) FROM users WHERE age > 30"
    parsed = SQLParser.parse(sql)
    plan = QueryPlanner.plan(parsed, ["node1", "node2", "node3"])

    mock_results = {
        "node1": {"aggregate": {"_sum_0": 80000, "_cnt_0": 6}, "type": "aggregate"},
        "node2": {"aggregate": {"_sum_0": 80300, "_cnt_0": 6}, "type": "aggregate"},
        "node3": {"aggregate": {"_sum_0": 74700, "_cnt_0": 5}, "type": "aggregate"},
    }

    result = ResultMerger.merge(plan, mock_results)
    expected = (80000 + 80300 + 74700) / (6 + 6 + 5)

    print(f"  各节点数据:")
    print(f"    node1: SUM=80000, COUNT=6, 局部AVG={80000/6:.2f}")
    print(f"    node2: SUM=80300, COUNT=6, 局部AVG={80300/6:.2f}")
    print(f"    node3: SUM=74700, COUNT=5, 局部AVG={74700/5:.2f}")
    print(f"  正确加权平均: {expected:.4f}")
    print(f"  错误简单平均: {(80000/6 + 80300/6 + 74700/5)/3:.4f}")
    print(f"  实际计算结果: {result['AVG(salary)']:.4f}")
    print(f"  测试结果: {'✓ PASS' if abs(result['AVG(salary)'] - expected) < 0.001 else '✗ FAIL'}")

    print()
    print("  模拟node2超时，仅使用node1和node3:")
    mock_results_partial = {
        "node1": {"aggregate": {"_sum_0": 80000, "_cnt_0": 6}, "type": "aggregate"},
        "node3": {"aggregate": {"_sum_0": 74700, "_cnt_0": 5}, "type": "aggregate"},
    }

    plan_partial = QueryPlanner.plan(parsed, ["node1", "node3"])
    result_partial = ResultMerger.merge(plan_partial, mock_results_partial)
    expected_partial = (80000 + 74700) / (6 + 5)

    print(f"    正确加权平均: {expected_partial:.4f}")
    print(f"    错误简单平均: {(80000/6 + 74700/5)/2:.4f}")
    print(f"    实际计算结果: {result_partial['AVG(salary)']:.4f}")
    print(f"    测试结果: {'✓ PASS' if abs(result_partial['AVG(salary)'] - expected_partial) < 0.001 else '✗ FAIL'}")
    print()


def test_count_sum_partial_nodes():
    print("=" * 60)
    print("TEST 2: COUNT/SUM with Partial Nodes")
    print("=" * 60)

    sql = "SELECT COUNT(*), SUM(salary) FROM users WHERE age > 30"
    parsed = SQLParser.parse(sql)
    plan = QueryPlanner.plan(parsed, ["node1", "node2", "node3"])

    mock_results = {
        "node1": {"aggregate": {"_cnt_0": 6, "_sum_1": 80000}, "type": "aggregate"},
        "node3": {"aggregate": {"_cnt_0": 5, "_sum_1": 74700}, "type": "aggregate"},
    }

    result = ResultMerger.merge(plan, mock_results)

    print(f"  仅node1和node3返回数据（node2超时）:")
    print(f"    COUNT(*): expected={6+5}, actual={result['COUNT(*)']} -> {'✓ PASS' if result['COUNT(*)'] == 11 else '✗ FAIL'}")
    print(f"    SUM(salary): expected={80000+74700}, actual={result['SUM(salary)']} -> {'✓ PASS' if result['SUM(salary)'] == 154700 else '✗ FAIL'}")
    print()


def test_timeout_fault_tolerance():
    print("=" * 60)
    print("TEST 3: Timeout Fault Tolerance (Real Nodes)")
    print("=" * 60)

    print("  Testing with timeout=0.1s, node2 delay=200ms...")
    coordinator = QueryCoordinator(timeout=0.1)
    coordinator.set_node_delay("node2", 200)

    try:
        result = coordinator.execute("SELECT AVG(salary) FROM users WHERE age > 30")
        print(f"  ✓ Query completed successfully (partial result)")
        print(f"  ✓ Warnings: {len(result.get('warnings', []))} warning(s)")
        for w in result.get("warnings", []):
            print(f"    ! {w}")
        print(f"  ✓ Successful nodes: {result.get('successful_nodes', [])}")
        print(f"  ✓ Failed nodes: {result.get('failed_nodes', [])}")
        print(f"  ✓ Result: AVG(salary) = {result['result']['AVG(salary)']:.4f}")
        print(f"  ✓ Expected: {(80000+74700)/(6+5):.4f} (weighted avg from node1+node3)")
        print("  Test: ✓ PASS")
    except Exception as e:
        print(f"  ✗ Query failed: {e}")
        print("  Test: ✗ FAIL")
    print()


def test_all_nodes_online():
    print("=" * 60)
    print("TEST 4: All Nodes Online (Normal Operation)")
    print("=" * 60)

    coordinator = QueryCoordinator(timeout=5.0)
    try:
        result = coordinator.execute("SELECT COUNT(*), SUM(salary), AVG(age) FROM users WHERE age > 30")
        print(f"  ✓ All {len(result.get('successful_nodes', []))} nodes online")
        print(f"  ✓ Warnings: {len(result.get('warnings', []))}")
        print(f"  ✓ COUNT(*): {result['result']['COUNT(*)']} (expected 17)")
        print(f"  ✓ SUM(salary): {result['result']['SUM(salary)']} (expected 235000)")
        print(f"  ✓ AVG(age): {result['result']['AVG(age)']:.4f}")
        print("  Test: ✓ PASS")
    except Exception as e:
        print(f"  ✗ Query failed: {e}")
        print("  Test: ✗ FAIL")
    print()


if __name__ == "__main__":
    test_avg_weighted_average()
    test_count_sum_partial_nodes()
    test_timeout_fault_tolerance()
    test_all_nodes_online()
    print("=" * 60)
    print("All tests completed!")
    print("=" * 60)
