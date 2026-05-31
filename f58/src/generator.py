import os
import re
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_community.llms import LlamaCpp

from .config import Config
from .retriever import Retriever
from .multi_hop_retriever import MultiHopRetriever


class AnswerGenerator:
    def __init__(self, retriever: Retriever, use_multi_hop: bool = True):
        self.retriever = retriever
        self.multi_hop_retriever = MultiHopRetriever(retriever) if use_multi_hop else None
        self.use_multi_hop = use_multi_hop
        self.llm = self._init_llm()
        self.chain = self._build_chain()

    def _init_llm(self) -> LlamaCpp:
        model_path = Path(Config.LLM_MODEL_PATH)
        if not model_path.exists():
            raise FileNotFoundError(
                f"LLM模型文件不存在: {Config.LLM_MODEL_PATH}\n"
                f"请下载Llama-3-8B GGUF量化版模型并放置在指定路径。\n"
                f"推荐从 HuggingFace 下载: meta-llama/Meta-Llama-3-8B-Instruct-GGUF"
            )

        return LlamaCpp(
            model_path=str(model_path),
            n_ctx=Config.LLM_N_CTX,
            n_gpu_layers=Config.LLM_N_GPU_LAYERS,
            temperature=0.05,
            max_tokens=1024,
            top_p=0.8,
            repeat_penalty=1.15,
            frequency_penalty=0.1,
            presence_penalty=0.1,
            verbose=False
        )

    def _build_prompt_template(self) -> str:
        return """<|begin_of_text|><|start_header_id|>system<|end_header_id|>
你是一个严谨的法律助手，必须严格基于提供的卷宗材料回答问题。

【核心规则】
1. 只能使用检索到的【卷宗片段】中的信息回答问题
2. 每个事实陈述必须标注来源引用，格式：[来源编号]
3. 引用的来源编号必须完全匹配卷宗片段开头的 [REF-X-XXXXXX] 标识
4. 如果卷宗片段中没有相关信息，必须回答："根据现有卷宗内容无法回答该问题"
5. 绝对不能编造、推断或假设卷宗中没有的信息
6. 不能引用不存在的来源编号
7. 如果多个来源支持同一观点，列出所有相关来源

【引用格式要求】
- 在涉及具体事实的句子末尾标注引用，例如：
  "原告于2023年1月签订合同[REF-1-abc123]。"
  "被告辩称已履行付款义务[REF-2-def456][REF-3-ghi789]。"
- 引用必须紧跟在相关事实陈述之后
- 不要在引用编号中添加任何额外文字

【卷宗片段】
{context}

<|eot_id|><|start_header_id|>user<|end_header_id|>
{question}

<|eot_id|><|start_header_id|>assistant<|end_header_id|>
"""

    def _build_chain(self):
        prompt = PromptTemplate(
            template=self._build_prompt_template(),
            input_variables=["context", "question"]
        )

        def format_docs(docs):
            return self.retriever.format_context(docs)

        chain = (
            {"context": self.retriever.retriever | format_docs, "question": RunnablePassthrough()}
            | prompt
            | self.llm
            | StrOutputParser()
        )

        return chain

    def _format_ref_to_number(self, answer: str, sources: List[dict]) -> str:
        for i, src in enumerate(sources, 1):
            answer = answer.replace(src["ref_id"], f"[{i}]")
        return answer

    def _clean_answer(self, answer: str) -> str:
        answer = re.sub(r'<\|.*?\|>', '', answer)
        answer = re.sub(r'\[REF-\d+-[a-f0-9]+\]', '', answer)
        answer = re.sub(r'\s+', ' ', answer)
        answer = answer.strip()
        return answer

    def _search_and_prepare(self, question: str, force_multi_hop: bool = False) -> Tuple[List[Document], List[dict], str, Dict[str, Any]]:
        use_multi_hop = self.use_multi_hop and (self.multi_hop_retriever is not None)

        if use_multi_hop:
            docs, multi_hop_stats = self.multi_hop_retriever.search(question)
            if force_multi_hop and not multi_hop_stats.get("is_multi_hop", False):
                multi_hop_stats["is_multi_hop"] = True
                multi_hop_stats["question_type"] = "forced"
                multi_hop_stats["sub_queries"] = [question, question + " 补充信息", question + " 背景"]
                all_results = {}
                for sq in multi_hop_stats["sub_queries"]:
                    all_results[sq] = self.retriever.search(sq)
                docs, agg_stats = self.multi_hop_retriever._aggregate_results(all_results)
                multi_hop_stats.update(agg_stats)
            context = self.multi_hop_retriever.format_context_with_hops(docs, multi_hop_stats)
            sources = self.multi_hop_retriever.get_sources(docs, multi_hop_stats)
            retrieval_stats = multi_hop_stats
        else:
            docs = self.retriever.search(question)
            context = self.retriever.format_context(docs)
            sources = self.retriever.get_sources(docs)
            retrieval_stats = {"is_multi_hop": False, "question_type": "single"}

        return docs, sources, context, retrieval_stats

    def generate(self, question: str, force_multi_hop: bool = False) -> Dict[str, Any]:
        docs, sources, context, retrieval_stats = self._search_and_prepare(question, force_multi_hop)

        if not docs:
            return {
                "answer": "未检索到相关内容，请尝试其他问题。",
                "sources": [],
                "cited_sources": [],
                "validation_stats": {},
                "retrieval_stats": retrieval_stats
            }

        prompt = self._build_prompt_template().format(context=context, question=question)
        answer = self.llm.invoke(prompt)

        validation = self.retriever.validate_references(answer, sources)
        cleaned_answer = self._format_ref_to_number(validation["cleaned_answer"], sources)
        cited_sources = validation["cited_sources"]

        cited_sources_with_numbers = []
        for src in cited_sources:
            src_index = next((i for i, s in enumerate(sources, 1) if s["ref_id"] == src["ref_id"]), None)
            if src_index:
                cited_sources_with_numbers.append({
                    "number": src_index,
                    **src
                })

        return {
            "answer": cleaned_answer,
            "sources": sources,
            "cited_sources": cited_sources_with_numbers,
            "validation_stats": {
                "valid_mentions": validation["valid_mentions_count"],
                "invalid_mentions": validation["invalid_mentions_count"]
            },
            "retrieval_stats": retrieval_stats
        }

    def generate_stream(self, question: str, force_multi_hop: bool = False):
        docs, sources, context, retrieval_stats = self._search_and_prepare(question, force_multi_hop)

        if not docs:
            yield "未检索到相关内容，请尝试其他问题。", [], {}, retrieval_stats
            return

        prompt = self._build_prompt_template().format(context=context, question=question)

        full_answer = ""
        for chunk in self.llm.stream(prompt):
            full_answer += chunk
            yield full_answer, None, None, retrieval_stats

        validation = self.retriever.validate_references(full_answer, sources)
        cleaned_answer = self._format_ref_to_number(validation["cleaned_answer"], sources)
        cited_sources = validation["cited_sources"]

        cited_sources_with_numbers = []
        for src in cited_sources:
            src_index = next((i for i, s in enumerate(sources, 1) if s["ref_id"] == src["ref_id"]), None)
            if src_index:
                cited_sources_with_numbers.append({
                    "number": src_index,
                    **src
                })

        stats = {
            "valid_mentions": validation["valid_mentions_count"],
            "invalid_mentions": validation["invalid_mentions_count"]
        }

        yield cleaned_answer, cited_sources_with_numbers, stats, retrieval_stats

    def get_sources_for_question(self, question: str, force_multi_hop: bool = False) -> List[Dict[str, Any]]:
        use_multi_hop = self.use_multi_hop and (self.multi_hop_retriever is not None)

        if use_multi_hop:
            docs, stats = self.multi_hop_retriever.search(question)
            return self.multi_hop_retriever.get_sources(docs, stats)
        else:
            docs = self.retriever.search(question)
            return self.retriever.get_sources(docs)

    def set_multi_hop_enabled(self, enabled: bool):
        self.use_multi_hop = enabled
        if enabled and self.multi_hop_retriever is None:
            self.multi_hop_retriever = MultiHopRetriever(self.retriever)

    def detect_question_type(self, question: str) -> Dict[str, Any]:
        if self.multi_hop_retriever:
            return self.multi_hop_retriever._detect_multi_hop_question(question)
        return {"is_multi_hop": False, "question_type": "single"}
