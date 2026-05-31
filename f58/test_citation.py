"""
引用验证机制测试脚本
用于验证引用真实性保障机制是否正常工作
"""

import sys
from src.retriever import Retriever
from src.data_processor import DataProcessor
from langchain_core.documents import Document


def test_ref_id_generation():
    """测试引用ID生成"""
    print("=" * 60)
    print("测试1: 引用ID生成")
    print("=" * 60)

    doc1 = Document(
        page_content="这是测试文档1的内容，用于验证引用ID生成机制。",
        metadata={"source": "test1.pdf", "page": 1}
    )
    doc2 = Document(
        page_content="这是测试文档2的内容，与文档1不同。",
        metadata={"source": "test2.pdf", "page": 2}
    )

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())

        ref1 = retriever._generate_ref_id(doc1, 1)
        ref2 = retriever._generate_ref_id(doc2, 2)

        print(f"文档1引用ID: {ref1}")
        print(f"文档2引用ID: {ref2}")

        assert ref1 != ref2, "不同文档应生成不同的引用ID"
        assert ref1.startswith("REF-1-"), "引用ID格式不正确"
        assert ref2.startswith("REF-2-"), "引用ID格式不正确"

        print("✅ 引用ID生成测试通过")
        return True
    except Exception as e:
        print(f"❌ 引用ID生成测试失败: {e}")
        return False


def test_context_formatting():
    """测试上下文格式化"""
    print("\n" + "=" * 60)
    print("测试2: 上下文格式化")
    print("=" * 60)

    doc1 = Document(
        page_content="原告张三与被告李四于2023年1月15日签订房屋买卖合同。",
        metadata={"source": "合同纠纷.pdf", "page": 3}
    )
    doc2 = Document(
        page_content="被告李四辩称已支付全部购房款共计人民币100万元整。",
        metadata={"source": "合同纠纷.pdf", "page": 7}
    )

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())

        context = retriever.format_context([doc1, doc2])
        print("格式化后的上下文:")
        print(context)

        assert "【文件】合同纠纷.pdf" in context, "上下文应包含文件名"
        assert "【页码】第 3 页" in context, "上下文应包含页码"
        assert "REF-1-" in context, "上下文应包含引用ID"
        assert "REF-2-" in context, "上下文应包含引用ID"

        print("✅ 上下文格式化测试通过")
        return True
    except Exception as e:
        print(f"❌ 上下文格式化测试失败: {e}")
        return False


def test_reference_validation():
    """测试引用验证机制"""
    print("\n" + "=" * 60)
    print("测试3: 引用验证机制")
    print("=" * 60)

    sources = [
        {
            "ref_id": "REF-1-abc123",
            "source": "合同纠纷.pdf",
            "page": 3,
            "content": "原告张三..."
        },
        {
            "ref_id": "REF-2-def456",
            "source": "合同纠纷.pdf",
            "page": 7,
            "content": "被告李四..."
        }
    ]

    test_cases = [
        ("原告张三与被告李四签订合同[REF-1-abc123]。", "有效引用"),
        ("被告已支付购房款[REF-2-def456]。", "有效引用"),
        ("原告主张权利[REF-3-xyz789]。", "无效引用（不存在的来源）"),
        ("双方达成和解协议。", "无引用"),
    ]

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())

        all_passed = True
        for answer, description in test_cases:
            result = retriever.validate_references(answer, sources)
            print(f"\n测试用例: {description}")
            print(f"  原始回答: {answer}")
            print(f"  清理后回答: {result['cleaned_answer']}")
            print(f"  有效引用数: {result['valid_mentions_count']}")
            print(f"  无效引用数: {result['invalid_mentions_count']}")
            print(f"  引用来源数: {len(result['cited_sources'])}")

            if description == "无效引用（不存在的来源）":
                if result["invalid_mentions_count"] > 0:
                    print("  ✅ 正确检测到无效引用")
                else:
                    print("  ❌ 未能检测到无效引用")
                    all_passed = False

        if all_passed:
            print("\n✅ 引用验证机制测试通过")
        return all_passed
    except Exception as e:
        print(f"❌ 引用验证机制测试失败: {e}")
        return False


def test_cited_refs_extraction():
    """测试引用来源提取"""
    print("\n" + "=" * 60)
    print("测试4: 引用来源提取")
    print("=" * 60)

    sources = [
        {
            "ref_id": "REF-1-abc123",
            "source": "合同纠纷.pdf",
            "page": 3,
            "content": "原告张三..."
        },
        {
            "ref_id": "REF-2-def456",
            "source": "合同纠纷.pdf",
            "page": 7,
            "content": "被告李四..."
        },
        {
            "ref_id": "REF-3-ghi789",
            "source": "证据材料.pdf",
            "page": 2,
            "content": "转账记录..."
        }
    ]

    answer = "原告张三[REF-1-abc123]与被告李四[REF-2-def456]存在合同纠纷。"

    try:
        processor = DataProcessor()
        retriever = Retriever(processor.get_vector_store())

        cited = retriever.extract_cited_refs(answer, sources)
        print(f"回答: {answer}")
        print(f"提取到的引用来源数: {len(cited)}")

        assert len(cited) == 2, f"应提取到2个引用来源，实际提取到{len(cited)}个"
        assert cited[0]["ref_id"] == "REF-1-abc123", "第一个引用来源不正确"
        assert cited[1]["ref_id"] == "REF-2-def456", "第二个引用来源不正确"

        print("✅ 引用来源提取测试通过")
        return True
    except Exception as e:
        print(f"❌ 引用来源提取测试失败: {e}")
        return False


def main():
    print("\n" + "=" * 60)
    print("  引用验证机制测试套件")
    print("=" * 60)

    results = []
    results.append(test_ref_id_generation())
    results.append(test_context_formatting())
    results.append(test_reference_validation())
    results.append(test_cited_refs_extraction())

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"通过: {passed}/{total}")

    if passed == total:
        print("🎉 所有测试通过！引用验证机制正常工作。")
        return 0
    else:
        print(f"⚠️  有 {total - passed} 个测试失败，请检查代码。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
