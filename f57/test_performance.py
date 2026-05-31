import time
import sys
from backend.data_import import NetFlowGenerator, Neo4jImporter
from backend.graph_algorithms import GraphAnalyzer
from config import NEO4J_CONFIG


def test_large_scale(node_count=1000, edge_count=5000):
    print(f"{'='*60}")
    print(f"性能测试: {node_count} 节点, {edge_count} 边")
    print(f"{'='*60}\n")

    print("[1/4] 生成测试数据...")
    start = time.time()
    generator = NetFlowGenerator(
        num_nodes=node_count,
        num_edges=edge_count,
        anomaly_ratio=0.1
    )
    df = generator.generate_netflow_data()
    gen_time = time.time() - start
    print(f"  ✓ 生成 {len(df)} 条记录，耗时: {gen_time:.2f}s\n")

    print("[2/4] 导入 Neo4j...")
    start = time.time()
    importer = Neo4jImporter(
        uri=NEO4J_CONFIG["uri"],
        user=NEO4J_CONFIG["user"],
        password=NEO4J_CONFIG["password"],
        database=NEO4J_CONFIG["database"]
    )

    try:
        importer.clear_database()
        importer.import_netflow_data(df)
        import_time = time.time() - start
        print(f"  ✓ 导入完成，耗时: {import_time:.2f}s\n")
    finally:
        importer.close()

    print("[3/4] 运行图分析...")
    start = time.time()
    analyzer = GraphAnalyzer(
        uri=NEO4J_CONFIG["uri"],
        user=NEO4J_CONFIG["user"],
        password=NEO4J_CONFIG["password"],
        database=NEO4J_CONFIG["database"]
    )

    try:
        result = analyzer.analyze_full_graph()
        analyze_time = time.time() - start
        print(f"  ✓ 分析完成")
        print(f"    - 节点数: {result['statistics']['total_nodes']}")
        print(f"    - 边数: {result['statistics']['total_edges']}")
        print(f"    - 显示边数: {result['statistics']['display_edges']}")
        print(f"    - 社区数: {result['statistics']['num_communities']}")
        print(f"    - 异常节点: {result['statistics']['num_anomaly_nodes']}")
        print(f"    - 分析耗时: {analyze_time:.2f}s\n")
    finally:
        analyzer.close()

    print("[4/4] 性能评估...")
    total_time = gen_time + import_time + analyze_time
    print(f"  ✓ 总耗时: {total_time:.2f}s")
    print(f"  ✓ 预期前端 FPS: 30-60 (基于 Canvas 渲染)\n")

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "gen_time": gen_time,
        "import_time": import_time,
        "analyze_time": analyze_time,
        "total_time": total_time
    }


def main():
    print("\n网络流量分析系统 - 性能测试套件")
    print("=" * 60)

    if len(sys.argv) > 1:
        node_count = int(sys.argv[1])
        edge_count = int(sys.argv[2]) if len(sys.argv) > 2 else node_count * 5
        test_large_scale(node_count, edge_count)
    else:
        print("选择测试规模:")
        print("  1. 小规模 (200节点, 1000边)")
        print("  2. 中规模 (500节点, 3000边)")
        print("  3. 大规模 (1000节点, 6000边)")
        print("  4. 超大规模 (2000节点, 15000边)")
        print("  5. 自定义")

        choice = input("\n请输入选项 (1-5): ").strip()

        if choice == "1":
            test_large_scale(200, 1000)
        elif choice == "2":
            test_large_scale(500, 3000)
        elif choice == "3":
            test_large_scale(1000, 6000)
        elif choice == "4":
            test_large_scale(2000, 15000)
        elif choice == "5":
            nodes = int(input("节点数: "))
            edges = int(input("边数: "))
            test_large_scale(nodes, edges)
        else:
            print("无效选项")


if __name__ == "__main__":
    main()
