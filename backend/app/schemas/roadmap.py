"""로드맵 SNS API 요청/응답 Pydantic 스키마.

status/progress_pct는 DB에 저장된 컬럼이 아니라 계산값이므로, ORM 인스턴스를
그대로 from_attributes로 변환하지 않고 아래 roadmap_to_*/milestone_to_out
헬퍼로 명시적으로 직렬화한다.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.roadmap import (
    Milestone,
    MilestonePost,
    MilestoneStatus,
    PostComment,
    Roadmap,
    User,
    compute_progress_pct,
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


class GenerateRequest(BaseModel):
    # 작성자는 body가 아니라 세션에서 결정된다 (IDOR 방지).
    goal_raw_text: str
    messages: list[ChatMessageIn] = Field(default_factory=list)


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


class BioPatchRequest(BaseModel):
    bio: str = Field(max_length=200)


class RoadmapDetailOut(BaseModel):
    id: int
    user: UserOut
    title: str
    goal_raw_text: str
    created_at: datetime
    progress_pct: float
    milestones: list[MilestoneOut]
    is_following: bool | None = None


class RoadmapCardOut(BaseModel):
    id: int
    user: UserOut
    title: str
    progress_pct: float
    milestone_count: int
    created_at: datetime
    is_following: bool | None = None
    is_featured: bool = True


class MilestonePatchRequest(BaseModel):
    is_completed: bool


class MilestonePatchResponse(BaseModel):
    milestone: MilestoneOut
    roadmap_id: int
    roadmap_progress_pct: float


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
        liked_by_me=viewer_id is not None
        and any(like.user_id == viewer_id for like in post.likes),
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
    )
