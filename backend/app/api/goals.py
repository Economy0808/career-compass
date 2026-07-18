"""대목표(CareerGoal) API: 관망 콩나무 상세 + 숲 노출 토글.

숲(피드)의 카드가 대목표 단위가 되면서, 상세(관망 콩나무)와
"메인에 띄우기" 토글도 대목표 단위로 제공한다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user_optional, require_yonsei_verified
from app.db import get_db
from app.models.roadmap import CareerGoal, Follow, Roadmap, User
from app.schemas.roadmap import (
    FeedCardOut,
    GoalDetailOut,
    GoalPatchRequest,
    goal_to_card,
    goal_to_detail,
)

router = APIRouter(prefix="/api/goals", tags=["goals"])

_GOAL_LOADERS = (
    selectinload(CareerGoal.user),
    selectinload(CareerGoal.roadmaps).selectinload(Roadmap.milestones),
)


async def _load_goal(db: AsyncSession, goal_id: int) -> CareerGoal:
    goal = await db.scalar(
        select(CareerGoal).where(CareerGoal.id == goal_id).options(*_GOAL_LOADERS)
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="goal not found")
    return goal


@router.get("/{goal_id}", response_model=GoalDetailOut)
async def get_goal(
    goal_id: int,
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> GoalDetailOut:
    """대목표 관망 콩나무 상세. 마일스톤 = 소분류 로드맵. 비로그인 열람 허용."""
    goal = await _load_goal(db, goal_id)

    is_following: bool | None = None
    if viewer is not None:
        is_following = (
            await db.scalar(
                select(Follow.id).where(
                    Follow.follower_id == viewer.id, Follow.followee_id == goal.user_id
                )
            )
        ) is not None

    return goal_to_detail(goal, is_following=is_following)


@router.patch("/{goal_id}", response_model=FeedCardOut)
async def patch_goal(
    goal_id: int,
    request: GoalPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> FeedCardOut:
    """대목표 숲 노출(is_featured) 토글. 소유자만 가능."""
    goal = await _load_goal(db, goal_id)
    if goal.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 대목표만 수정할 수 있어요.")
    goal.is_featured = request.is_featured
    await db.commit()
    return goal_to_card(goal)
