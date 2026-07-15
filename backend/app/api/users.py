from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.beans import get_balance
from app.core.deps import get_current_user, get_current_user_optional, require_yonsei_verified
from app.db import get_db
from app.models.roadmap import Follow, Roadmap, User
from app.schemas.roadmap import (
    BioPatchRequest,
    RoadmapCardOut,
    UserProfileOut,
    roadmap_to_card,
)

router = APIRouter(prefix="/api/users", tags=["users"])


async def _profile_out(
    db: AsyncSession, user: User, viewer: User | None
) -> UserProfileOut:
    roadmap_count = await db.scalar(
        select(func.count()).select_from(Roadmap).where(Roadmap.user_id == user.id)
    )
    follower_count = await db.scalar(
        select(func.count()).select_from(Follow).where(Follow.followee_id == user.id)
    )
    following_count = await db.scalar(
        select(func.count()).select_from(Follow).where(Follow.follower_id == user.id)
    )
    is_following = None
    if viewer is not None and viewer.id != user.id:
        follow = await db.scalar(
            select(Follow).where(
                Follow.follower_id == viewer.id, Follow.followee_id == user.id
            )
        )
        is_following = follow is not None
    return UserProfileOut(
        id=user.id,
        display_name=user.display_name,
        avatar_emoji=user.avatar_emoji,
        bio=user.bio,
        yonsei_verified=user.yonsei_verified_at is not None,
        roadmap_count=roadmap_count or 0,
        follower_count=follower_count or 0,
        following_count=following_count or 0,
        is_following=is_following,
        bean_balance=await get_balance(db, user.id),
    )


@router.patch("/me", response_model=UserProfileOut)
async def update_my_profile(
    request: BioPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserProfileOut:
    """프로필 소개글 수정 (본인만)."""
    user.bio = request.bio.strip() or None
    await db.commit()
    return await _profile_out(db, user, viewer=user)


@router.get("/{user_id}", response_model=UserProfileOut)
async def get_user_profile(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> UserProfileOut:
    """유저 프로필 (공개). 팔로워/팔로잉/콩나무 수 포함."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return await _profile_out(db, user, viewer)


@router.get("/{user_id}/roadmaps", response_model=list[RoadmapCardOut])
async def list_user_roadmaps(
    user_id: int, db: AsyncSession = Depends(get_db)
) -> list[RoadmapCardOut]:
    """유저의 모든 콩나무 (숲 미노출 포함, 프로필 페이지용)."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    roadmaps = (
        await db.scalars(
            select(Roadmap)
            .where(Roadmap.user_id == user_id)
            .options(selectinload(Roadmap.user), selectinload(Roadmap.milestones))
            .order_by(Roadmap.created_at.desc())
        )
    ).all()
    return [roadmap_to_card(r) for r in roadmaps]


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
