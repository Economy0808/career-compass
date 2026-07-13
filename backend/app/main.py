from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.roadmap import router as roadmap_router
from app.api.users import router as users_router
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
    # 로컬 프론트엔드 개발 서버(Next.js, localhost:3000)에서의 호출 허용.
    # 인증 없는 프로토타입이라 origin 화이트리스트만으로 충분.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(users_router)
    app.include_router(roadmap_router)
    return app


app = create_app()
