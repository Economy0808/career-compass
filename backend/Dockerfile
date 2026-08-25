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

# Run migrations, then serve. A demo container restarting mid-deploy is safe:
# alembic upgrade head is idempotent (no-ops once the schema is current).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
