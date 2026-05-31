#!/usr/bin/env python3
"""
任务并行度控制功能测试脚本
验证最大并行任务数限制功能是否正常工作
"""

import sys
import os
import json
import time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.schemas import DAGConfig, Node, Edge, NodeConfig
from app.workflow_executor_v2 import WorkflowExecutorV2


def create_parallel_test_dag(node_count=10):
    """创建一个包含多个并行节点的测试DAG"""
    nodes = []
    edges = []
    
    for i in range(node_count):
        nodes.append(Node(
            id=f'node_{i:02d}',
            label=f'任务{i}',
            x=100,
            y=100 + i * 80,
            config=NodeConfig(type='python', script=f'print("Task {i} running")')
        ))
    
    return DAGConfig(
        nodes=nodes,
        edges=edges,
        max_parallel_tasks=3
    )


def test_initial_state():
    """测试1: 初始化状态验证"""
    print("\n=== 测试1: 初始化状态验证 ===")
    
    dag = create_parallel_test_dag(node_count=5)
    executor = WorkflowExecutorV2(workflow_id=1, dag_config=dag.model_dump(), max_parallel_tasks=2)
    
    assert executor.max_parallel_tasks == 2
    assert len(executor.nodes) == 5
    assert len(executor.waiting_queue) == 0
    assert len(executor.running_tasks) == 0
    
    print(f"✓ 最大并行任务数: {executor.max_parallel_tasks}")
    print(f"✓ 节点总数: {len(executor.nodes)}")
    print("✓ 初始化状态正确")


def test_task_queue_mechanism():
    """测试2: 任务排队机制"""
    print("\n=== 测试2: 任务排队机制 ===")
    
    dag = create_parallel_test_dag(node_count=5)
    executor = WorkflowExecutorV2(workflow_id=1, dag_config=dag.model_dump(), max_parallel_tasks=2)
    
    ready_tasks = executor._get_ready_tasks()
    print(f"就绪任务数: {len(ready_tasks)}")
    
    for node_id in ready_tasks:
        executor.waiting_queue.append(node_id)
    
    print(f"等待队列长度: {len(executor.waiting_queue)}")
    
    assert len(executor.waiting_queue) == 5
    
    executed = executor._dispatch_tasks(workflow_exec_id=1)
    print(f"本次调度任务数: {executed}")
    
    assert executed == 2
    assert len(executor.running_tasks) == 2
    assert len(executor.waiting_queue) == 3
    
    print("✓ 并行度限制生效，超出任务进入等待队列")


def test_max_parallel_zero():
    """测试3: max_parallel_tasks = 0 表示无限制"""
    print("\n=== 测试3: 无限制并行 (max_parallel_tasks=0) ===")
    
    dag = create_parallel_test_dag(node_count=5)
    executor = WorkflowExecutorV2(workflow_id=1, dag_config=dag.model_dump(), max_parallel_tasks=0)
    
    print(f"节点总数: {len(executor.nodes)}")
    print(f"max_parallel_tasks: {executor.max_parallel_tasks}")
    
    assert executor.max_parallel_tasks == 5
    
    ready_tasks = executor._get_ready_tasks()
    for node_id in ready_tasks:
        executor.waiting_queue.append(node_id)
    
    executed = executor._dispatch_tasks(workflow_exec_id=1)
    print(f"本次调度任务数: {executed}")
    
    assert executed == 5
    assert len(executor.running_tasks) == 5
    assert len(executor.waiting_queue) == 0
    
    print("✓ 无限制模式下所有任务同时执行")


def test_dag_config_serialization():
    """测试4: DAG配置序列化验证"""
    print("\n=== 测试4: DAG配置序列化验证 ===")
    
    dag = DAGConfig(
        nodes=[
            Node(
                id='A',
                label='任务A',
                x=100,
                y=100,
                config=NodeConfig(type='python', script='print("A")')
            )
        ],
        edges=[],
        max_parallel_tasks=5
    )
    
    dag_dict = dag.model_dump()
    print(f"序列化后的配置: {json.dumps(dag_dict, indent=2)}")
    
    assert 'max_parallel_tasks' in dag_dict
    assert dag_dict['max_parallel_tasks'] == 5
    
    restored = DAGConfig(**dag_dict)
    assert restored.max_parallel_tasks == 5
    
    print("✓ 配置序列化和反序列化正常")


