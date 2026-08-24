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
    # 이메일 발송 (Resend). 실제 키는 env(.env)에서만 온다.
    resend_api_key: str = ""
    # 발신 주소. Resend는 검증된 도메인에서만 보낼 수 있다. 도메인 검증 전에는
    # onboarding@resend.dev만 쓸 수 있고, 수신은 Resend 계정 소유자 본인
    # 주소로 제한된다 (제3자 수신은 도메인 검증 후에 열린다).
    email_from: str = "Career Compass <onboarding@resend.dev>"
    email_timeout_sec: float = 10.0

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
    def use_real_email(self) -> bool:
        # use_real_llm과 같은 판별. .env / .env.example이 싣고 있는 "re_..."
        # 플레이스홀더가 실제 발송을 켜면 첫 가입이 401로 죽으므로, 그럴듯한
        # 키(접두사 re_, "..." 없음, 충분한 길이)만 실제 어댑터를 활성화한다.
        key = self.resend_api_key.strip()
        looks_real = key.startswith("re_") and "..." not in key and len(key) >= 20
        return looks_real and self.app_env != "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()
