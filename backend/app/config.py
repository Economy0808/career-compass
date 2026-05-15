from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/careercompass"
    app_env: str = "development"
    app_version: str = "0.1.0"
    secret_key: str = "change-me"
    # data.go.kr API
    data_go_kr_api_key: str = "6c401b7ab03c87d74f1aac9012388a685ea72b3df52dc87c7e2fcd20907cc565"

@lru_cache
def get_settings() -> Settings:
    return Settings()
