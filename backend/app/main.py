from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from app.api.health import router as health_router
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # 앱 시작 시: DB 연결 등 초기화 작업 (추후 확장)
    yield
    # 앱 종료 시: 리소스 정리 (추후 확장)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Career Compass API",
        version=settings.app_version,
        lifespan=lifespan,
    )
    app.include_router(health_router)
    return app


app = create_app()
