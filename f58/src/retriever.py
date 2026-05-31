import re
import hashlib
from typing import List, Tuple
from langchain_core.documents import Document
from langchain_chroma import Chroma

from .config import Config


class Retriever:
    def __init__(self, vector_store: Chroma):
        self.vector_store = vector_store
        self.retriever = vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": Config.TOP_K}
        )

    def _generate_ref_id(self, doc: Document, index: int) -> str:
        source = doc.metadata.get("source", "unknown")
        page = doc.metadata.get("page", 0)
        content_hash = hashlib.md5(doc.page_content[:100].encode()).hexdigest()[:6]
        return f"REF-{index}-{content_hash}"

    def search(self, query: str) -> List[Document]:
        return self.retriever.invoke(query)

    def search_with_score(self, query: str) -> List[Tuple[Document, float]]:
        return self.vector_store.similarity_search_with_score(query, k=Config.TOP_K)

    def format_context(self, documents: List[Document]) -> str:
        context_parts = []
        for i, doc in enumerate(documents, 1):
            ref_id = self._generate_ref_id(doc, i)
            source = doc.metadata.get("source", "未知来源")
            page = doc.metadata.get("page", "未知页码")
            doc.metadata["ref_id"] = ref_id
            context_parts.append(
                f"--- [{ref_id}]"
                f"【文件】{source}"
                f"【页码】第 {page} 页"
                f"【内容】{doc.page_content}\n"
            )
        return "\n".join(context_parts)

    def get_sources(self, documents: List[Document]) -> List[dict]:
        sources = []
        for i, doc in enumerate(documents, 1):
            ref_id = self._generate_ref_id(doc, i)
            sources.append({
                "ref_id": ref_id,
                "source": doc.metadata.get("source", "未知来源"),
                "page": doc.metadata.get("page", "未知页码"),
                "content": doc.page_content
            })
        return sources

    def extract_cited_refs(self, answer: str, sources: List[dict]) -> List[dict]:
        cited_refs = []
        seen_refs = set()

        for src in sources:
            ref_id = src["ref_id"]
            if ref_id in answer and ref_id not in seen_refs:
                seen_refs.add(ref_id)
                cited_refs.append(src)

        return cited_refs

    def validate_references(self, answer: str, sources: List[dict]) -> dict:
        answer_clean = re.sub(r'REF-\d+-[a-f0-9]+', '', answer).strip()
        cited_refs = self.extract_cited_refs(answer, sources)
        valid_ref_ids = [src["ref_id"] for src in sources]
        mentioned_refs_in_answer = re.findall(r'REF-\d+-[a-f0-9]+', answer)

        valid_mentions = [ref for ref in mentioned_refs_in_answer if ref in valid_ref_ids]
        invalid_mentions = [ref for ref in mentioned_refs_in_answer if ref not in valid_ref_ids]

        for invalid_ref in invalid_mentions:
            answer = answer.replace(invalid_ref, "")

        answer = re.sub(r'\s+', ' ', answer).strip()

        return {
            "cleaned_answer": answer,
            "cited_sources": cited_refs,
            "valid_mentions_count": len(valid_mentions),
            "invalid_mentions_count": len(invalid_mentions)
        }
