from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_yonsei_verified
from app.db import get_db
from app.models.roadmap import Follow, User

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("/{user_id}/follow", status_code=204)
async def follow_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    follower: User = Depends(require_yonsei_verified),
) -> None:
    """user_id를 팔로우한다. 팔로워는 세션 유저 (IDOR 방지). idempotent."""
    if follower.id == user_id:
        raise HTTPException(status_code=400, detail="cannot follow yourself")

    followee = await db.get(User, user_id)
    if followee is None:
        raise HTTPException(status_code=404, detail="user not found")

    existing = await db.scalar(
        select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == user_id
        )
    )
    if existing is None:
        db.add(Follow(follower_id=follower.id, followee_id=user_id))
        await db.commit()


@router.delete("/{user_id}/follow", status_code=204)
async def unfollow_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    follower: User = Depends(require_yonsei_verified),
) -> None:
    """user_id 팔로우를 취소한다. idempotent."""
    existing = await db.scalar(
        select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == user_id
        )
    )
    if existing is not None:
        await db.delete(existing)
        await db.commit()
