"""로드맵 SNS API 요청/응답 Pydantic 스키마.

status/progress_pct는 DB에 저장된 컬럼이 아니라 계산값이므로, ORM 인스턴스를
그대로 from_attributes로 변환하지 않고 아래 roadmap_to_*/milestone_to_out
헬퍼로 명시적으로 직렬화한다.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.roadmap import Milestone, MilestoneStatus, Roadmap, User, compute_progress_pct

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


class MilestoneOut(BaseModel):
    id: int
    order_index: int
    title: str
    description: str
    due_date: date
    is_completed_manual: bool
    completed_at: datetime | None
    status: MilestoneStatus


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


class MilestonePatchRequest(BaseModel):
    is_completed: bool


class MilestonePatchResponse(BaseModel):
    milestone: MilestoneOut
    roadmap_id: int
    roadmap_progress_pct: float


def user_to_out(user: User) -> UserOut:
    return UserOut(id=user.id, display_name=user.display_name, avatar_emoji=user.avatar_emoji)


def milestone_to_out(milestone: Milestone) -> MilestoneOut:
    return MilestoneOut(
        id=milestone.id,
        order_index=milestone.order_index,
        title=milestone.title,
        description=milestone.description,
        due_date=milestone.due_date,
        is_completed_manual=milestone.is_completed_manual,
        completed_at=milestone.completed_at,
        status=milestone.compute_status(),
    )


def roadmap_to_detail(roadmap: Roadmap, is_following: bool | None = None) -> RoadmapDetailOut:
    return RoadmapDetailOut(
        id=roadmap.id,
        user=user_to_out(roadmap.user),
        title=roadmap.title,
        goal_raw_text=roadmap.goal_raw_text,
        created_at=roadmap.created_at,
        progress_pct=compute_progress_pct(roadmap.milestones),
        milestones=[milestone_to_out(m) for m in roadmap.milestones],
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
    )
