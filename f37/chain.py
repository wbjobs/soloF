from typing import List, Dict, Any, Optional
from langchain_chroma import Chroma
from langchain_core.retrievers import BaseRetriever
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch


class BGEReranker:
    def __init__(
        self,
        model_name: str = "BAAI/bge-reranker-v2-m3",
        device: str = "cpu",
        use_fp16: bool = False
    ):
        self.model_name = model_name
        self.device = device
        self.use_fp16 = use_fp16
        
        try:
            from FlagEmbedding import FlagReranker
            model_kwargs = {"device": device}
            if use_fp16 and device == "cuda":
                model_kwargs["fp16"] = True
            self.reranker = FlagReranker(model_name, **model_kwargs)
            print(f"Successfully loaded Reranker model: {model_name}")
        except Exception as e:
            print(f"Failed to load Reranker model: {e}, will use fallback simple reranker")
            self.reranker = None

    def rerank(
        self,
        query: str,
        documents: List[Document],
        top_k: int = 4
    ) -> List[tuple[Document, float]]:
        if not documents:
            return []
        
        if self.reranker is not None:
            return self._rerank_with_bge(query, documents, top_k)
        else:
            return self._rerank_simple(query, documents, top_k)

    def _rerank_with_bge(
        self,
        query: str,
        documents: List[Document],
        top_k: int
    ) -> List[tuple[Document, float]]:
        pairs = [[query, doc.page_content] for doc in documents]
        
        scores = self.reranker.compute_score(pairs, normalize=True)
        
        doc_scores = list(zip(documents, scores))
        doc_scores.sort(key=lambda x: x[1], reverse=True)
        
        return doc_scores[:top_k]

    def _rerank_simple(
        self,
        query: str,
        documents: List[Document],
        top_k: int
    ) -> List[tuple[Document, float]]:
        query_words = set(query.lower().split())
        
        scored_docs = []
        for doc in documents:
            content_words = set(doc.page_content.lower().split())
            overlap = len(query_words & content_words)
            score = overlap / max(len(query_words), 1)
            scored_docs.append((doc, score))
        
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        return scored_docs[:top_k]


class MockLLM:
    def __init__(self):
        self.response_template = """
基于以下检索到的文档片段，我来回答您的问题：

检索到的相关内容：
{context}

用户问题：{question}

回答：这是一个模拟回答，已自动引用相关文档内容[1]。
在实际部署时，这里会接入真实的LLM模型（如Llama、Qwen等）生成回答。

引用说明：
[1] 来自第 {first_page} 页，相关内容已在检索结果中标注。
"""

    def invoke(self, inputs: Dict[str, Any]) -> str:
        context = inputs.get("context", "")
        question = inputs.get("question", "")
        doc_count = len([c for c in context.split("\n\n") if c.strip()])
        
        first_page = 1
        if "页码" in context:
            import re
            page_match = re.search(r'页码[：:]\s*(\d+)', context)
            if page_match:
                first_page = int(page_match.group(1))
        
        return self.response_template.format(
            context=context,
            question=question,
            doc_count=doc_count,
            first_page=first_page
        )


