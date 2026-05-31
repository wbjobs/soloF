import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
    COLLECTION_NAME = os.getenv("COLLECTION_NAME", "legal_documents")
    EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    LLM_MODEL_PATH = os.getenv("LLM_MODEL_PATH", "./models/llama-3-8b-instruct.Q4_K_M.gguf")
    LLM_N_CTX = int(os.getenv("LLM_N_CTX", "4096"))
    LLM_N_GPU_LAYERS = int(os.getenv("LLM_N_GPU_LAYERS", "-1"))
    CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
    CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))
    TOP_K = int(os.getenv("TOP_K", "3"))
