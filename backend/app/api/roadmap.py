import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.core.beans import award_completion_if_due, get_balance
from app.core.deps import get_current_user_optional, require_yonsei_verified
from app.core.rate_limit import rate_limit
from app.core.uploads import detect_image_ext, resize_to_jpeg
from app.db import get_db
from app.llm import get_llm_client
from app.llm.base import ChatMessage, LLMClient
from app.models.roadmap import (
    BeanTransaction,
    CareerGoal,
    Follow,
    Milestone,
    MilestonePost,
    PostComment,
    PostLike,
    Roadmap,
    User,
    compute_progress_pct,
    compute_withered,
    progress_from_counts,
    withered_from_counts,
)
from app.schemas.roadmap import (
    CareerGoalDecisionOut,
    ChatMessageIn,
    ChatRequest,
    ChatResponse,
    CommentCreateRequest,
    CommentOut,
    FeedCardOut,
    FeedScope,
    MilestonePatchRequest,
    MilestonePatchResponse,
    MilestonePostOut,
    MilestonePreviewOut,
    PlantRequest,
    PreviewRequest,
    RoadmapCardOut,
    RoadmapDetailOut,
    RoadmapItemPreviewOut,
    RoadmapPatchRequest,
    RoadmapPreviewOut,
    comment_to_out,
    feed_card_from_goal_agg,
    feed_card_from_roadmap_agg,
    milestone_to_out,
    post_to_out,
    roadmap_to_card,
    roadmap_to_detail,
)
from app.services import roadmap_gen

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/roadmap", tags=["roadmap"])

_LLM_UNAVAILABLE = HTTPException(
    status_code=503,
    detail="AI 응답을 받지 못했어요. 잠시 후 다시 시도해주세요.",
)

# milestone.post와 likes/comments까지 eager load (async lazy load 금지)
_POST_LOADERS = (
    selectinload(Milestone.post).selectinload(MilestonePost.likes),
    selectinload(Milestone.post).selectinload(MilestonePost.comments),
)


async def _get_post_with_context(
    db: AsyncSession, milestone_id: int
) -> tuple[Milestone, MilestonePost | None]:
    """마일스톤 + (있다면) 기록을 소유자 판별에 필요한 로드맵과 함께 읽는다."""
    milestone = await db.scalar(
        select(Milestone)
        .where(Milestone.id == milestone_id)
        .options(selectinload(Milestone.roadmap), *_POST_LOADERS)
    )
    if milestone is None:
        raise HTTPException(status_code=404, detail="milestone not found")
    return milestone, milestone.post


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    llm: LLMClient = Depends(get_llm_client),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    _: None = Depends(rate_limit("roadmap-chat", limit=30)),
) -> ChatResponse:
    """Stateless 질답 진행. 프론트가 messages 전체 히스토리를 들고 재전송한다.

    기존 대목표가 있으면 그 컨텍스트를 주입해 이미 아는 정보는 다시 묻지 않는다.
    """
    goals = await roadmap_gen.load_career_goals(db, user.id)
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in request.messages]
    try:
        turn = await llm.chat(
            request.goal_raw_text,
            llm_messages,
            known_profile=roadmap_gen.build_known_profile(goals),
        )
    except Exception:
        # 키 무효/크레딧 소진/네트워크 등 LLM 장애를 명확한 503으로 노출 (bare 500 방지)
        logger.exception("LLM chat failed")
        raise _LLM_UNAVAILABLE from None

    updated_messages = list(request.messages)
    if turn.question is not None:
        updated_messages.append(ChatMessageIn(role="assistant", content=turn.question))

    return ChatResponse(done=turn.done, question=turn.question, messages=updated_messages)


