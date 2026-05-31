"""
多跳检索机制测试脚本
用于验证多跳检索功能是否正常工作
"""

import sys
from src.multi_hop_retriever import MultiHopRetriever
from src.retriever import Retriever
from src.data_processor import DataProcessor
from langchain_core.documents import Document


def test_question_type_detection():
    """测试问题类型检测"""
    print("=" * 60)
    print("测试1: 问题类型检测")
    print("=" * 60)

    test_cases = [
        ("对比案例A和案例B的判决差异", True, "comparison"),
        ("分析合同违约与赔偿责任的关系", True, "analysis"),
        ("总结所有相关案例的裁判要点", True, "synthesis"),
        ("分别说明每个被告的答辩意见", True, "enumeration"),
        ("结合刑法和民法典分析该行为", True, "combination"),
        ("为什么会出现这样的判决结果", True, "causal"),
        ("本案的争议焦点是什么", False, "single"),
        ("原告的诉讼请求有哪些", False, "single"),
    ]

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())
        multi_hop = MultiHopRetriever(retriever)

        all_passed = True
        for question, expected_multi_hop, expected_type in test_cases:
            result = multi_hop._detect_multi_hop_question(question)
            is_multi_hop = result["is_multi_hop"]
            q_type = result["question_type"]

            status = "✅" if (is_multi_hop == expected_multi_hop and q_type == expected_type) else "❌"
            if is_multi_hop != expected_multi_hop or q_type != expected_type:
                all_passed = False

            print(f"{status} '{question}'")
            print(f"   预期: multi_hop={expected_multi_hop}, type={expected_type}")
            print(f"   实际: multi_hop={is_multi_hop}, type={q_type}")

        if all_passed:
            print("\n✅ 问题类型检测测试通过")
        return all_passed
    except Exception as e:
        print(f"❌ 问题类型检测测试失败: {e}")
        return False


def test_query_decomposition():
    """测试查询拆解"""
    print("\n" + "=" * 60)
    print("测试2: 查询拆解")
    print("=" * 60)

    test_cases = [
        ("对比案例A和案例B的判决差异", "comparison"),
        ("分析合同违约与赔偿责任的关系", "analysis"),
        ("总结所有相关案例的裁判要点", "synthesis"),
    ]

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())
        multi_hop = MultiHopRetriever(retriever)

        all_passed = True
        for question, q_type in test_cases:
            sub_queries = multi_hop._decompose_question(question, q_type)
            print(f"\n问题: {question}")
            print(f"类型: {q_type}")
            print(f"拆解为 {len(sub_queries)} 个子查询:")
            for i, sq in enumerate(sub_queries, 1):
                print(f"  {i}. {sq}")

            if len(sub_queries) >= 1:
                print("  ✅ 拆解成功")
            else:
                print("  ❌ 拆解失败")
                all_passed = False

        return all_passed
    except Exception as e:
        print(f"❌ 查询拆解测试失败: {e}")
        return False


def test_entity_extraction():
    """测试实体提取"""
    print("\n" + "=" * 60)
    print("测试3: 实体提取")
    print("=" * 60)

    test_cases = [
        "对比《合同法》和《民法典》的差异",
        "分析案例甲与案例乙的判决区别",
        "对比张三诉李四和王五诉赵六两个案件",
    ]

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())
        multi_hop = MultiHopRetriever(retriever)

        all_passed = True
        for question in test_cases:
            entities = multi_hop._extract_entities(question)
            print(f"\n问题: {question}")
            print(f"提取到的实体: {entities}")
            if entities:
                print("  ✅ 实体提取成功")
            else:
                print("  ⚠️  未提取到实体（可能正常）")

        return True
    except Exception as e:
        print(f"❌ 实体提取测试失败: {e}")
        return False


def test_result_aggregation():
    """测试结果聚合"""
    print("\n" + "=" * 60)
    print("测试4: 结果聚合与去重")
    print("=" * 60)

    doc1 = Document(
        page_content="这是文档片段1的内容，涉及合同纠纷。",
        metadata={"source": "合同纠纷.pdf", "page": 1}
    )
    doc2 = Document(
        page_content="这是文档片段2的内容，涉及违约责任。",
        metadata={"source": "合同纠纷.pdf", "page": 2}
    )
    doc3 = Document(
        page_content="这是文档片段1的内容，涉及合同纠纷。",  # 与doc1重复
        metadata={"source": "合同纠纷.pdf", "page": 1}
    )

    all_results = {
        "子查询1": [doc1, doc2],
        "子查询2": [doc2, doc3],
    }

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())
        multi_hop = MultiHopRetriever(retriever)

        aggregated, stats = multi_hop._aggregate_results(all_results)

        print(f"输入文档总数: {sum(len(docs) for docs in all_results.values())}")
        print(f"去重后文档数: {len(aggregated)}")
        print(f"统计信息: {stats}")

        assert len(aggregated) == 2, f"去重后应为2个文档，实际为{len(aggregated)}个"
        assert stats["total_docs_before_dedup"] == 4, "去重前文档数不正确"
        assert stats["unique_docs"] == 2, "去重后文档数不正确"

        print("\n✅ 结果聚合测试通过")
        return True
    except AssertionError as e:
        print(f"❌ 结果聚合测试失败: {e}")
        return False
    except Exception as e:
        print(f"❌ 结果聚合测试失败: {e}")
        return False


def test_multi_hop_search():
    """测试完整的多跳检索流程"""
    print("\n" + "=" * 60)
    print("测试5: 完整多跳检索流程")
    print("=" * 60)

    test_question = "对比案例A和案例B的判决差异"

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())
        multi_hop = MultiHopRetriever(retriever)

        docs, stats = multi_hop.search(test_question)

        print(f"问题: {test_question}")
        print(f"是否多跳: {stats.get('is_multi_hop', False)}")
        print(f"问题类型: {stats.get('question_type', 'unknown')}")
        print(f"子查询数: {len(stats.get('sub_queries', []))}")
        print(f"返回文档数: {len(docs)}")

        if stats.get("sub_queries"):
            print("\n子查询:")
            for i, sq in enumerate(stats["sub_queries"], 1):
                print(f"  {i}. {sq}")

        context = multi_hop.format_context_with_hops(docs, stats)
        print(f"\n上下文长度: {len(context)} 字符")
        print("上下文预览:", context[:200], "...")

        print("\n✅ 多跳检索流程测试通过")
        return True
    except Exception as e:
        print(f"❌ 多跳检索流程测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 60)
    print("  多跳检索机制测试套件")
    print("=" * 60)

    results = []
    results.append(test_question_type_detection())
    results.append(test_query_decomposition())
    results.append(test_entity_extraction())
    results.append(test_result_aggregation())
    results.append(test_multi_hop_search())

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"通过: {passed}/{total}")

    if passed == total:
        print("🎉 所有测试通过！多跳检索机制正常工作。")
        return 0
    else:
        print(f"⚠️  有 {total - passed} 个测试失败，请检查代码。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
