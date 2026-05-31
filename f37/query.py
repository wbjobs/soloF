from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import os
import shutil
from chain import RAGChain
from ingest import PDFIngestor


app = FastAPI(
    title="RAG System API",
    description="检索增强生成系统 API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


class QueryRequest(BaseModel):
    question: str
    collection_name: str = "rag_collection"
    top_k: int = 4
    use_mock_llm: bool = True
    use_rerank: bool = True
    rerank_top_k: int = 20


class DocumentInfo(BaseModel):
    content: str
    source: str
    page: int
    rerank_score: Optional[float] = None
    rerank_rank: Optional[int] = None


class CitationInfo(BaseModel):
    citation_id: int
    content: str
    source: str
    page: int
    highlight_text: str


class QueryResponse(BaseModel):
    success: bool
    question: str
    answer: str
    retrieved_docs: List[DocumentInfo]
    citations: List[CitationInfo]
    doc_count: int
    citation_count: int
    use_rerank: bool
    error: Optional[str] = None


class IngestResponse(BaseModel):
    success: bool
    message: str
    collection_name: str
    total_chunks: int = 0
    error: Optional[str] = None


rag_chains = {}


def get_rag_chain(
    collection_name: str,
    use_mock_llm: bool = True,
    use_rerank: bool = True,
    rerank_top_k: int = 20
) -> RAGChain:
    key = f"{collection_name}_{use_mock_llm}_{use_rerank}_{rerank_top_k}"
    if key not in rag_chains:
        try:
            rag_chains[key] = RAGChain(
                collection_name=collection_name,
                use_mock_llm=use_mock_llm,
                use_rerank=use_rerank,
                rerank_top_k=rerank_top_k
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to initialize RAG chain: {str(e)}")
    return rag_chains[key]


@app.get("/")
async def root():
    return {
        "message": "RAG System API",
        "version": "1.0.0",
        "endpoints": {
            "/query": "POST - Query the RAG system",
            "/ingest": "POST - Ingest PDF file",
            "/ingest/directory": "POST - Ingest all PDFs in directory",
            "/health": "GET - Health check",
            "/collections": "GET - List all collections",
            "/static/index.html": "GET - Web demo interface"
        },
        "web_demo": "Visit /static/index.html for the interactive demo with citation highlighting"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "rag-system"}


@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    try:
        rag = get_rag_chain(
            collection_name=request.collection_name,
            use_mock_llm=request.use_mock_llm,
            use_rerank=request.use_rerank,
            rerank_top_k=request.rerank_top_k
        )
        
        rag.top_k = request.top_k
        
        result = rag.query(request.question)
        
        return QueryResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest", response_model=IngestResponse)
async def ingest_pdf(
    file: UploadFile = File(...),
    collection_name: str = "rag_collection"
):
    if not file.filename.lower().endswith(".pdf"):
        return IngestResponse(
            success=False,
            message="Only PDF files are allowed",
            collection_name=collection_name
        )
    
    temp_dir = "./temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        ingestor = PDFIngestor()
        vectorstore = ingestor.ingest_pdf(temp_path, collection_name=collection_name)
        
        collection = vectorstore._collection
        total_chunks = collection.count()
        
        key = f"{collection_name}_True"
        if key in rag_chains:
            del rag_chains[key]
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested {file.filename}",
            collection_name=collection_name,
            total_chunks=total_chunks
        )
    except Exception as e:
        return IngestResponse(
            success=False,
            message=f"Failed to ingest PDF: {str(e)}",
            collection_name=collection_name,
            error=str(e)
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/ingest/directory", response_model=IngestResponse)
async def ingest_directory(
    directory_path: str,
    collection_name: str = "rag_collection"
):
    if not os.path.isdir(directory_path):
        return IngestResponse(
            success=False,
            message=f"Directory not found: {directory_path}",
            collection_name=collection_name
        )
    
    try:
        ingestor = PDFIngestor()
        vectorstore = ingestor.ingest_directory(directory_path, collection_name=collection_name)
        
        collection = vectorstore._collection
        total_chunks = collection.count()
        
        key = f"{collection_name}_True"
        if key in rag_chains:
            del rag_chains[key]
        
        return IngestResponse(
            success=True,
            message=f"Successfully ingested directory: {directory_path}",
            collection_name=collection_name,
            total_chunks=total_chunks
        )
    except Exception as e:
        return IngestResponse(
            success=False,
            message=f"Failed to ingest directory: {str(e)}",
            collection_name=collection_name,
            error=str(e)
        )


@app.get("/collections")
async def list_collections():
    try:
        import chromadb
        
        client = chromadb.PersistentClient(path="./chroma_db")
        collections = client.list_collections()
        
        collection_info = []
        for col in collections:
            try:
                count = col.count()
                collection_info.append({
                    "name": col.name,
                    "document_count": count
                })
            except:
                collection_info.append({
                    "name": col.name,
                    "document_count": 0
                })
        
        return {"collections": collection_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/collections/{collection_name}")
async def delete_collection(collection_name: str):
    try:
        import chromadb
        
        client = chromadb.PersistentClient(path="./chroma_db")
        client.delete_collection(collection_name)
        
        for key in list(rag_chains.keys()):
            if key.startswith(f"{collection_name}_"):
                del rag_chains[key]
        
        return {"success": True, "message": f"Collection '{collection_name}' deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "query:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