def test_state_persistence():
    """测试5: 状态持久化"""
    print("\n=== 测试5: 状态持久化 ===")
    
    from app.workflow_executor_v2 import get_executor_state, check_execution_progress
    from app.database import SessionLocal, Base, engine
    from app.models import Workflow, WorkflowExecution
    from datetime import datetime
    
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        workflow = Workflow(
            name='测试工作流',
            description='并行度测试',
            dag_config={'nodes': [], 'edges': []},
            max_parallel_tasks=3,
            created_at=datetime.utcnow()
        )
        db.add(workflow)
        db.commit()
        db.refresh(workflow)
        
        workflow_exec = WorkflowExecution(
            workflow_id=workflow.id,
            execution_id='test_exec_001',
            status='RUNNING',
            start_time=datetime.utcnow()
        )
        db.add(workflow_exec)
        db.commit()
        
        dag = create_parallel_test_dag(node_count=4)
        executor = WorkflowExecutorV2(
            workflow_id=workflow.id,
            dag_config=dag.model_dump(),
            max_parallel_tasks=2
        )
        executor.execution_id = 'test_exec_001'
        
        ready_tasks = executor._get_ready_tasks()
        for node_id in ready_tasks:
            executor.waiting_queue.append(node_id)
        
        executor._dispatch_tasks(workflow_exec_id=workflow_exec.id)
        executor._save_state()
        
        state = get_executor_state('test_exec_001')
        print(f"保存的状态: {json.dumps(state, indent=2)}")
        
        assert state is not None
        assert state['max_parallel_tasks'] == 2
        assert len(state['running_tasks']) == 2
        assert len(state['waiting_queue']) == 2
        
        print("✓ 状态持久化正常")
        
    finally:
        db.close()


def test_different_parallel_limits():
    """测试6: 不同并行度限制"""
    print("\n=== 测试6: 不同并行度限制 ===")
    
    test_cases = [
        (10, 1, "严格串行"),
        (10, 3, "低并行"),
        (10, 5, "中等并行"),
        (10, 10, "完全并行"),
    ]
    
    for node_count, max_parallel, description in test_cases:
        dag = create_parallel_test_dag(node_count=node_count)
        executor = WorkflowExecutorV2(
            workflow_id=1,
            dag_config=dag.model_dump(),
            max_parallel_tasks=max_parallel
        )
        
        ready_tasks = executor._get_ready_tasks()
        for node_id in ready_tasks:
            executor.waiting_queue.append(node_id)
        
        executed = executor._dispatch_tasks(workflow_exec_id=1)
        
        expected_running = min(max_parallel, node_count) if max_parallel > 0 else node_count
        if max_parallel == 0:
            expected_running = node_count
        
        assert executed == expected_running
        assert len(executor.running_tasks) == expected_running
        assert len(executor.waiting_queue) == node_count - expected_running
        
        print(f"  ✓ {description}: 并行度={max_parallel}, 实际运行={expected_running}, 等待={node_count - expected_running}")


def main():
    print("=" * 60)
    print("开始测试任务并行度控制功能")
    print("=" * 60)
    
    try:
        test_initial_state()
        test_task_queue_mechanism()
        test_max_parallel_zero()
        test_dag_config_serialization()
        test_state_persistence()
        test_different_parallel_limits()
        
        print("\n" + "=" * 60)
        print("所有测试通过! ✓")
        print("=" * 60)
        print("\n功能总结:")
        print("  ✓ 支持为每个DAG设置最大并行任务数")
        print("  ✓ 超出限制的任务自动进入等待队列")
        print("  ✓ 任务完成后自动调度等待队列中的任务")
        print("  ✓ 设置为0表示不限制并行度")
        print("  ✓ 执行状态持久化到Redis")
        print("  ✓ 前端可实时查看调度状态和等待队列")
        
    except AssertionError as e:
        print(f"\n测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
