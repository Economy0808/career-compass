from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.beans import router as beans_router
from app.api.health import router as health_router
from app.api.roadmap import router as roadmap_router
from app.api.todos import router as todos_router
from app.api.users import router as users_router
from app.config import get_settings

ALLOWED_ORIGINS = ["http://localhost:3000"]


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
    # 세션 쿠키를 쓰므로 credentials 허용 + origin 화이트리스트.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def enforce_origin(request: Request, call_next) -> Response:
        """CSRF 보조 방어: 브라우저가 보낸 상태변경 요청의 Origin을 검사한다.

        Origin 헤더가 없는 요청(서버 간 호출, curl, 테스트)은 통과 —
        쿠키가 자동 첨부되는 크로스사이트 브라우저 요청만 차단 대상이다.
        SameSite=Lax 쿠키와 이중 방어를 이룬다.
        """
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin is not None and origin not in ALLOWED_ORIGINS:
                return JSONResponse(status_code=403, content={"detail": "origin not allowed"})
        return await call_next(request)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(beans_router)
    app.include_router(users_router)
    app.include_router(roadmap_router)
    app.include_router(todos_router)
    return app


app = create_app()
