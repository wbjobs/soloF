import sys
import argparse
from backend.data_import import generate_and_import_data
from backend.graph_algorithms import run_analysis
from backend.api import run_server


def main():
    parser = argparse.ArgumentParser(description="网络流量分析系统")
    parser.add_argument(
        "mode",
        choices=["import", "analyze", "server", "all"],
        help="运行模式: import(导入数据), analyze(运行分析), server(启动API服务), all(全部执行)"
    )

    args = parser.parse_args()

    if args.mode == "import":
        generate_and_import_data()
    elif args.mode == "analyze":
        run_analysis()
    elif args.mode == "server":
        run_server()
    elif args.mode == "all":
        print("=" * 50)
        print("步骤 1: 生成并导入 NetFlow 数据")
        print("=" * 50)
        generate_and_import_data()

        print("\n" + "=" * 50)
        print("步骤 2: 运行图分析算法")
        print("=" * 50)
        run_analysis()

        print("\n" + "=" * 50)
        print("步骤 3: 启动 API 服务")
        print("=" * 50)
        run_server()


if __name__ == "__main__":
    main()
