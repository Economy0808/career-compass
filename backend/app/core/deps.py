"""인증 의존성: 세션 쿠키 → 유저 해석, 권한 게이트."""

from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import SESSION_COOKIE, hash_token
from app.db import get_db
from app.models.account import AuthSession
from app.models.roadmap import User


async def get_current_user_optional(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User | None:
    """쿠키가 없거나 세션이 무효면 None. 공개 열람 엔드포인트용."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = await db.scalar(
        select(AuthSession)
        .where(
            AuthSession.token_hash == hash_token(token),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.now(),
        )
        .options(selectinload(AuthSession.user))
    )
    return session.user if session else None


async def get_current_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user


async def require_yonsei_verified(user: User = Depends(get_current_user)) -> User:
    """쓰기 행동 게이트: 연세대 인증(학교메일 또는 학생증 승인)까지 끝난 유저만."""
    if user.yonsei_verified_at is None:
        # 403은 소유권 위반(남의 리소스 수정)에도 쓰이므로, 프론트가 "인증 유도 화면"과
        # "권한 없음"을 구분할 수 있도록 기계 판독용 헤더를 함께 내려준다.
        # (app.auth.deps.require_yonsei_verified와 동일한 규약 - 커밋 461c04f)
        raise HTTPException(
            status_code=403,
            detail="연세대 학부생 인증이 필요합니다.",
            headers={"X-Auth-Requirement": "yonsei-verified"},
        )
    return user
