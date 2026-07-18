"""로드맵 SNS API 요청/응답 Pydantic 스키마.

status/progress_pct는 DB에 저장된 컬럼이 아니라 계산값이므로, ORM 인스턴스를
그대로 from_attributes로 변환하지 않고 아래 roadmap_to_*/milestone_to_out
헬퍼로 명시적으로 직렬화한다.
"""

from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.models.roadmap import (
    Milestone,
    MilestonePost,
    MilestoneStatus,
    PostComment,
    Roadmap,
    User,
    compute_progress_pct,
    compute_withered,
)

ChatRole = Literal["user", "assistant"]
FeedScope = Literal["all", "following"]


class UserOut(BaseModel):
    id: int
    display_name: str
    avatar_emoji: str


class ChatMessageIn(BaseModel):
    role: ChatRole
    content: str


class ChatRequest(BaseModel):
    goal_raw_text: str
    messages: list[ChatMessageIn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    done: bool
    question: str | None
    messages: list[ChatMessageIn]


class MilestonePreviewOut(BaseModel):
    """프리뷰 마일스톤. plant 요청이 그대로 되돌려주므로 저장 한도 캡을 여기서 강제한다."""

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=300)
    detail: str = Field(min_length=1, max_length=4000)
    due_date: date


class CareerGoalDecisionOut(BaseModel):
    existing_id: int | None = None
    title: str = Field(min_length=1, max_length=100)
    context: str = Field(min_length=1, max_length=2000)
    is_new: bool = True


class PreviewRequest(BaseModel):
    # 작성자는 body가 아니라 세션에서 결정된다 (IDOR 방지).
    goal_raw_text: str = Field(min_length=1, max_length=2000)
    messages: list[ChatMessageIn] = Field(default_factory=list)


class RoadmapPreviewOut(BaseModel):
    """저장 전 로드맵 프리뷰 — plant 요청의 본체가 그대로 된다."""

    title: str = Field(min_length=1, max_length=120)
    briefing: str = Field(max_length=2000)
    ncs_job_code: str | None = None
    career_goal: CareerGoalDecisionOut
    milestones: list[MilestonePreviewOut] = Field(min_length=3, max_length=15)


class PlantRequest(RoadmapPreviewOut):
    """프리뷰 페이로드 + 원본 대화. 검증 캡은 RoadmapPreviewOut에서 상속."""

    goal_raw_text: str = Field(min_length=1, max_length=2000)
    messages: list[ChatMessageIn] = Field(default_factory=list)

    @field_validator("milestones")
    @classmethod
    def _due_dates_in_range(cls, v: list[MilestonePreviewOut]) -> list[MilestonePreviewOut]:
        low = date.today() - timedelta(days=30)
        high = date.today() + timedelta(days=365 * 3)
        for m in v:
            if not (low <= m.due_date <= high):
                raise ValueError(f"due_date out of range: {m.due_date}")
        return v


class MilestonePostOut(BaseModel):
    caption: str
    body: str | None
    has_image: bool
    image_url: str | None
    updated_at: datetime
    like_count: int
    liked_by_me: bool
    comment_count: int


class MilestoneOut(BaseModel):
    id: int
    order_index: int
    title: str
    description: str
    detail: str | None = None
    due_date: date
    is_completed_manual: bool
    completed_at: datetime | None
    status: MilestoneStatus
    post: MilestonePostOut | None = None


class CommentOut(BaseModel):
    id: int
    user: UserOut
    content: str
    created_at: datetime
    can_delete: bool


class CommentCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class RoadmapPatchRequest(BaseModel):
    is_featured: bool


class UserProfileOut(BaseModel):
    id: int
    display_name: str
    avatar_emoji: str
    bio: str | None
    yonsei_verified: bool
    roadmap_count: int
    follower_count: int
    following_count: int
    is_following: bool | None = None
    bean_balance: int = 0


class BioPatchRequest(BaseModel):
    bio: str = Field(max_length=200)


class BeanRankingEntry(BaseModel):
    rank: int
    user: UserOut
    beans_earned: int


BeanPackageId = Literal["bean_10", "bean_55", "bean_120"]


class BeanPurchaseRequest(BaseModel):
    package_id: BeanPackageId


