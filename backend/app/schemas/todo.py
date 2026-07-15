"""일일 투두 API 요청/응답 스키마."""
from datetime import date

from pydantic import BaseModel, Field, field_validator

from app.models.todo import TODO_COLORS, TodoCategory, TodoItem


def _validate_color(v: str) -> str:
    if v not in TODO_COLORS:
        raise ValueError(f"color must be one of {TODO_COLORS}")
    return v


class TodoCategoryOut(BaseModel):
    id: int
    name: str
    color: str
    order_index: int


class TodoItemOut(BaseModel):
    id: int
    category_id: int
    content: str
    is_completed: bool
    order_index: int


class TodoDayOut(BaseModel):
    categories: list[TodoCategoryOut]
    items: list[TodoItemOut]


class CalendarDayOut(BaseModel):
    date: date
    completed_count: int
    total_count: int


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    color: str = "green"

    _check_color = field_validator("color")(_validate_color)


class CategoryPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=20)
    color: str | None = None
    order_index: int | None = None

    @field_validator("color")
    @classmethod
    def check_color(cls, v: str | None) -> str | None:
        return None if v is None else _validate_color(v)


class ItemCreateRequest(BaseModel):
    category_id: int
    due_date: date
    content: str = Field(min_length=1, max_length=200)


class ItemPatchRequest(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=200)
    is_completed: bool | None = None
    order_index: int | None = None


def category_to_out(category: TodoCategory) -> TodoCategoryOut:
    return TodoCategoryOut(
        id=category.id,
        name=category.name,
        color=category.color,
        order_index=category.order_index,
    )


def item_to_out(item: TodoItem) -> TodoItemOut:
    return TodoItemOut(
        id=item.id,
        category_id=item.category_id,
        content=item.content,
        is_completed=item.is_completed,
        order_index=item.order_index,
    )
