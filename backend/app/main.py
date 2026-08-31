from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth_sync import router as auth_sync_router
from app.api.community import router as community_router
from app.api.community_notes import router as community_notes_router
from app.api.constellation import router as constellation_router
from app.api.constellation_intake import router as constellation_intake_router
from app.api.courses import router as courses_router
from app.api.dm import router as dm_router
from app.api.explore import router as explore_router
from app.api.health import router as health_router
from app.api.notifications import router as notifications_router
from app.api.posts import router as posts_router
from app.api.profiles import router as profiles_router
from app.api.stories import router as stories_router
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # 앱 시작 시: DB 연결 등 초기화 작업 (추후 확장)
    yield
    # 앱 종료 시: 리소스 정리 (추후 확장)


def create_app() -> FastAPI:
    settings = get_settings()
    allowed_origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
    app = FastAPI(
        title="OurCompass API",
        version=settings.app_version,
        lifespan=lifespan,
    )
    # 세션 쿠키를 쓰므로 credentials 허용 + origin 화이트리스트.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # 브라우저 fetch()는 CORS safelist 밖의 응답 헤더를 서버가 명시적으로 노출해야만
        # 읽을 수 있다. allow_headers는 "요청" 헤더 허용이라 응답 노출과 무관하다 -
        # 이게 빠지면 프론트의 res.headers.get("X-Auth-Requirement")가 항상 null이 되어
        # 미인증(403+헤더)과 권한 없음(403)을 구분하지 못한다. curl/urllib에서는 헤더가
        # 그대로 보이므로 서버 측 스모크만으로는 잡히지 않는 종류의 버그다.
        expose_headers=["X-Auth-Requirement"],
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
            if origin is not None and origin not in allowed_origins:
                return JSONResponse(status_code=403, content={"detail": "origin not allowed"})
        return await call_next(request)

    # auth_router(구 세션 인증)와 users_router(레거시 프로필/팔로우, 이미
    # profiles_router/Firestore로 이관됨)는 Postgres 없이 배포하기 위해
    # 등록만 해제한다 - 파일은 남겨둔다(학생증 인증을 Firestore로 옮길 때
    # app/api/auth.py를 참조할 예정). auth_sync_router(Firebase 인증 동기화,
    # Firestore 기반)는 현역이라 그대로 둔다.
    app.include_router(health_router)
    app.include_router(auth_sync_router)
    app.include_router(constellation_router)
    app.include_router(constellation_intake_router)
    app.include_router(courses_router)
    app.include_router(explore_router)
    app.include_router(profiles_router)
    app.include_router(posts_router)
    app.include_router(notifications_router)
    app.include_router(stories_router)
    app.include_router(community_router)
    app.include_router(community_notes_router)
    app.include_router(dm_router)
    return app


app = create_app()
