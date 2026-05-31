import argparse
import sys
from pathlib import Path

from src.config import Config
from src.data_processor import DataProcessor
from src.retriever import Retriever
from src.generator import AnswerGenerator


def process_documents(args):
    print(f"正在处理文档目录: {args.input_dir}")

    processor = DataProcessor()

    try:
        total_splits = processor.process_pdfs(args.input_dir)
        print(f"✅ 处理完成！共生成 {total_splits} 个文档片段")
    except Exception as e:
        print(f"❌ 处理失败: {str(e)}")
        sys.exit(1)


def search_documents(args):
    processor = DataProcessor()
    retriever = Retriever(processor.get_vector_store())

    print(f"正在检索: {args.query}\n")

    docs = retriever.search(args.query)

    if not docs:
        print("未找到相关文档")
        return

    print(f"找到 {len(docs)} 个相关片段:\n")
    for i, doc in enumerate(docs, 1):
        ref_id = doc.metadata.get("ref_id", f"REF-{i}")
        source = doc.metadata.get("source", "未知来源")
        page = doc.metadata.get("page", "未知页码")
        print(f"--- [{ref_id}] {source} (第 {page} 页) ---")
        print(doc.page_content)
        print()


def ask_question(args):
    processor = DataProcessor()
    retriever = Retriever(processor.get_vector_store())
    generator = AnswerGenerator(retriever, use_multi_hop=not args.no_multi_hop)

    print(f"问题: {args.query}\n")

    q_type = generator.detect_question_type(args.query)
    if q_type.get("is_multi_hop", False) and not args.no_multi_hop:
        type_names = {
            "comparison": "对比分析型",
            "analysis": "关系分析型",
            "synthesis": "综合总结型",
            "enumeration": "列举型",
            "combination": "组合型",
            "causal": "因果分析型"
        }
        type_name = type_names.get(q_type["question_type"], "复杂问题")
        print(f"🧠 检测到{type_name}问题，使用多跳检索\n")
    elif args.force_multi_hop:
        print("🔗 强制使用多跳检索\n")

    print("正在生成回答...\n")

    result = generator.generate(args.query, force_multi_hop=args.force_multi_hop)

    print("回答:")
    print(result["answer"])
    print()

    retrieval_stats = result.get("retrieval_stats", {})
    if retrieval_stats.get("is_multi_hop", False):
        print(f"🔗 多跳检索统计:")
        sub_queries = retrieval_stats.get("sub_queries", [])
        for i, sq in enumerate(sub_queries, 1):
            print(f"  子查询 {i}: {sq}")
        print(f"  去重前: {retrieval_stats.get('total_docs_before_dedup', 0)} 条, "
              f"去重后: {retrieval_stats.get('unique_docs', 0)} 条")
        print()

    if result.get("cited_sources"):
        print("✅ 实际引用来源:")
        for src in result["cited_sources"]:
            sub_query_info = f" (子查询: {src.get('sub_query', 'N/A')})" if src.get("sub_query") else ""
            print(f"  [{src['number']}] {src['source']} (第 {src['page']} 页){sub_query_info}")
        print()

    if result.get("validation_stats"):
        stats = result["validation_stats"]
        print(f"📊 引用验证: 有效 {stats.get('valid_mentions', 0)} 个, "
              f"过滤无效 {stats.get('invalid_mentions', 0)} 个")


def main():
    parser = argparse.ArgumentParser(description="离线法律卷宗检索工具")
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    process_parser = subparsers.add_parser("process", help="批量处理PDF文档")
    process_parser.add_argument("input_dir", help="包含PDF文件的目录路径")

    search_parser = subparsers.add_parser("search", help="检索相关文档片段")
    search_parser.add_argument("query", help="检索查询")
    search_parser.add_argument("--no-multi-hop", action="store_true", help="禁用多跳检索")

    ask_parser = subparsers.add_parser("ask", help="问答系统")
    ask_parser.add_argument("query", help="问题")
    ask_parser.add_argument("--no-multi-hop", action="store_true", help="禁用多跳检索")
    ask_parser.add_argument("--force-multi-hop", action="store_true", help="强制使用多跳检索")

    args = parser.parse_args()

    if args.command == "process":
        process_documents(args)
    elif args.command == "search":
        search_documents(args)
    elif args.command == "ask":
        ask_question(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
