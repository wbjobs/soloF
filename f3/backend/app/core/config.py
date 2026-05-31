from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "PDF to Markdown Converter"
    DEBUG: bool = True
    
    REDIS_URL: str = "redis://localhost:6379/0"
    
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "pdf-converter"
    MINIO_SECURE: bool = False
    
    MATHPIX_APP_ID: str = ""
    MATHPIX_APP_KEY: str = ""
    MATHPIX_API_URL: str = "https://api.mathpix.com/v3/text"
    
    MAX_PDF_SIZE: int = 20 * 1024 * 1024
    
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"
    
    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()