@router.post("/preview", response_model=RoadmapPreviewOut)
async def preview_roadmap(
    request: PreviewRequest,
    llm: LLMClient = Depends(get_llm_client),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    _: None = Depends(rate_limit("roadmap-preview", limit=10)),
) -> RoadmapPreviewOut:
    """완료된 질답으로 로드맵을 생성해 저장 없이 돌려준다 (심기 전 미리보기).

    브리핑·대목표 판단 포함. 유저가 확정하면 이 페이로드를 /plant로 되돌려 보낸다.
    """
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in request.messages]
    try:
        generated, ncs_job_code = await roadmap_gen.generate_preview(
            db, llm, user.id, request.goal_raw_text, llm_messages
        )
    except Exception:
        logger.exception("LLM preview generation failed")
        raise _LLM_UNAVAILABLE from None
    decision = generated.major_goal
    assert decision is not None  # generate_preview가 항상 채운다
    return RoadmapPreviewOut(
        briefing=generated.briefing,
        ncs_job_code=ncs_job_code,
        career_goal=CareerGoalDecisionOut(
            existing_id=decision.existing_goal_id,
            title=decision.title,
            context=decision.context,
            is_new=decision.existing_goal_id is None,
        ),
        roadmaps=[
            RoadmapItemPreviewOut(
                title=item.title,
                milestones=[
                    MilestonePreviewOut(
                        title=m.title,
                        description=m.description,
                        detail=m.detail,
                        due_date=m.due_date,
                    )
                    for m in item.milestones
                ],
            )
            for item in generated.items
        ],
    )


@router.post("/plant", response_model=list[RoadmapDetailOut], status_code=201)
async def plant_roadmap(
    request: PlantRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    _: None = Depends(rate_limit("roadmap-plant", limit=20)),
) -> list[RoadmapDetailOut]:
    """프리뷰 세트를 검증 후 그대로 저장한다 (LLM 재호출 없음).

    작성자는 세션 유저 — 클라이언트가 보낸 user_id를 신뢰하지 않는다.
    대목표는 get-or-create: existing_id는 소유권 검증, 신규는 (user_id,title)로 중복 방지.
    제목 넘버링: 같은 대목표 안에서 만들어진 순서대로 " #N"을 서버가 붙인다.
    """
    # 대목표 결정 (existing_id 소유권 검증 → 재사용, 아니면 title로 get-or-create)
    goal_row: CareerGoal | None = None
    if request.career_goal.existing_id is not None:
        goal_row = await db.get(CareerGoal, request.career_goal.existing_id)
        if goal_row is None or goal_row.user_id != user.id:
            raise HTTPException(status_code=422, detail="career goal not found")
        goal_row.context = request.career_goal.context
    else:
        goal_row = await db.scalar(
            select(CareerGoal).where(
                CareerGoal.user_id == user.id,
                CareerGoal.title == request.career_goal.title,
            )
        )
        if goal_row is not None:
            goal_row.context = request.career_goal.context
        else:
            goal_row = CareerGoal(
                user_id=user.id,
                title=request.career_goal.title,
                context=request.career_goal.context,
            )
            db.add(goal_row)
            await db.flush()  # career_goal_id FK에 쓸 id 확보

    # 브리핑은 대화의 마지막 assistant 메시지로 transcript에 남긴다.
    transcript = [m.model_dump() for m in request.messages]
    if request.briefing:
        transcript.append({"role": "assistant", "content": request.briefing})

    # 넘버링: 같은 대목표의 기존 #N 최댓값에 이어서 부여 (count 기반이면 삭제 후 중복됨)
    existing_titles = (
        await db.scalars(select(Roadmap.title).where(Roadmap.career_goal_id == goal_row.id))
    ).all()
    next_n = (
        max(
            (int(m.group(1)) for t in existing_titles if (m := re.search(r"#(\d+)$", t))),
            default=0,
        )
        + 1
    )

    planted: list[Roadmap] = []
    for n, item in enumerate(request.roadmaps, start=next_n):
        roadmap = Roadmap(
            user_id=user.id,
            career_goal_id=goal_row.id,
            title=f"{item.title} #{n}",
            goal_raw_text=request.goal_raw_text,
            chat_transcript=transcript or None,
            ncs_job_code=request.ncs_job_code,
        )
        roadmap.user = user
        roadmap.career_goal = goal_row
        roadmap.milestones = [
            Milestone(
                order_index=i,
                title=m.title,
                description=m.description,
                detail=m.detail,
                due_date=m.due_date,
                # 새 마일스톤은 기록이 없음을 명시해 커밋 후 lazy load를 막는다.
                post=None,
            )
            for i, m in enumerate(item.milestones)
        ]
        db.add(roadmap)
        planted.append(roadmap)
    await db.commit()

    return [roadmap_to_detail(r) for r in planted]


