import os
from typing import List
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document


class PDFIngestor:
    def __init__(
        self,
        persist_directory: str = "./chroma_db",
        embedding_model: str = "BAAI/bge-small-zh-v1.5",
        chunk_size: int = 500,
        chunk_overlap: int = 50
    ):
        self.persist_directory = persist_directory
        self.embedding_model = embedding_model
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        self.embeddings = HuggingFaceEmbeddings(
            model_name=embedding_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )
        
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", "。", "！", "？", ";", "。", "?", "!", ".", " ", ""]
        )

    def load_pdf(self, pdf_path: str) -> List[Document]:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        
        loader = PyPDFLoader(pdf_path)
        documents = loader.load()
        print(f"Loaded {len(documents)} pages from {pdf_path}")
        return documents

    def split_documents(self, documents: List[Document]) -> List[Document]:
        splits = self.text_splitter.split_documents(documents)
        print(f"Split into {len(splits)} chunks")
        return splits

    def ingest_pdf(self, pdf_path: str, collection_name: str = "rag_collection") -> Chroma:
        documents = self.load_pdf(pdf_path)
        splits = self.split_documents(documents)
        
        vectorstore = Chroma.from_documents(
            documents=splits,
            embedding=self.embeddings,
            collection_name=collection_name,
            persist_directory=self.persist_directory
        )
        
        print(f"Ingestion complete. Vector store persisted to {self.persist_directory}")
        return vectorstore

    def ingest_directory(self, pdf_dir: str, collection_name: str = "rag_collection") -> Chroma:
        if not os.path.isdir(pdf_dir):
            raise NotADirectoryError(f"Directory not found: {pdf_dir}")
        
        pdf_files = [f for f in os.listdir(pdf_dir) if f.lower().endswith(".pdf")]
        print(f"Found {len(pdf_files)} PDF files in {pdf_dir}")
        
        all_splits = []
        for pdf_file in pdf_files:
            pdf_path = os.path.join(pdf_dir, pdf_file)
            documents = self.load_pdf(pdf_path)
            splits = self.split_documents(documents)
            all_splits.extend(splits)
        
        print(f"Total chunks: {len(all_splits)}")
        
        vectorstore = Chroma.from_documents(
            documents=all_splits,
            embedding=self.embeddings,
            collection_name=collection_name,
            persist_directory=self.persist_directory
        )
        
        print(f"Ingestion complete. Vector store persisted to {self.persist_directory}")
        return vectorstore

    def get_vectorstore(self, collection_name: str = "rag_collection") -> Chroma:
        return Chroma(
            persist_directory=self.persist_directory,
            embedding_function=self.embeddings,
            collection_name=collection_name
        )


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Ingest PDF documents into ChromaDB")
    parser.add_argument("--path", type=str, required=True, help="Path to PDF file or directory")
    parser.add_argument("--collection", type=str, default="rag_collection", help="Collection name")
    parser.add_argument("--db-dir", type=str, default="./chroma_db", help="ChromaDB directory")
    
    args = parser.parse_args()
    
    ingestor = PDFIngestor(persist_directory=args.db_dir)
    
    if os.path.isfile(args.path) and args.path.lower().endswith(".pdf"):
        ingestor.ingest_pdf(args.path, collection_name=args.collection)
    elif os.path.isdir(args.path):
        ingestor.ingest_directory(args.path, collection_name=args.collection)
    else:
        print("Error: Path must be a PDF file or a directory containing PDF files")
