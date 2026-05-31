import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List, Optional
import uvicorn
import os

app = FastAPI(title="Sentence-BERT Vector Service", version="1.0")

model_name = os.getenv("MODEL_NAME", "all-MiniLM-L6-v2")
model = None


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    model: str
    dimension: int


class SimilarityRequest(BaseModel):
    query: str
    texts: List[str]
    top_k: Optional[int] = 5


class SimilarityResult(BaseModel):
    text: str
    score: float
    index: int


class SimilarityResponse(BaseModel):
    results: List[SimilarityResult]
    query_embedding: List[float]


@app.on_event("startup")
async def load_model():
    global model
    print(f"Loading Sentence-BERT model: {model_name}...")
    model = SentenceTransformer(model_name)
    print(f"Model loaded successfully. Embedding dimension: {model.get_sentence_embedding_dimension()}")


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": model_name,
        "dimension": model.get_sentence_embedding_dimension() if model else None
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed_texts(request: EmbedRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    try:
        embeddings = model.encode(request.texts, convert_to_numpy=True, normalize_embeddings=True)
        return EmbedResponse(
            embeddings=embeddings.tolist(),
            model=model_name,
            dimension=model.get_sentence_embedding_dimension()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/similarity", response_model=SimilarityResponse)
async def compute_similarity(request: SimilarityRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    try:
        query_embedding = model.encode(request.query, convert_to_numpy=True, normalize_embeddings=True)
        text_embeddings = model.encode(request.texts, convert_to_numpy=True, normalize_embeddings=True)

        similarities = np.dot(text_embeddings, query_embedding)

        results = []
        for idx, (text, score) in enumerate(zip(request.texts, similarities)):
            results.append(SimilarityResult(
                text=text,
                score=float(score),
                index=idx
            ))

        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:request.top_k]

        return SimilarityResponse(
            results=results,
            query_embedding=query_embedding.tolist()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8501"))
    uvicorn.run(app, host="0.0.0.0", port=port)
