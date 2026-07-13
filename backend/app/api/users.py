from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.roadmap import Follow, User
from app.schemas.roadmap import FollowRequest, UserOut, user_to_out

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserOut]:
    """더미 유저 스위처용 목록."""
    users = (await db.scalars(select(User).order_by(User.id))).all()
    return [user_to_out(u) for u in users]


@router.post("/{user_id}/follow", status_code=204)
async def follow_user(
    user_id: int, request: FollowRequest, db: AsyncSession = Depends(get_db)
) -> None:
    """user_id를 팔로우한다. 이미 팔로우 중이면 아무것도 하지 않는다(idempotent)."""
    if request.follower_id == user_id:
        raise HTTPException(status_code=400, detail="cannot follow yourself")

    followee = await db.get(User, user_id)
    follower = await db.get(User, request.follower_id)
    if followee is None or follower is None:
        raise HTTPException(status_code=404, detail="user not found")

    existing = await db.scalar(
        select(Follow).where(
            Follow.follower_id == request.follower_id, Follow.followee_id == user_id
        )
    )
    if existing is None:
        db.add(Follow(follower_id=request.follower_id, followee_id=user_id))
        await db.commit()


@router.delete("/{user_id}/follow", status_code=204)
async def unfollow_user(
    user_id: int, request: FollowRequest, db: AsyncSession = Depends(get_db)
) -> None:
    """user_id 팔로우를 취소한다. 팔로우 중이 아니어도 아무것도 하지 않는다(idempotent)."""
    existing = await db.scalar(
        select(Follow).where(
            Follow.follower_id == request.follower_id, Follow.followee_id == user_id
        )
    )
    if existing is not None:
        await db.delete(existing)
        await db.commit()
