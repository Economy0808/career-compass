"""테스트용 인증 헬퍼: 유저/세션을 DB에 직접 만들어 API 플로우를 우회한다."""
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import hash_password, hash_token, new_session_token, session_expiry
from app.models.account import AuthSession, EmailVerification, StudentCardVerification
from app.models.roadmap import Follow, Roadmap, User

TEST_PASSWORD = "test-passw0rd!"


def unique_suffix() -> str:
    return uuid.uuid4().hex[:10]


async def create_user(
    session: AsyncSession,
    *,
    email_verified: bool = True,
    yonsei_verified: bool = True,
    display_name: str = "테스트유저",
    avatar_emoji: str = "🧪",
) -> User:
    sfx = unique_suffix()
    user = User(
        display_name=display_name,
        avatar_emoji=avatar_emoji,
        username=f"u{sfx}",
        email=f"{sfx}@example.com",
        password_hash=hash_password(TEST_PASSWORD),
        email_verified_at=datetime.now() if email_verified else None,
        yonsei_verified_at=datetime.now() if yonsei_verified else None,
        verification_method="school_email" if yonsei_verified else None,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def create_session_token(session: AsyncSession, user: User) -> str:
    """세션을 만들고 쿠키에 넣을 원본 토큰을 돌려준다."""
    token = new_session_token()
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=session_expiry(get_settings()),
        )
    )
    await session.commit()
    return token


async def delete_user_cascade(session: AsyncSession, user_id: int) -> None:
    """테스트 유저와 그에 딸린 모든 행을 정리한다."""
    for model, col in (
        (AuthSession, AuthSession.user_id),
        (EmailVerification, EmailVerification.user_id),
        (StudentCardVerification, StudentCardVerification.user_id),
    ):
        rows = (await session.scalars(select(model).where(col == user_id))).all()
        for row in rows:
            await session.delete(row)
    follows = (
        await session.scalars(
            select(Follow).where(
                (Follow.follower_id == user_id) | (Follow.followee_id == user_id)
            )
        )
    ).all()
    for f in follows:
        await session.delete(f)
    roadmaps = (await session.scalars(select(Roadmap).where(Roadmap.user_id == user_id))).all()
    for r in roadmaps:
        await session.delete(r)
    user = await session.get(User, user_id)
    if user is not None:
        await session.delete(user)
    await session.commit()
