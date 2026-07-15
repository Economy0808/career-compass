"""로드맵 SNS 관련 ORM 모델: User, Roadmap, Milestone."""
from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

MilestoneStatus = Literal["완료", "기한초과", "진행중"]


class User(Base):
    """서비스 유저.

    인증 컬럼은 전부 nullable: 초기 프로토타입의 더미 유저 행은 자격증명이
    없어 로그인할 수 없는 레거시 데이터로 공존한다.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(nullable=False)
    avatar_emoji: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # --- auth (nullable for legacy dummy rows) ---
    username: Mapped[str | None] = mapped_column(unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    yonsei_verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # "school_email" | "student_card"
    verification_method: Mapped[str | None] = mapped_column(nullable=True)
    role: Mapped[str] = mapped_column(nullable=False, server_default="user")
    # 프로필 소개글 (선택, 200자 제한은 스키마에서 강제)
    bio: Mapped[str | None] = mapped_column(nullable=True)

    def __repr__(self) -> str:
        return f"User(id={self.id}, display_name={self.display_name!r})"


class Roadmap(Base):
    """사용자의 목표 로드맵 (피드에 노출되는 게시물 단위)."""

    __tablename__ = "roadmaps"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(nullable=False)
    goal_raw_text: Mapped[str] = mapped_column(nullable=False)
    chat_transcript: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
    # 로드맵 숲(피드)에 노출할지 여부 - 유저가 "메인에 띄우기"로 고른다.
    is_featured: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    # 완주 보상 콩 지급 시각 - 로드맵당 1회만 지급 (완료 해제/재완료 중복 방지)
    beans_awarded_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship()
    milestones: Mapped[list["Milestone"]] = relationship(
        back_populates="roadmap",
        order_by="Milestone.order_index",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"Roadmap(id={self.id}, title={self.title!r})"


class Milestone(Base):
    """로드맵을 구성하는 개별 마일스톤."""

    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    roadmap_id: Mapped[int] = mapped_column(ForeignKey("roadmaps.id"), nullable=False)
    order_index: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(nullable=False)
    description: Mapped[str] = mapped_column(nullable=False)
    due_date: Mapped[date] = mapped_column(nullable=False)
    is_completed_manual: Mapped[bool] = mapped_column(nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    roadmap: Mapped[Roadmap] = relationship(back_populates="milestones")
    post: Mapped["MilestonePost | None"] = relationship(
        back_populates="milestone", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"Milestone(id={self.id}, title={self.title!r})"

    def compute_status(self, today: date | None = None) -> MilestoneStatus:
        """수동 완료 체크가 마감일 기반 자동 판단을 덮어쓴다."""
        if self.is_completed_manual:
            return "완료"
        if self.due_date < (today or date.today()):
            return "기한초과"
        return "진행중"


BeanReason = Literal["roadmap_completed", "bean_purchase", "roadmap_deleted"]


class BeanTransaction(Base):
    """콩 화폐 원장. 보유량 = amount 합계.

    reason:
    - roadmap_completed: 콩나무 완주 수확 (+) - 주간 랭킹은 이것만 집계
    - bean_purchase: 현금 구매 (+) - 랭킹 미반영, external_ref에 결제 영수증
    - roadmap_deleted: 시든 콩나무 정리 비용 (-)
    """

    __tablename__ = "bean_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(nullable=False)  # BeanReason
    # 삭제된 로드맵도 내역이 남도록 FK 대신 제목 스냅샷
    roadmap_title: Mapped[str | None] = mapped_column(nullable=True)
    # 결제 영수증 id (bean_purchase일 때)
    external_ref: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"BeanTransaction(user_id={self.user_id}, amount={self.amount}, reason={self.reason!r})"


class MilestonePost(Base):
    """마일스톤 기록: 사진(선택) + 짤막한 문구 + 줄글. 마일스톤당 최대 1개."""

    __tablename__ = "milestone_posts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    milestone_id: Mapped[int] = mapped_column(
        ForeignKey("milestones.id"), nullable=False, unique=True
    )
    image_path: Mapped[str | None] = mapped_column(nullable=True)
    caption: Mapped[str] = mapped_column(nullable=False)
    body: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    milestone: Mapped[Milestone] = relationship(back_populates="post")
    likes: Mapped[list["PostLike"]] = relationship(
        back_populates="post", cascade="all, delete-orphan"
    )
    comments: Mapped[list["PostComment"]] = relationship(
        back_populates="post",
        order_by="PostComment.created_at",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"MilestonePost(id={self.id}, milestone_id={self.milestone_id})"


class PostLike(Base):
    """마일스톤 기록 좋아요. 유저당 기록 하나에 한 번."""

    __tablename__ = "post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_like"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("milestone_posts.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    post: Mapped[MilestonePost] = relationship(back_populates="likes")

    def __repr__(self) -> str:
        return f"PostLike(post_id={self.post_id}, user_id={self.user_id})"


class PostComment(Base):
    """마일스톤 기록 댓글."""

    __tablename__ = "post_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("milestone_posts.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    post: Mapped[MilestonePost] = relationship(back_populates="comments")
    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"PostComment(id={self.id}, post_id={self.post_id})"


class Follow(Base):
    """유저 간 팔로우 관계. 팔로잉 피드와 카드의 is_following 계산에 쓰인다."""

    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id", name="uq_follow_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    def __repr__(self) -> str:
        return f"Follow(follower_id={self.follower_id}, followee_id={self.followee_id})"


def compute_progress_pct(milestones: list[Milestone], today: date | None = None) -> float:
    """완료된 마일스톤 비율(0~100)을 계산한다."""
    if not milestones:
        return 0.0
    completed = sum(1 for m in milestones if m.compute_status(today) == "완료")
    return round(completed / len(milestones) * 100, 1)


def compute_withered(
    milestones: list[Milestone], grace_days: int, today: date | None = None
) -> bool:
    """시든 콩나무 판정: 마지막 마감일 + 유예기간이 지나도 100% 미만.

    상태와 마찬가지로 저장하지 않고 매 요청 계산 - 늦게라도 완주하면 되살아난다.
    """
    if not milestones:
        return False
    today = today or date.today()
    deadline = max(m.due_date for m in milestones)
    if today <= deadline + timedelta(days=grace_days):
        return False
    return compute_progress_pct(milestones, today) < 100.0
