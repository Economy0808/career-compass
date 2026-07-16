import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
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
    Follow,
    Milestone,
    MilestonePost,
    PostComment,
    PostLike,
    Roadmap,
    User,
    compute_progress_pct,
    compute_withered,
)
from app.schemas.roadmap import (
    ChatMessageIn,
    ChatRequest,
    ChatResponse,
    CommentCreateRequest,
    CommentOut,
    FeedScope,
    GenerateRequest,
    MilestonePatchRequest,
    MilestonePatchResponse,
    MilestonePostOut,
    RoadmapCardOut,
    RoadmapDetailOut,
    RoadmapPatchRequest,
    comment_to_out,
    milestone_to_out,
    post_to_out,
    roadmap_to_card,
    roadmap_to_detail,
)
from app.services import roadmap_gen

router = APIRouter(prefix="/api/roadmap", tags=["roadmap"])

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
    _: User = Depends(require_yonsei_verified),
    __: None = Depends(rate_limit("roadmap-chat", limit=30)),
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
    _: None = Depends(rate_limit("roadmap-generate", limit=10)),
) -> RoadmapDetailOut:
    """완료된 질답을 바탕으로 정밀 로드맵을 생성·저장한다.

    작성자는 세션 유저 — 클라이언트가 보낸 user_id를 신뢰하지 않는다.
    생성은 roadmap_gen 서비스가 오케스트레이션한다 (의중추출→NCS매칭→리서치캐시→종합).
    """
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in request.messages]
    generated, ncs_job_code = await roadmap_gen.generate_roadmap(
        db, llm, request.goal_raw_text, llm_messages
    )

    roadmap = Roadmap(
        user_id=user.id,
        title=generated.title,
        goal_raw_text=request.goal_raw_text,
        chat_transcript=[m.model_dump() for m in request.messages] or None,
        ncs_job_code=ncs_job_code,
    )
    roadmap.user = user
    roadmap.milestones = [
        Milestone(
            order_index=i,
            title=m.title,
            description=m.description,
            due_date=m.due_date,
            # 새 마일스톤은 기록이 없음을 명시해 커밋 후 lazy load를 막는다.
            post=None,
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
        .where(Roadmap.is_featured.is_(True))  # 숲에는 "메인에 띄우기" 한 것만
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
            selectinload(Roadmap.milestones).selectinload(Milestone.post).selectinload(MilestonePost.likes),
            selectinload(Roadmap.milestones).selectinload(Milestone.post).selectinload(MilestonePost.comments),
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

    return roadmap_to_detail(roadmap, is_following=is_following, viewer_id=viewer.id if viewer else None)


@router.patch("/{roadmap_id}", response_model=RoadmapCardOut)
async def patch_roadmap(
    roadmap_id: int,
    request: RoadmapPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
) -> RoadmapCardOut:
    """"메인에 띄우기" 토글. 소유자만."""
    roadmap = await db.scalar(
        select(Roadmap)
        .where(Roadmap.id == roadmap_id)
        .options(selectinload(Roadmap.user), selectinload(Roadmap.milestones))
    )
    if roadmap is None:
        raise HTTPException(status_code=404, detail="roadmap not found")
    if roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 콩나무만 수정할 수 있어요.")
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
            selectinload(Roadmap.milestones).selectinload(Milestone.post).selectinload(MilestonePost.likes),
            selectinload(Roadmap.milestones).selectinload(Milestone.post).selectinload(MilestonePost.comments),
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
    await db.delete(roadmap)
    await db.commit()


# ---------- 마일스톤 기록 (사진 + 문구 + 줄글) ----------


def _require_owner(milestone: Milestone, user: User) -> None:
    if milestone.roadmap.user_id != user.id:
        raise HTTPException(status_code=403, detail="내 로드맵의 마일스톤에만 기록을 남길 수 있어요.")


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
    post = await db.scalar(
        select(MilestonePost).where(MilestonePost.milestone_id == milestone_id)
    )
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
