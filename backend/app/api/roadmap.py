from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user_optional, require_yonsei_verified
from app.db import get_db
from app.llm import get_llm_client
from app.llm.base import ChatMessage, LLMClient
from app.models.roadmap import Follow, Milestone, Roadmap, User, compute_progress_pct
from app.schemas.roadmap import (
    ChatMessageIn,
    ChatRequest,
    ChatResponse,
    FeedScope,
    GenerateRequest,
    MilestonePatchRequest,
    MilestonePatchResponse,
    RoadmapCardOut,
    RoadmapDetailOut,
    milestone_to_out,
    roadmap_to_card,
    roadmap_to_detail,
)

router = APIRouter(prefix="/api/roadmap", tags=["roadmap"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    llm: LLMClient = Depends(get_llm_client),
    _: User = Depends(require_yonsei_verified),
) -> ChatResponse:
    """Stateless 질답 진행. 프론트가 messages 전체 히스토리를 들고 재전송한다."""
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in request.messages]
    turn = await llm.chat(request.goal_raw_text, llm_messages)

    updated_messages = list(request.messages)
    if turn.question is not None:
        updated_messages.append(ChatMessageIn(role="assistant", content=turn.question))

    return ChatResponse(done=turn.done, question=turn.question, messages=updated_messages)


@router.post("/generate", response_model=RoadmapDetailOut, status_code=201)
async def generate_roadmap(
    request: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> RoadmapDetailOut:
    """완료된 질답을 바탕으로 로드맵+마일스톤을 생성하고 저장한다.

    작성자는 세션 유저 — 클라이언트가 보낸 user_id를 신뢰하지 않는다.
    """
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in request.messages]
    generated = await llm.generate_roadmap(request.goal_raw_text, llm_messages)

    roadmap = Roadmap(
        user_id=user.id,
        title=generated.title,
        goal_raw_text=request.goal_raw_text,
        chat_transcript=[m.model_dump() for m in request.messages] or None,
    )
    roadmap.user = user
    roadmap.milestones = [
        Milestone(
            order_index=i,
            title=m.title,
            description=m.description,
            due_date=m.due_date,
        )
        for i, m in enumerate(generated.milestones)
    ]
    db.add(roadmap)
    await db.commit()

    return roadmap_to_detail(roadmap)


@router.get("/feed", response_model=list[RoadmapCardOut])
async def get_feed(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    scope: FeedScope = Query("all"),
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> list[RoadmapCardOut]:
    """최신순 로드맵 카드 피드. 비로그인 열람 허용.

    viewer는 세션에서 도출한다. scope=following은 로그인 필수.
    """
    if scope == "following" and viewer is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    following_ids: set[int] = set()
    if viewer is not None:
        following_ids = set(
            (
                await db.scalars(
                    select(Follow.followee_id).where(Follow.follower_id == viewer.id)
                )
            ).all()
        )

    stmt = (
        select(Roadmap)
        .options(selectinload(Roadmap.user), selectinload(Roadmap.milestones))
        .order_by(Roadmap.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if scope == "following":
        if not following_ids:
            return []
        stmt = stmt.where(Roadmap.user_id.in_(following_ids))

    roadmaps = (await db.scalars(stmt)).all()
    return [
        roadmap_to_card(
            r, is_following=(r.user_id in following_ids) if viewer is not None else None
        )
        for r in roadmaps
    ]


@router.patch("/milestones/{milestone_id}", response_model=MilestonePatchResponse)
async def patch_milestone(
    milestone_id: int,
    request: MilestonePatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> MilestonePatchResponse:
    """마일스톤 수동 완료/취소 토글. 로드맵 소유자만 가능."""
    stmt = (
        select(Milestone)
        .where(Milestone.id == milestone_id)
        .options(selectinload(Milestone.roadmap).selectinload(Roadmap.milestones))
    )
    milestone = await db.scalar(stmt)
    if milestone is None:
        raise HTTPException(status_code=404, detail="milestone not found")
    if milestone.roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 로드맵의 마일스톤만 수정할 수 있어요.")

    milestone.is_completed_manual = request.is_completed
    milestone.completed_at = datetime.now() if request.is_completed else None
    await db.commit()

    return MilestonePatchResponse(
        milestone=milestone_to_out(milestone),
        roadmap_id=milestone.roadmap_id,
        roadmap_progress_pct=compute_progress_pct(milestone.roadmap.milestones),
    )


@router.get("/{roadmap_id}", response_model=RoadmapDetailOut)
async def get_roadmap(
    roadmap_id: int,
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> RoadmapDetailOut:
    stmt = (
        select(Roadmap)
        .where(Roadmap.id == roadmap_id)
        .options(selectinload(Roadmap.user), selectinload(Roadmap.milestones))
    )
    roadmap = await db.scalar(stmt)
    if roadmap is None:
        raise HTTPException(status_code=404, detail="roadmap not found")

    is_following = None
    if viewer is not None:
        follow = await db.scalar(
            select(Follow).where(
                Follow.follower_id == viewer.id, Follow.followee_id == roadmap.user_id
            )
        )
        is_following = follow is not None

    return roadmap_to_detail(roadmap, is_following=is_following)
