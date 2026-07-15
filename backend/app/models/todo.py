"""일일 투두(일정) ORM 모델: TodoCategory, TodoItem.

콩나무 로드맵(장기 목표)과 별개인 하루 단위 실행 플래너. 콩 화폐와는 무관하며
캘린더의 콩 표시는 순수 시각적 연출이다.
"""
from datetime import date, datetime
from typing import Literal

from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.roadmap import User

# 분류 색상 토큰 (프론트에서 실제 hex로 매핑)
TodoColor = Literal["green", "sky", "gold", "coral", "violet", "brown"]
TODO_COLORS: tuple[str, ...] = ("green", "sky", "gold", "coral", "violet", "brown")


class TodoCategory(Base):
    """유저의 할 일 분류. 날짜와 무관한 전역 분류(모든 날짜에서 공통으로 보인다)."""

    __tablename__ = "todo_categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    color: Mapped[str] = mapped_column(nullable=False, server_default="green")
    order_index: Mapped[int] = mapped_column(nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    items: Mapped[list["TodoItem"]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"TodoCategory(id={self.id}, name={self.name!r})"


class TodoItem(Base):
    """특정 날짜(due_date)에 속하는 할 일. 분류에 묶이며 완료 토글이 가능하다."""

    __tablename__ = "todo_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # user_id는 category에서 유도 가능하지만 소유권 체크·캘린더 집계를 위해 비정규화
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("todo_categories.id"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(nullable=False)
    due_date: Mapped[date] = mapped_column(nullable=False, index=True)
    is_completed: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    order_index: Mapped[int] = mapped_column(nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    category: Mapped[TodoCategory] = relationship(back_populates="items")
    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"TodoItem(id={self.id}, content={self.content!r}, done={self.is_completed})"
