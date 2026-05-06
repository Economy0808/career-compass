# Career Compass — Backend

FastAPI 기반 백엔드 서비스.

## 로컬 개발 환경 설정

### 1. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일을 열어 값 수정 (특히 SECRET_KEY)
```

### 2. 의존성 설치
```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

### 3. PostgreSQL + pgvector 실행
```bash
docker compose up -d
```

### 4. 마이그레이션 실행
```bash
alembic upgrade head
```

### 5. 서버 실행
```bash
uvicorn app.main:app --reload
```

API 문서: http://localhost:8000/docs

## 주요 커맨드

| 작업 | 커맨드 |
|------|--------|
| 서버 실행 | `uvicorn app.main:app --reload` |
| 테스트 | `pytest -xvs` |
| 린트 | `ruff check .` |
| 포맷 | `ruff format .` |
| 마이그레이션 생성 | `alembic revision --autogenerate -m "메시지"` |
| 마이그레이션 적용 | `alembic upgrade head` |

## 디렉토리 구조

```
backend/
├── app/
│   ├── main.py         # FastAPI 앱 진입점
│   ├── config.py       # Pydantic Settings (환경 변수)
│   └── api/
│       └── health.py   # GET /health
├── tests/              # pytest
├── alembic/            # DB 마이그레이션
├── docker-compose.yml  # PostgreSQL 16 + pgvector
└── pyproject.toml      # 의존성 + 도구 설정
```