class RAGChain:
    def __init__(
        self,
        persist_directory: str = "./chroma_db",
        collection_name: str = "rag_collection",
        embedding_model: str = "BAAI/bge-small-zh-v1.5",
        top_k: int = 4,
        use_mock_llm: bool = True,
        llm_model_path: Optional[str] = None,
        use_rerank: bool = True,
        rerank_model: str = "BAAI/bge-reranker-v2-m3",
        rerank_top_k: int = 20,
        rerank_device: str = "cpu",
        rerank_use_fp16: bool = False
    ):
        self.persist_directory = persist_directory
        self.collection_name = collection_name
        self.embedding_model = embedding_model
        self.top_k = top_k
        self.use_rerank = use_rerank
        self.rerank_top_k = rerank_top_k
        
        self.embeddings = HuggingFaceEmbeddings(
            model_name=embedding_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )
        
        self.vectorstore = Chroma(
            persist_directory=persist_directory,
            embedding_function=self.embeddings,
            collection_name=collection_name
        )
        
        retrieval_k = rerank_top_k if use_rerank else top_k
        self.retriever = self.vectorstore.as_retriever(
            search_type="similarity",
            search_kwargs={"k": retrieval_k}
        )
        
        if use_rerank:
            self.reranker = BGEReranker(
                model_name=rerank_model,
                device=rerank_device,
                use_fp16=rerank_use_fp16
            )
        else:
            self.reranker = None
        
        if use_mock_llm:
            self.llm = MockLLM()
        else:
            self.llm = self._load_llm(llm_model_path)
        
        self.chain = self._build_chain()

    def _load_llm(self, model_path: Optional[str]):
        if model_path is None:
            return MockLLM()
        
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_path)
            model = AutoModelForCausalLM.from_pretrained(
                model_path,
                torch_dtype=torch.float16,
                device_map="auto"
            )
            
            class HuggingFaceLLM:
                def __init__(self, model, tokenizer):
                    self.model = model
                    self.tokenizer = tokenizer
                
                def invoke(self, inputs: Dict[str, Any]) -> str:
                    prompt = f"请基于以下文档回答问题：\n\n文档：{inputs['context']}\n\n问题：{inputs['question']}\n\n回答："
                    
                    inputs_tok = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
                    with torch.no_grad():
                        outputs = self.model.generate(
                            **inputs_tok,
                            max_new_tokens=512,
                            temperature=0.7,
                            do_sample=True
                        )
                    
                    response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
                    return response.split("回答：")[-1]
            
            return HuggingFaceLLM(model, tokenizer)
        except Exception as e:
            print(f"Failed to load LLM: {e}, using mock LLM instead")
            return MockLLM()

    def _retrieve_and_rerank(self, query: str) -> List[Document]:
        initial_docs = self.retriever.get_relevant_documents(query)
        
        if self.use_rerank and self.reranker is not None:
            reranked_docs_with_scores = self.reranker.rerank(
                query=query,
                documents=initial_docs,
                top_k=self.top_k
            )
            
            for i, (doc, score) in enumerate(reranked_docs_with_scores):
                if not hasattr(doc, 'metadata'):
                    doc.metadata = {}
                doc.metadata['rerank_score'] = score
                doc.metadata['rerank_rank'] = i + 1
            
            return [doc for doc, score in reranked_docs_with_scores]
        else:
            return initial_docs[:self.top_k]

    def _build_chain(self):
        def format_docs(docs):
            formatted = []
            for i, doc in enumerate(docs):
                source = doc.metadata.get("source", "未知文件")
                page = doc.metadata.get("page", 0) + 1
                formatted.append(f"[文档{i+1}] 来源: {source}, 页码: {page}\n内容: {doc.page_content}")
            return "\n\n".join(formatted)
        
        prompt = ChatPromptTemplate.from_template("""
你是一个专业的技术文档助手。请基于以下检索到的文档片段，准确、简洁地回答用户的问题。

重要规则：
1. 回答中引用的内容必须标注来源编号，格式为 [n]，其中 n 是文档编号
2. 每个引用标记对应该引用的文档来源
3. 例如："根据文档说明[1]，配置网络需要..."
4. 如果文档中没有相关信息，请诚实地说明"根据现有文档无法回答该问题"

检索到的文档片段：
{context}

用户问题：{question}

回答：
""")
        
        retrieve_runnable = RunnableLambda(self._retrieve_and_rerank)
        
        chain = (
            {"context": retrieve_runnable | RunnableLambda(format_docs), "question": RunnablePassthrough()}
            | prompt
            | self.llm
            | StrOutputParser()
        )
        
        return chain

    def _extract_citations(self, answer: str, docs: List[Document]) -> List[Dict[str, Any]]:
        import re
        
        citations = []
        citation_numbers = set()
        
        pattern = r'\[(\d+)\]'
        matches = re.findall(pattern, answer)
        
        for match in matches:
            try:
                doc_idx = int(match) - 1
                if 0 <= doc_idx < len(docs) and doc_idx not in citation_numbers:
                    citation_numbers.add(doc_idx)
                    doc = docs[doc_idx]
                    citations.append({
                        "citation_id": int(match),
                        "content": doc.page_content,
                        "source": doc.metadata.get("source", ""),
                        "page": doc.metadata.get("page", 0) + 1,
                        "highlight_text": self._extract_highlight_text(doc.page_content, 100)
                    })
            except (ValueError, IndexError):
                continue
        
        if not citations and docs:
            for i, doc in enumerate(docs[:3]):
                citations.append({
                    "citation_id": i + 1,
                    "content": doc.page_content,
                    "source": doc.metadata.get("source", ""),
                    "page": doc.metadata.get("page", 0) + 1,
                    "highlight_text": self._extract_highlight_text(doc.page_content, 100)
                })
        
        return citations

    def _extract_highlight_text(self, content: str, max_length: int = 100) -> str:
        if len(content) <= max_length:
            return content
        return content[:max_length] + "..."

    def query(self, question: str) -> Dict[str, Any]:
        try:
            docs = self._retrieve_and_rerank(question)
            
            answer = self.chain.invoke(question)
            
            citations = self._extract_citations(answer, docs)
            
            retrieved_docs = []
            for doc in docs:
                doc_info = {
                    "content": doc.page_content,
                    "source": doc.metadata.get("source", ""),
                    "page": doc.metadata.get("page", 0) + 1
                }
                if "rerank_score" in doc.metadata:
                    doc_info["rerank_score"] = float(doc.metadata["rerank_score"])
                if "rerank_rank" in doc.metadata:
                    doc_info["rerank_rank"] = int(doc.metadata["rerank_rank"])
                retrieved_docs.append(doc_info)
            
            return {
                "success": True,
                "question": question,
                "answer": answer,
                "retrieved_docs": retrieved_docs,
                "citations": citations,
                "doc_count": len(retrieved_docs),
                "citation_count": len(citations),
                "use_rerank": self.use_rerank
            }
        except Exception as e:
            return {
                "success": False,
                "question": question,
                "answer": "",
                "error": str(e),
                "retrieved_docs": [],
                "citations": [],
                "doc_count": 0,
                "citation_count": 0,
                "use_rerank": self.use_rerank
            }

    def get_retriever(self) -> BaseRetriever:
        return self.retriever


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Test RAG chain")
    parser.add_argument("--question", type=str, required=True, help="Question to ask")
    parser.add_argument("--collection", type=str, default="rag_collection", help="Collection name")
    parser.add_argument("--db-dir", type=str, default="./chroma_db", help="ChromaDB directory")
    parser.add_argument("--top-k", type=int, default=4, help="Number of documents to retrieve")
    parser.add_argument("--no-rerank", action="store_true", help="Disable rerank")
    
    args = parser.parse_args()
    
    rag = RAGChain(
        persist_directory=args.db_dir,
        collection_name=args.collection,
        top_k=args.top_k,
        use_mock_llm=True,
        use_rerank=not args.no_rerank,
        rerank_top_k=20
    )
    
    result = rag.query(args.question)
    
    if result["success"]:
        print("\n" + "="*70)
        print(f"问题: {result['question']}")
        print(f"检索到 {result['doc_count']} 个相关文档")
        print(f"提取到 {result['citation_count']} 个引用")
        print(f"是否使用重排序: {result['use_rerank']}")
        print("\n" + "-"*70)
        print("回答:")
        print(result["answer"])
        print("\n" + "-"*70)
        print("引用溯源 (可点击高亮):")
        for cite in result["citations"]:
            print(f"\n[{cite['citation_id']}] 来源: {cite['source']} 第 {cite['page']} 页")
            print(f"    高亮原文: {cite['highlight_text']}")
        print("\n" + "-"*70)
        print("检索到的文档片段 (按相关性排序):")
        for i, doc in enumerate(result["retrieved_docs"]):
            print(f"\n[文档{i+1}] 来源: {doc['source']} 页码: {doc['page']}")
            if "rerank_score" in doc:
                print(f"  重排序得分: {doc['rerank_score']:.4f} 排名: {doc.get('rerank_rank', i+1)}")
            print(f"  内容: {doc['content'][:150]}...")
        print("="*70 + "\n")
    else:
        print(f"Error: {result['error']}")
