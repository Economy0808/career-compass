# Career Compass — Project Constitution

## Project Identity
- AI masterplan + milestone companion service for 1st/2nd-year undeclared university students in Korea
- Solo founder (Yonsei Univ., Philosophy, 1st year)
- Korean: user-facing copy, code comments, and docstrings.
- English: commit messages, config files, and this document. Config files must also stay
  ASCII-only for a technical reason — see Environment Conventions.

## Tech Stack (locked-in)
- Backend: Python 3.11+ / FastAPI / Pydantic v2
- DB: PostgreSQL 16 + pgvector
- Embedding: OpenAI text-embedding-3-small (benchmark vs bge-m3 for Korean later)
- Frontend: Next.js 14 (App Router) + TailwindCSS
- LLM: Anthropic Claude Sonnet 5 default; Opus 5 for complex work
- Notifications: Resend (email) + Solapi (KakaoTalk)

## Coding Standards
- Python: ruff format + ruff check. Type hints required on every function signature.
- TypeScript: strict mode. No `any`.
- Commits: Conventional Commits (feat:, fix:, chore:, docs:, refactor:, test:).
- Branches: `main` is protected. All work on `feature/*` branches.

## Working Principles — Apply Every Task
1. Every task follows explore -> plan -> approval -> implement. Never edit before I approve.
   - Explore: read the relevant code first; delegate plain search to a Haiku subagent.
   - Plan: the Opus main thread writes it, splitting the work into reasoning-heavy vs
     mechanical items and naming the model for each (see Model Selection Guide).
   - Approval: present the plan and stop. `permissions.defaultMode` is `plan` for this repo,
     so the harness enforces this gate too.
   - Implement: spawn the subagents the plan named. They inherit no conversation context, so
     every briefing must carry the plan, file paths, and constraints in full.
2. If a change touches 5+ files, break it into reviewable steps.
3. No code on `main` without tests. TDD preferred.
4. Never commit `.env`. Verify `.gitignore` first.
5. When code touches Korean user data, surface PIPA (Personal Information Protection Act) checklist items.

## Hard Rules — Never Do
- No scrapers for external job sites (Saramin, JobKorea, Linkareer). Violates Korean Unfair Competition Prevention Act and Copyright Act. Use NCS public API or user-consent imports only.
- No hardcoded API keys, tokens, or DB passwords. Always environment variables.
- No transmitting user PII to external LLMs for training.
- No direct DB schema changes. Always go through Alembic migrations.
- No `npm install` / `pip install` without asking first.

## Environment Conventions (Windows + PowerShell)
- `PYTHONUTF8=1` is set as a user environment variable. All Python tooling assumes UTF-8.
- All config files (.toml, .ini, .cfg, docker-compose.yml) must be ASCII-only. Korean comments break Python's locale-based config parser on Windows.
- Always confirm `(.venv)` prefix in the prompt before running pip / pytest / alembic / fastapi.
- Database runs via `docker compose up -d` from `backend/`.

## Async + DB Patterns
- SQLAlchemy async engine is created lazily inside `get_db()`, not at module top level. Avoids "Event loop is closed" errors with pytest's per-test event loops.
- `tests/conftest.py` has an autouse fixture calling `reset_engine()` after each test to dispose the engine.
- When this outgrows healthcheck-level testing, migrate to per-test transaction rollback fixtures.

## Model Selection Guide
- Main thread runs Opus 5 (see Working Principles 1) — it explores and plans, then delegates.
- Reasoning-heavy implementation: Sonnet 5 subagent
- Mechanical work (boilerplate, bulk substitution, file moves, formatting): Haiku 4.5 subagent
- Quick exploration and file search: Haiku 4.5 subagent
- Capability order is Haiku 4.5 < Sonnet 5 < Opus 5. Harder work goes to the stronger model.
- Skip delegation when briefing a subagent would cost more than doing the edit inline.

## Common Commands
- Run backend: `fastapi dev app/main.py`
- Test: `pytest -v`
- Lint: `ruff check . && ruff format .`
- New migration: `alembic revision --autogenerate -m "msg" && alembic upgrade head`

## Directory Layout (locked-in)
03_Code/
03_Code/
├── backend/        # FastAPI
│   ├── app/
│   │   ├── api/         # HTTP routers
│   │   ├── etl/         # data ingestion functions
│   │   └── models/      # SQLAlchemy ORM models
│   ├── alembic/         # DB migrations
│   ├── scripts/         # one-off scripts that depend on app modules
│   ├── tests/
│   └── pyproject.toml
├── frontend/       # Next.js (Phase 3)
│   ├── app/
│   └── package.json
├── data/           # NCS public data dumps (gitignored)
└── scripts/        # one-off ETL scripts
