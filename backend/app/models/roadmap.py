"""로드맵 SNS 관련 ORM 모델: User, Roadmap, Milestone."""
from datetime import date, datetime
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

    def __repr__(self) -> str:
        return f"Milestone(id={self.id}, title={self.title!r})"

    def compute_status(self, today: date | None = None) -> MilestoneStatus:
        """수동 완료 체크가 마감일 기반 자동 판단을 덮어쓴다."""
        if self.is_completed_manual:
            return "완료"
        if self.due_date < (today or date.today()):
            return "기한초과"
        return "진행중"


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
