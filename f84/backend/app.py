import logging
import asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import settings
from neo4j_client import Neo4jClient
from task_manager import AsyncTaskManager
from routes.api import router as api_router
from routes.webhook import router as webhook_router
from routes.websocket import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    AsyncTaskManager.set_loop(loop)
    logger.info(f"Connecting to Neo4j at {settings.NEO4J_URI}...")
    try:
        Neo4jClient.connect()
        logger.info("Neo4j connection established")
    except Exception as e:
        logger.error(f"Failed to connect to Neo4j: {e}")
    yield
    logger.info("Shutting down...")
    Neo4jClient.close()
    logger.info("Neo4j connection closed")


app = FastAPI(
    title="JS/TS Dependency Analysis Service",
    description="Analyzes import/export dependencies in JavaScript/TypeScript projects",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(webhook_router)
app.include_router(ws_router)


@app.get("/")
async def root():
    return {
        "service": "JS/TS Dependency Analysis",
        "version": "1.0.0",
        "endpoints": {
            "api": {
                "list_files": "GET /api/files",
                "file_references": "GET /api/files/{path}/references",
                "file_impact": "GET /api/files/{path}/impact",
                "check_cycle": "GET /api/check-cycle?file_a=&file_b=",
                "graph_data": "GET /api/graph",
                "stats": "GET /api/stats",
                "list_tasks": "GET /api/tasks",
                "get_task": "GET /api/tasks/{task_id}",
                "cancel_task": "POST /api/tasks/{task_id}/cancel",
                "train_prediction": "POST /api/predict/train",
                "predict_affected": "GET /api/predict/{file_path}",
                "model_status": "GET /api/predict/model/status",
                "co_change_patterns": "GET /api/predict/patterns"
            },
            "webhook": {
                "git_push": "POST /webhook/git-push",
                "build": "POST /webhook/build",
                "clear": "POST /webhook/clear"
            },
            "websocket": {
                "task_updates": "WS /ws/tasks/{task_id}",
                "all_tasks": "WS /ws/tasks"
            }
        }
    }


@app.get("/health")
async def health():
    try:
        Neo4jClient.get_driver().verify_connectivity()
        return {"status": "healthy", "neo4j": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "neo4j": "disconnected", "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        log_level="info"
    )
