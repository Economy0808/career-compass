# Career Compass — Project Constitution

## 프로젝트 정체
- 1·2학년 진로 미정 대학생을 위한 AI 마스터플랜 + 마일스톤 동행 서비스
- 1인 창업자(연세대 철학과 1학년) 운영
- 한국어 우선, 영어 코드 주석 가능

## 기술 스택 (확정)
- Backend: Python 3.11 + FastAPI + Pydantic v2
- DB: PostgreSQL 16 + pgvector
- Embedding: OpenAI text-embedding-3-small (한국어 성능 검증 후 bge-m3 비교)
- Frontend: Next.js 14 (App Router) + TailwindCSS
- LLM: Anthropic Claude Sonnet 4.6 기본, 복잡 작업은 Opus 4.7
- 알림: 이메일(Resend) + Solapi 카카오 알림톡

## 코딩 표준
- Python: ruff format + ruff check, 함수마다 타입 힌트 필수
- TypeScript: strict mode, any 금지
- 커밋: Conventional Commits (feat:, fix:, chore:, docs:, refactor:, test:)
- 브랜치: main 보호, 모든 작업은 feature/* 브랜치에서

## 작업 원칙 — 매 작업마다 따를 것
1. 먼저 /plan 모드로 계획을 세우고 내가 승인한 뒤 실행
2. 변경 파일이 5개 이상이면 반드시 단계별로 쪼개서 보여줄 것
3. 테스트 없는 코드를 main에 머지하지 말 것 (TDD 권장)
4. 환경 변수 (.env)는 절대 커밋하지 말 것 — .gitignore 확인
5. 한국 사용자 데이터를 다루는 코드를 추가할 때는 개인정보보호법 체크리스트 언급

## 절대 하지 말 것 (Hard Rules)
- 외부 채용 사이트(사람인, 잡코리아, 링커리어 등) 크롤링 코드 작성 금지
  → 부정경쟁방지법·저작권법 위반. 합법 경로(NCS API, 사용자 동의 기반 import)만 사용
- API 키, 토큰, DB 비밀번호를 코드에 하드코딩 금지 → 항상 환경 변수
- 사용자 개인정보를 외부 LLM 학습용으로 전송 금지
- 마이그레이션 없이 DB 스키마 직접 변경 금지 (Alembic 사용)
- npm install / pip install을 묻지 않고 실행 금지

## 모델 선택 가이드
- 일반 구현·버그 수정·테스트: Sonnet 4.6 (기본)
- 아키텍처 설계·복잡한 디버깅·보안 검토: /model opus 로 전환
- 짧은 탐색·파일 검색: Haiku 가능

## 자주 쓰는 명령
- 백엔드 실행: `uvicorn app.main:app --reload`
- 테스트: `pytest -xvs`
- 린트: `ruff check . && ruff format .`
- 마이그레이션: `alembic revision --autogenerate -m "msg" && alembic upgrade head`

## 디렉토리 구조 (확정)
03_Code/
├── backend/        # FastAPI
│   ├── app/
│   ├── tests/
│   ├── alembic/
│   └── pyproject.toml
├── frontend/       # Next.js
│   ├── app/
│   └── package.json
├── data/           # NCS 등 공공 데이터 dump (gitignore)
└── scripts/        # 일회성 ETL
