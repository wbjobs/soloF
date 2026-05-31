import os
from typing import List, Optional
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document

from .config import Config


class DataProcessor:
    def __init__(self):
        self.embeddings = HuggingFaceEmbeddings(
            model_name=Config.EMBEDDING_MODEL_NAME,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )
        self.vector_store = None
        self._init_vector_store()

    def _init_vector_store(self):
        persist_dir = Path(Config.CHROMA_DB_PATH)
        persist_dir.mkdir(parents=True, exist_ok=True)

        if persist_dir.exists() and any(persist_dir.iterdir()):
            self.vector_store = Chroma(
                persist_directory=str(persist_dir),
                embedding_function=self.embeddings,
                collection_name=Config.COLLECTION_NAME
            )
        else:
            self.vector_store = Chroma(
                persist_directory=str(persist_dir),
                embedding_function=self.embeddings,
                collection_name=Config.COLLECTION_NAME
            )

    def load_pdf(self, pdf_path: str) -> List[Document]:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF文件不存在: {pdf_path}")

        loader = PyPDFLoader(pdf_path)
        documents = loader.load()

        for doc in documents:
            doc.metadata["source"] = os.path.basename(pdf_path)

        return documents

    def split_documents(self, documents: List[Document]) -> List[Document]:
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=Config.CHUNK_SIZE,
            chunk_overlap=Config.CHUNK_OVERLAP,
            separators=["\n\n", "\n", "。", "！", "？", ";", "?", ".", " ", ""]
        )
        return text_splitter.split_documents(documents)

    def add_documents(self, documents: List[Document]) -> None:
        if not documents:
            raise ValueError("没有文档需要添加")

        self.vector_store.add_documents(documents)

    def process_pdf(self, pdf_path: str) -> int:
        documents = self.load_pdf(pdf_path)
        splits = self.split_documents(documents)
        self.add_documents(splits)
        return len(splits)

    def process_pdfs(self, pdf_dir: str) -> int:
        pdf_path = Path(pdf_dir)
        if not pdf_path.exists():
            raise FileNotFoundError(f"目录不存在: {pdf_dir}")

        pdf_files = list(pdf_path.glob("*.pdf"))
        if not pdf_files:
            raise FileNotFoundError(f"目录中没有PDF文件: {pdf_dir}")

        total_splits = 0
        for pdf_file in pdf_files:
            splits_count = self.process_pdf(str(pdf_file))
            total_splits += splits_count

        return total_splits

    def get_vector_store(self):
        return self.vector_store

    def clear_database(self):
        self.vector_store.delete_collection()
        self._init_vector_store()