@router.get("/feed", response_model=list[FeedCardOut])
async def get_feed(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    scope: FeedScope = Query("all"),
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> list[FeedCardOut]:
    """최신순 피드. 비로그인 열람 허용.

    숲에는 대목표당 1개의 관망 카드(kind=goal)를 띄우고, 대목표 도입 이전의
    레거시 로드맵(career_goal_id IS NULL)은 기존처럼 로드맵 카드로 띄운다.
    노출 여부는 대목표의 is_featured(관망) / 로드맵의 is_featured(레거시).
    viewer는 세션에서 도출한다. scope=following은 로그인 필수.
    """
    if scope == "following" and viewer is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    following_ids: set[int] = set()
    if viewer is not None:
        following_ids = set(
            (
                await db.scalars(select(Follow.followee_id).where(Follow.follower_id == viewer.id))
            ).all()
        )
    if scope == "following" and not following_ids:
        return []

    fetch_span = limit + offset  # 병합 후 슬라이스하므로 각 소스에서 여유 있게 가져온다
    grace = get_settings().withered_grace_days

    # 카드 수치(진행률·시듦)에 필요한 건 마일스톤 자체가 아니라 개수와 마지막 마감일뿐이라
    # SQL에서 집계한다. 나눗셈·반올림은 Python에 남겨 기존 계산과 값이 정확히 일치시킨다.
    ms_agg = (
        select(
            Milestone.roadmap_id.label("roadmap_id"),
            func.count(Milestone.id).label("total"),
            func.count(Milestone.id).filter(Milestone.is_completed_manual.is_(True)).label("done"),
            func.max(Milestone.due_date).label("max_due"),
        )
        .group_by(Milestone.roadmap_id)
        .subquery()
    )

    goal_ids_stmt = (
        select(CareerGoal.id)
        .where(CareerGoal.is_featured.is_(True))
        .order_by(CareerGoal.created_at.desc())
        .limit(fetch_span)
    )
    legacy_stmt = (
        select(Roadmap, User, ms_agg.c.total, ms_agg.c.done, ms_agg.c.max_due)
        .join(User, User.id == Roadmap.user_id)
        .outerjoin(ms_agg, ms_agg.c.roadmap_id == Roadmap.id)
        .where(Roadmap.is_featured.is_(True), Roadmap.career_goal_id.is_(None))
        .order_by(Roadmap.created_at.desc())
        .limit(fetch_span)
    )
    if scope == "following":
        goal_ids_stmt = goal_ids_stmt.where(CareerGoal.user_id.in_(following_ids))
        legacy_stmt = legacy_stmt.where(Roadmap.user_id.in_(following_ids))

    # 소분류 로드맵 1개당 1행. Roadmap과의 inner join이 "로드맵 없는 대목표 제외"를 겸한다.
    goal_stmt = (
        select(CareerGoal, User, ms_agg.c.total, ms_agg.c.done, ms_agg.c.max_due)
        .join(Roadmap, Roadmap.career_goal_id == CareerGoal.id)
        .join(User, User.id == CareerGoal.user_id)
        .outerjoin(ms_agg, ms_agg.c.roadmap_id == Roadmap.id)
        .where(CareerGoal.id.in_(goal_ids_stmt))
        .order_by(CareerGoal.created_at.desc())
    )

    def _following(owner_id: int) -> bool | None:
        return (owner_id in following_ids) if viewer is not None else None

    goal_rows: dict[int, tuple[CareerGoal, User, list[tuple[float, bool]]]] = {}
    for goal, owner, total, done, max_due in (await db.execute(goal_stmt)).all():
        total, done = total or 0, done or 0
        _, _, stats = goal_rows.setdefault(goal.id, (goal, owner, []))
        stats.append(
            (
                progress_from_counts(done, total),
                withered_from_counts(total, done, max_due, grace),
            )
        )

    cards: list[FeedCardOut] = [
        feed_card_from_goal_agg(goal, owner, stats, is_following=_following(goal.user_id))
        for goal, owner, stats in goal_rows.values()
    ]
    cards += [
        feed_card_from_roadmap_agg(
            roadmap,
            owner,
            total or 0,
            done or 0,
            max_due,
            is_following=_following(roadmap.user_id),
        )
        for roadmap, owner, total, done, max_due in (await db.execute(legacy_stmt)).all()
    ]
    cards.sort(key=lambda c: c.created_at, reverse=True)
    return cards[offset : offset + limit]


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
        .options(selectinload(Milestone.roadmap).selectinload(Roadmap.milestones), *_POST_LOADERS)
    )
    milestone = await db.scalar(stmt)
    if milestone is None:
        raise HTTPException(status_code=404, detail="milestone not found")
    if milestone.roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 로드맵의 마일스톤만 수정할 수 있어요.")

    milestone.is_completed_manual = request.is_completed
    milestone.completed_at = datetime.now() if request.is_completed else None

    # 완주 보상: 진행률이 처음 100%에 도달하면 마일스톤 수 x 2 콩 지급 (1회)
    settings = get_settings()
    award = award_completion_if_due(milestone.roadmap, settings)
    if award is not None:
        db.add(award)
    await db.commit()

    return MilestonePatchResponse(
        milestone=milestone_to_out(milestone, viewer_id=user.id),
        roadmap_id=milestone.roadmap_id,
        roadmap_progress_pct=compute_progress_pct(milestone.roadmap.milestones),
        beans_awarded=award.amount if award else None,
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
        .options(
            selectinload(Roadmap.user),
            selectinload(Roadmap.milestones)
            .selectinload(Milestone.post)
            .selectinload(MilestonePost.likes),
            selectinload(Roadmap.milestones)
            .selectinload(Milestone.post)
            .selectinload(MilestonePost.comments),
        )
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

    return roadmap_to_detail(
        roadmap, is_following=is_following, viewer_id=viewer.id if viewer else None
    )


@router.patch("/{roadmap_id}", response_model=RoadmapCardOut)
async def patch_roadmap(
    roadmap_id: int,
    request: RoadmapPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> RoadmapCardOut:
    """ "메인에 띄우기" 토글. 소유자만."""
    roadmap = await db.scalar(
        select(Roadmap)
        .where(Roadmap.id == roadmap_id)
        .options(selectinload(Roadmap.user), selectinload(Roadmap.milestones))
    )
    if roadmap is None:
        raise HTTPException(status_code=404, detail="roadmap not found")
    if roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 콩나무만 수정할 수 있어요.")
    if roadmap.career_goal_id is not None:
        # 대목표 소속 콩나무의 숲 노출은 대목표 단위 — 개별 토글은 피드에 무효라 막는다
        raise HTTPException(
            status_code=409,
            detail="이 콩나무의 숲 노출은 대목표 단위로 관리돼요. 프로필의 대목표 체크박스를 사용해주세요.",
        )
    roadmap.is_featured = request.is_featured
    await db.commit()
    return roadmap_to_card(roadmap)


@router.delete("/{roadmap_id}", status_code=204)
async def delete_roadmap(
    roadmap_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    settings: Settings = Depends(get_settings),
) -> None:
    """시들어버린 콩나무 정리. 콩 10개를 소모하며, 시들지 않은 콩나무는 지울 수 없다."""
    roadmap = await db.scalar(
        select(Roadmap)
        .where(Roadmap.id == roadmap_id)
        .options(
            # ORM cascade가 flush 시 lazy load를 타지 않도록 트리 전체를 eager load
            selectinload(Roadmap.milestones)
            .selectinload(Milestone.post)
            .selectinload(MilestonePost.likes),
            selectinload(Roadmap.milestones)
            .selectinload(Milestone.post)
            .selectinload(MilestonePost.comments),
        )
    )
    if roadmap is None:
        raise HTTPException(status_code=404, detail="roadmap not found")
    if roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 콩나무만 정리할 수 있어요.")
    if not compute_withered(roadmap.milestones, settings.withered_grace_days):
        raise HTTPException(
            status_code=409,
            detail="시들지 않은 콩나무는 지울 수 없어요. 숲에서 숨기려면 '메인에 띄우기'를 꺼주세요.",
        )
    balance = await get_balance(db, user.id)
    if balance < settings.bean_delete_cost:
        raise HTTPException(
            status_code=409,
            detail=f"콩이 부족해요. 정리에는 콩 {settings.bean_delete_cost}개가 필요해요 (보유 {balance}개).",
        )

    db.add(
        BeanTransaction(
            user_id=user.id,
            amount=-settings.bean_delete_cost,
            reason="roadmap_deleted",
            roadmap_title=roadmap.title,
        )
    )
    for m in roadmap.milestones:
        if m.post:
            _delete_post_image(m.post)
    goal_id = roadmap.career_goal_id
    await db.delete(roadmap)
    # 마지막 소분류였다면 대목표도 정리 — 고아 대목표가 남아 빈 관망 페이지와
    # stale known_profile 주입을 만들지 않게 한다.
    if goal_id is not None:
        await db.flush()
        remaining = await db.scalar(
            select(func.count()).select_from(Roadmap).where(Roadmap.career_goal_id == goal_id)
        )
        if not remaining:
            orphan = await db.get(CareerGoal, goal_id)
            if orphan is not None:
                await db.delete(orphan)
    await db.commit()


# ---------- 마일스톤 기록 (사진 + 문구 + 줄글) ----------


def _require_owner(milestone: Milestone, user: User) -> None:
    if milestone.roadmap.user_id != user.id:
        raise HTTPException(
            status_code=403, detail="내 로드맵의 마일스톤에만 기록을 남길 수 있어요."
        )


def _delete_post_image(post: MilestonePost) -> None:
    if post.image_path:
        path = Path(post.image_path)
        if path.exists():
            path.unlink()
    post.image_path = None


@router.put("/milestones/{milestone_id}/post", response_model=MilestonePostOut)
async def upsert_milestone_post(
    milestone_id: int,
    caption: str = Form(min_length=1, max_length=80),
    body: str | None = Form(None, max_length=5000),
    file: UploadFile | None = None,
    remove_image: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    settings: Settings = Depends(get_settings),
) -> MilestonePostOut:
    """기록 작성/수정 (upsert). 사진은 선택 - 올리면 1280px로 축소해 JPEG로 저장."""
    milestone, post = await _get_post_with_context(db, milestone_id)
    _require_owner(milestone, user)

    if post is None:
        post = MilestonePost(milestone_id=milestone.id, caption=caption, body=body)
        db.add(post)
    else:
        post.caption = caption
        post.body = body

    if file is not None:
        data = await file.read(settings.milestone_image_max_bytes + 1)
        if len(data) > settings.milestone_image_max_bytes:
            raise HTTPException(status_code=413, detail="이미지는 5MB 이하만 올릴 수 있어요.")
        if detect_image_ext(data) is None:
            raise HTTPException(status_code=422, detail="JPEG 또는 PNG 이미지만 올릴 수 있어요.")
        try:
            resized = resize_to_jpeg(data)
        except ValueError as e:
            raise HTTPException(status_code=422, detail="이미지 파일이 손상됐어요.") from e
        image_dir = Path(settings.milestone_image_dir)
        image_dir.mkdir(parents=True, exist_ok=True)
        _delete_post_image(post)
        image_path = image_dir / f"{uuid.uuid4().hex}.jpg"
        image_path.write_bytes(resized)
        post.image_path = str(image_path)
    elif remove_image:
        _delete_post_image(post)

    post.updated_at = datetime.now()
    await db.commit()
    await db.refresh(post, attribute_names=["likes", "comments"])
    return post_to_out(post, milestone.id, viewer_id=user.id)


@router.delete("/milestones/{milestone_id}/post", status_code=204)
async def delete_milestone_post(
    milestone_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> None:
    milestone, post = await _get_post_with_context(db, milestone_id)
    _require_owner(milestone, user)
    if post is not None:
        _delete_post_image(post)
        await db.delete(post)
        await db.commit()


@router.get("/milestones/{milestone_id}/post/image")
async def get_milestone_post_image(
    milestone_id: int, db: AsyncSession = Depends(get_db)
) -> FileResponse:
    """기록 이미지 서빙 (공개 콘텐츠)."""
    post = await db.scalar(select(MilestonePost).where(MilestonePost.milestone_id == milestone_id))
    if post is None or not post.image_path or not Path(post.image_path).exists():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(post.image_path, media_type="image/jpeg")


@router.post("/milestones/{milestone_id}/post/like", status_code=204)
async def like_post(
    milestone_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> None:
    """좋아요 (idempotent)."""
    _, post = await _get_post_with_context(db, milestone_id)
    if post is None:
        raise HTTPException(status_code=404, detail="post not found")
    existing = await db.scalar(
        select(PostLike).where(PostLike.post_id == post.id, PostLike.user_id == user.id)
    )
    if existing is None:
        db.add(PostLike(post_id=post.id, user_id=user.id))
        await db.commit()


@router.delete("/milestones/{milestone_id}/post/like", status_code=204)
async def unlike_post(
    milestone_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> None:
    _, post = await _get_post_with_context(db, milestone_id)
    if post is None:
        raise HTTPException(status_code=404, detail="post not found")
    existing = await db.scalar(
        select(PostLike).where(PostLike.post_id == post.id, PostLike.user_id == user.id)
    )
    if existing is not None:
        await db.delete(existing)
        await db.commit()


@router.get("/milestones/{milestone_id}/post/comments", response_model=list[CommentOut])
async def list_comments(
    milestone_id: int,
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> list[CommentOut]:
    milestone, post = await _get_post_with_context(db, milestone_id)
    if post is None:
        return []
    comments = (
        await db.scalars(
            select(PostComment)
            .where(PostComment.post_id == post.id)
            .options(selectinload(PostComment.user))
            .order_by(PostComment.created_at, PostComment.id)
        )
    ).all()
    viewer_id = viewer.id if viewer else None
    return [comment_to_out(c, viewer_id, milestone.roadmap.user_id) for c in comments]


@router.post("/milestones/{milestone_id}/post/comments", response_model=CommentOut, status_code=201)
async def create_comment(
    milestone_id: int,
    request: CommentCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> CommentOut:
    milestone, post = await _get_post_with_context(db, milestone_id)
    if post is None:
        raise HTTPException(status_code=404, detail="post not found")
    comment = PostComment(post_id=post.id, user_id=user.id, content=request.content)
    db.add(comment)
    await db.commit()
    await db.refresh(comment, attribute_names=["user"])
    return comment_to_out(comment, user.id, milestone.roadmap.user_id)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> None:
    """본인 댓글 또는 기록이 달린 로드맵 소유자만 삭제 가능."""
    comment = await db.scalar(
        select(PostComment)
        .where(PostComment.id == comment_id)
        .options(
            selectinload(PostComment.post)
            .selectinload(MilestonePost.milestone)
            .selectinload(Milestone.roadmap)
        )
    )
    if comment is None:
        raise HTTPException(status_code=404, detail="comment not found")
    owner_id = comment.post.milestone.roadmap.user_id
    if user.id not in (comment.user_id, owner_id):
        raise HTTPException(status_code=403, detail="삭제 권한이 없어요.")
    await db.delete(comment)
    await db.commit()