class BeanPurchaseResponse(BaseModel):
    detail: str
    bean_balance: int
    receipt_id: str


class RoadmapDetailOut(BaseModel):
    id: int
    user: UserOut
    title: str
    goal_raw_text: str
    created_at: datetime
    progress_pct: float
    milestones: list[MilestoneOut]
    is_following: bool | None = None
    is_withered: bool = False
    major_goal_title: str | None = None


class RoadmapCardOut(BaseModel):
    id: int
    user: UserOut
    title: str
    progress_pct: float
    milestone_count: int
    created_at: datetime
    is_following: bool | None = None
    is_featured: bool = True
    is_withered: bool = False
    major_goal_title: str | None = None


class MilestonePatchRequest(BaseModel):
    is_completed: bool


class MilestonePatchResponse(BaseModel):
    milestone: MilestoneOut
    roadmap_id: int
    roadmap_progress_pct: float
    # 이 토글로 완주 보상이 지급됐으면 지급된 콩 개수
    beans_awarded: int | None = None


def user_to_out(user: User) -> UserOut:
    return UserOut(id=user.id, display_name=user.display_name, avatar_emoji=user.avatar_emoji)


def post_to_out(
    post: MilestonePost, milestone_id: int, viewer_id: int | None = None
) -> MilestonePostOut:
    """post.likes/comments가 eager load된 상태를 전제로 한다."""
    return MilestonePostOut(
        caption=post.caption,
        body=post.body,
        has_image=post.image_path is not None,
        image_url=(
            f"/api/roadmap/milestones/{milestone_id}/post/image?v={int(post.updated_at.timestamp())}"
            if post.image_path is not None
            else None
        ),
        updated_at=post.updated_at,
        like_count=len(post.likes),
        liked_by_me=viewer_id is not None and any(like.user_id == viewer_id for like in post.likes),
        comment_count=len(post.comments),
    )


def comment_to_out(comment: PostComment, viewer_id: int | None, owner_id: int) -> CommentOut:
    """owner_id는 기록이 달린 로드맵 소유자 - 본인 댓글 또는 소유자는 삭제 가능."""
    return CommentOut(
        id=comment.id,
        user=user_to_out(comment.user),
        content=comment.content,
        created_at=comment.created_at,
        can_delete=viewer_id is not None and viewer_id in (comment.user_id, owner_id),
    )


def milestone_to_out(milestone: Milestone, viewer_id: int | None = None) -> MilestoneOut:
    return MilestoneOut(
        id=milestone.id,
        order_index=milestone.order_index,
        title=milestone.title,
        description=milestone.description,
        detail=milestone.detail,
        due_date=milestone.due_date,
        is_completed_manual=milestone.is_completed_manual,
        completed_at=milestone.completed_at,
        status=milestone.compute_status(),
        post=post_to_out(milestone.post, milestone.id, viewer_id) if milestone.post else None,
    )


def roadmap_to_detail(
    roadmap: Roadmap, is_following: bool | None = None, viewer_id: int | None = None
) -> RoadmapDetailOut:
    return RoadmapDetailOut(
        id=roadmap.id,
        user=user_to_out(roadmap.user),
        title=roadmap.title,
        goal_raw_text=roadmap.goal_raw_text,
        created_at=roadmap.created_at,
        progress_pct=compute_progress_pct(roadmap.milestones),
        milestones=[milestone_to_out(m, viewer_id) for m in roadmap.milestones],
        is_following=is_following,
        is_withered=compute_withered(roadmap.milestones, get_settings().withered_grace_days),
        major_goal_title=roadmap.career_goal.title if roadmap.career_goal else None,
    )


def roadmap_to_card(roadmap: Roadmap, is_following: bool | None = None) -> RoadmapCardOut:
    return RoadmapCardOut(
        id=roadmap.id,
        user=user_to_out(roadmap.user),
        title=roadmap.title,
        progress_pct=compute_progress_pct(roadmap.milestones),
        milestone_count=len(roadmap.milestones),
        created_at=roadmap.created_at,
        is_following=is_following,
        is_featured=roadmap.is_featured,
        is_withered=compute_withered(roadmap.milestones, get_settings().withered_grace_days),
        major_goal_title=roadmap.career_goal.title if roadmap.career_goal else None,
    )
