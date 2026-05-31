import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    parquet_file_path: str = os.environ.get("PARQUET_FILE", "data/")
    jwt_secret_key: str = os.environ.get("JWT_SECRET", "your-secret-key-change-in-production")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24
    page_size: int = int(os.environ.get("PAGE_SIZE", 10000))
    server_host: str = os.environ.get("HOST", "0.0.0.0")
    server_port: int = int(os.environ.get("PORT", 8000))

settings = Settings()
