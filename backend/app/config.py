from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/careercompass"
    app_env: str = "development"
    app_version: str = "0.1.0"
    secret_key: str = "change-me"
    # data.go.kr API key comes from the environment (.env). The previous
    # hardcoded default was committed to git history - rotate the key.
    data_go_kr_api_key: str = ""
    # Auth / session
    session_max_age_days: int = 14
    email_verification_ttl_minutes: int = 10
    email_verification_max_attempts: int = 5
    student_card_dir: str = "var/student_cards"
    student_card_max_bytes: int = 5 * 1024 * 1024
    milestone_image_dir: str = "var/milestone_images"
    milestone_image_max_bytes: int = 5 * 1024 * 1024
    # Bean economy
    withered_grace_days: int = 30
    bean_delete_cost: int = 10
    bean_reward_multiplier: int = 2

    @property
    def cookie_secure(self) -> bool:
        return self.app_env != "development"

@lru_cache
def get_settings() -> Settings:
    return Settings()
