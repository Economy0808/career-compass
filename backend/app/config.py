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
    # LLM (roadmap generation). Real key comes from env (.env), never committed.
    # Empty key -> factory falls back to the deterministic Mock client ($0).
    anthropic_api_key: str = ""
    # Sonnet 5 across the pipeline (user choice). LLM_EXTRACT_MODEL can be set to
    # claude-haiku-4-5 in .env to run the two lightweight steps (intake chat +
    # keyword extraction) cheaper; synthesis stays on Sonnet for quality.
    llm_extract_model: str = "claude-sonnet-5"
    llm_synthesis_model: str = "claude-sonnet-5"
    llm_research_model: str = "claude-sonnet-5"
    # Allow web search during synthesis (request path). Off by default for cost;
    # set LLM_SYNTHESIS_WEB_SEARCH=true in .env to experiment (e.g. with Opus).
    llm_synthesis_web_search: bool = False
    job_research_ttl_days: int = 30
    # NCS 직무 임베딩 매칭 (OpenAI). 키가 없으면 pg_trgm 매칭으로 동작하므로
    # 서비스는 키 없이도 온전히 돌아간다.
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    @property
    def cookie_secure(self) -> bool:
        # 로컬 개발·테스트(http)에서는 Secure 쿠키를 끈다 — 운영에서만 켬.
        return self.app_env not in ("development", "test")

    @property
    def use_real_llm(self) -> bool:
        # Never call the paid API from the test suite, even if a key is present.
        # A placeholder key (the "sk-ant-..." shipped in .env / .env.example) must
        # NOT activate the real client, or the first generation 401s. Require a
        # plausibly real key: correct prefix, no "..." marker, reasonable length.
        key = self.anthropic_api_key.strip()
        looks_real = key.startswith("sk-ant-") and "..." not in key and len(key) >= 40
        return looks_real and self.app_env != "test"

    @property
    def use_real_embeddings(self) -> bool:
        # use_real_llm과 같은 규칙: 플레이스홀더 키("sk-...")는 활성화하지 않고,
        # 테스트 스위트는 절대 유료 API를 부르지 않는다.
        key = self.openai_api_key.strip()
        looks_real = key.startswith("sk-") and "..." not in key and len(key) >= 40
        return looks_real and self.app_env != "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()
