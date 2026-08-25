# OurCompass backend — Cloudflare Containers image.
# Builds and runs the FastAPI app as-is; no code changes needed to containerize it.
FROM python:3.11-slim

WORKDIR /app

# System deps for argon2-cffi (C extension) and Pillow.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libjpeg62-turbo-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install --no-cache-dir .

EXPOSE 8000

# 마이그레이션은 부팅 경로에 안 둔다 — Cloudflare Containers는 sleepAfter마다
# 컨테이너를 새로 켜는데(cold start), 매번 원격 DB로 alembic upgrade head를
# 돌리면 SSL 핸드셰이크 + 쿼리 왕복 시간이 컨테이너 시작 타임아웃을 넘겨버린다.
# 마이그레이션은 배포 전 별도로(`alembic upgrade head`) 한 번 실행해둘 것.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
