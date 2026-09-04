from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ourcompass"
    app_env: str = "development"
    app_version: str = "0.1.0"
    secret_key: str = "change-me"
    # 세션 쿠키를 보내도 되는 프론트 origin 화이트리스트. 콤마로 여러 개
    # 지정 (예: 배포 환경에서 로컬 개발 origin과 실제 배포 도메인을 함께 허용).
    cors_allowed_origins: str = "http://localhost:3000"
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
    # identity-linked API 키(개인 계정 연동형)는 모든 요청에 anthropic-workspace-id
    # 헤더가 필요하다(없으면 400). 워크스페이스 스코프 키를 쓰면 비워둬도 된다.
    anthropic_workspace_id: str = ""
    # Sonnet 5 across the pipeline (user choice). LLM_EXTRACT_MODEL can be set to
    # claude-haiku-4-5 in .env to run the two lightweight steps (intake chat +
    # keyword extraction) cheaper; synthesis stays on Sonnet for quality.
    llm_extract_model: str = "claude-sonnet-5"
    llm_synthesis_model: str = "claude-sonnet-5"
    llm_research_model: str = "claude-sonnet-5"
    # cluster_courses 전용 노브 - llm_extract_model과 분리한 이유는 그쪽을 내리면
    # chat/extract_intent/select_relevant_departments까지 같이 강등되기 때문이다.
    # 기본값은 Sonnet 유지(현행 동작 그대로, 배포해도 즉시 모델이 안 바뀐다).
    # Haiku 시도 시 env로 LLM_CLUSTER_MODEL=claude-haiku-4-5-20251001 지정, 품질
    # 저하 시 Sonnet 롤백 = env 플립 한 번. cluster_courses의 thinking off +
    # max_tokens 20000 설정(JSON 잘림 함정 방지)은 모델과 무관하게 그대로 유지된다.
    llm_cluster_model: str = "claude-sonnet-5"
    # Allow web search during synthesis (request path). Off by default for cost;
    # set LLM_SYNTHESIS_WEB_SEARCH=true in .env to experiment (e.g. with Opus).
    llm_synthesis_web_search: bool = False
    job_research_ttl_days: int = 30
    # 이메일 발송 (Resend). 실제 키는 env(.env)에서만 온다.
    resend_api_key: str = ""
    # 발신 주소. Resend는 검증된 도메인에서만 보낼 수 있다. 도메인 검증 전에는
    # onboarding@resend.dev만 쓸 수 있고, 수신은 Resend 계정 소유자 본인
    # 주소로 제한된다 (제3자 수신은 도메인 검증 후에 열린다).
    email_from: str = "OurCompass <onboarding@resend.dev>"
    email_timeout_sec: float = 10.0
    # 프로필 임베딩 벡터 검색 (Vertex AI gemini-embedding-001). 킬 스위치:
    # EMBEDDING_ENABLED=false로 끄면 발행/프로필 수정 시 재임베딩도, 탐색 검색의
    # 벡터 합집합도 모두 건너뛴다(부분일치 검색만 남음).
    embedding_enabled: bool = True
    embedding_model: str = "gemini-embedding-001"
    embedding_location: str = "asia-northeast3"
    embedding_dimensions: int = 768
    embedding_timeout_sec: float = 10.0
    # find_nearest의 distance_threshold(COSINE). 배포 후 실사용 검색어로 튜닝할
    # 값 - 너무 낮으면 벡터 검색이 사실상 안 뜨고, 너무 높으면 무관한 유저가 낀다.
    embedding_distance_threshold: float = 0.45
    # 별자리 "1사이클" 쿼터 - 가입 시 1회 지급하는 무료 사이클 수(일회성, 일일
    # 리셋 없음). app/firestore/quota_repo.py의 lazy-grant가 이 값을 쓴다.
    quota_free_grant: int = 1
    # 개인정보 국외이전(PIPA) 동의 판본. 유저가 동의한 시점의 문구 버전과 이
    # 값이 다르면(법적 문구 개정 등) 재동의가 필요하다 - app/firestore/
    # user_private_repo.py의 consent_overseas_version과 비교된다.
    current_overseas_consent_version: str = "2026-09-04-v1"
    # 인테이크 대화(Anthropic 전송) 진입을 국외이전 동의로 강제할지 여부.
    # 기본 False(강제 안 함, 기존 동작 유지) - 프론트 동의 모달이 준비된 뒤
    # 메인 세션이 env로 켠다(app/auth/consent_deps.py 참고).
    overseas_gate_enabled: bool = False

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

    @property
    def use_real_embeddings(self) -> bool:
        # use_real_llm/use_real_email과 같은 결의 판별이지만 키가 아니라 환경으로
        # 가른다 - Vertex 인증은 API 키가 아니라 google.auth ADC(서비스 계정)라
        # "그럴듯한 키 형태" 판별이 애초에 불가능하다. 개발/테스트에서는 킬
        # 스위치(embedding_enabled)와 무관하게 항상 Fake를 쓴다 - 로컬에 GCP ADC가
        # 없는 게 보통이라 이 판별이 없으면 개발 서버 기동이 DefaultCredentialsError로
        # 죽는다(use_real_llm이 test 환경만 막는 것과 달리 development도 막는 이유).
        return self.embedding_enabled and self.app_env not in ("development", "test")


@lru_cache
def get_settings() -> Settings:
    return Settings()
