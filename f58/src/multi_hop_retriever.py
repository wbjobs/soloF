import re
from typing import List, Dict, Any, Tuple, Set
from langchain_core.documents import Document

from .config import Config
from .retriever import Retriever


class MultiHopRetriever:
    def __init__(self, base_retriever: Retriever):
        self.base_retriever = base_retriever
        self.max_hops = 3

    def _detect_multi_hop_question(self, question: str) -> Dict[str, Any]:
        question_lower = question.lower()

        multi_hop_patterns = [
            (r"对比|比较|差异|区别|异同", "comparison"),
            (r"分析.*关系|关联|影响|因果", "analysis"),
            (r"总结.*所有|汇总|综合|整体", "synthesis"),
            (r"分别|各个|每个|逐一", "enumeration"),
            (r"结合.*和|同时考虑|综合.*和", "combination"),
            (r"为什么|原因|导致|造成", "causal"),
        ]

        detected_type = "single"
        matched_pattern = ""

        for pattern, q_type in multi_hop_patterns:
            if re.search(pattern, question_lower):
                detected_type = q_type
                matched_pattern = pattern
                break

        return {
            "is_multi_hop": detected_type != "single",
            "question_type": detected_type,
            "matched_pattern": matched_pattern
        }

    def _decompose_question(self, question: str, question_type: str) -> List[str]:
        sub_queries = []

        if question_type == "comparison":
            entities = self._extract_entities(question)
            if len(entities) >= 2:
                for entity in entities[:3]:
                    sub_queries.append(f"{question} 关于 {entity}")
                    sub_queries.append(f"{entity} 的主要内容")
            else:
                sub_queries.append(question)
                sub_queries.append(question + " 第一部分")
                sub_queries.append(question + " 第二部分")

        elif question_type == "analysis":
            sub_queries.append(question)
            sub_queries.append(f"{question} 的背景信息")
            sub_queries.append(f"{question} 的相关因素")

        elif question_type == "synthesis":
            sub_queries.append(question)
            sub_queries.append("相关的主要观点 第一部分")
            sub_queries.append("相关的主要观点 第二部分")

        elif question_type == "enumeration":
            sub_queries.append(question)
            for i in range(1, 4):
                sub_queries.append(f"{question} 第{i}个")

        elif question_type == "causal":
            sub_queries.append(question)
            sub_queries.append(f"{question} 的直接原因")
            sub_queries.append(f"{question} 的间接原因")

        else:
            sub_queries.append(question)

        return list(dict.fromkeys(sub_queries))[:self.max_hops]

    def _extract_entities(self, question: str) -> List[str]:
        pattern = r'[《「]["]([^《》「」"]+)[》」"]|案例\s*([甲乙丙丁\d]+)|([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
        matches = re.findall(pattern, question)

        entities = []
        for match in matches:
            for group in match:
                if group.strip():
                    entities.append(group.strip())

        if not entities:
            keywords = re.findall(r'[\u4e00-\u9fa5]{2,}(?:案|合同|协议|判决|裁定|规定|法律|法规)', question)
            entities.extend(keywords)

        return list(dict.fromkeys(entities))

    def _retrieve_for_sub_query(self, sub_query: str) -> List[Document]:
        try:
            return self.base_retriever.search(sub_query)
        except Exception as e:
            print(f"检索子查询失败 '{sub_query}': {e}")
            return []

    def _aggregate_results(self, all_results: Dict[str, List[Document]]) -> Tuple[List[Document], Dict[str, Any]]:
        seen_contents: Set[str] = set()
        aggregated: List[Document] = []
        sub_query_stats = {}

        for sub_query, docs in all_results.items():
            sub_query_stats[sub_query] = len(docs)
            for doc in docs:
                content_key = doc.page_content[:200]
                if content_key not in seen_contents:
                    seen_contents.add(content_key)
                    doc.metadata["sub_query"] = sub_query
                    aggregated.append(doc)

        aggregated = aggregated[:Config.TOP_K * 2]

        stats = {
            "total_sub_queries": len(all_results),
            "sub_query_stats": sub_query_stats,
            "unique_docs": len(aggregated),
            "total_docs_before_dedup": sum(len(docs) for docs in all_results.values())
        }

        return aggregated, stats

    def search(self, question: str) -> Tuple[List[Document], Dict[str, Any]]:
        detection = self._detect_multi_hop_question(question)

        if not detection["is_multi_hop"]:
            docs = self.base_retriever.search(question)
            stats = {
                "is_multi_hop": False,
                "question_type": "single",
                "total_docs": len(docs)
            }
            return docs, stats

        sub_queries = self._decompose_question(question, detection["question_type"])

        all_results = {}
        for sub_query in sub_queries:
            docs = self._retrieve_for_sub_query(sub_query)
            all_results[sub_query] = docs

        aggregated_docs, agg_stats = self._aggregate_results(all_results)

        final_stats = {
            "is_multi_hop": True,
            "question_type": detection["question_type"],
            "sub_queries": sub_queries,
            **agg_stats
        }

        return aggregated_docs, final_stats

    def format_context_with_hops(self, documents: List[Document], stats: Dict[str, Any]) -> str:
        if not stats.get("is_multi_hop", False):
            return self.base_retriever.format_context(documents)

        context_parts = []
        context_parts.append(f"【多跳检索结果】共进行 {stats['total_sub_queries']} 轮子查询检索\n")

        sub_query_docs: Dict[str, List[Document]] = {}
        for doc in documents:
            sq = doc.metadata.get("sub_query", "unknown")
            if sq not in sub_query_docs:
                sub_query_docs[sq] = []
            sub_query_docs[sq].append(doc)

        for sq_idx, (sub_query, docs) in enumerate(sub_query_docs.items(), 1):
            context_parts.append(f"\n=== 子查询 {sq_idx}: {sub_query} ===")
            for i, doc in enumerate(docs, 1):
                ref_id = self.base_retriever._generate_ref_id(doc, sq_idx * 100 + i)
                source = doc.metadata.get("source", "未知来源")
                page = doc.metadata.get("page", "未知页码")
                doc.metadata["ref_id"] = ref_id
                context_parts.append(
                    f"--- [{ref_id}]\n"
                    f"【文件】{source}\n"
                    f"【页码】第 {page} 页\n"
                    f"【内容】{doc.page_content}\n"
                )

        return "\n".join(context_parts)

    def get_sources(self, documents: List[Document], stats: Dict[str, Any]) -> List[dict]:
        sources = self.base_retriever.get_sources(documents)
        if stats.get("is_multi_hop"):
            for i, src in enumerate(sources):
                if i < len(documents):
                    src["sub_query"] = documents[i].metadata.get("sub_query", "")
        return sources
