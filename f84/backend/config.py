from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    NEO4J_URI: str = Field(default="bolt://localhost:7687", alias="NEO4J_URI")
    NEO4J_USER: str = Field(default="neo4j", alias="NEO4J_USER")
    NEO4J_PASSWORD: str = Field(default="neo4j1234", alias="NEO4J_PASSWORD")

    BABEL_PARSER_DIR: str = Field(default="babel-parser")

    GIT_WEBHOOK_SECRET: str = Field(default="", alias="GIT_WEBHOOK_SECRET")
    REPOS_DIR: str = Field(default="./repos")

    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=8000)

    CORS_ORIGINS: list[str] = Field(default=["*"])

    class Config:
        env_file = ".env"
        populate_by_name = True


settings = Settings()
