"""일일 투두(일정) API.

개인 리소스이므로 로그인(get_current_user)만 요구하고 연세 인증은 요구하지 않는다.
모든 조회/수정은 user_id == 세션 유저 검사로 IDOR을 막는다.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db import get_db
from app.models.roadmap import User
from app.models.todo import TodoCategory, TodoItem
from app.schemas.todo import (
    CalendarDayOut,
    CategoryCreateRequest,
    CategoryPatchRequest,
    ItemCreateRequest,
    ItemPatchRequest,
    TodoCategoryOut,
    TodoDayOut,
    TodoItemOut,
    category_to_out,
    item_to_out,
)

router = APIRouter(prefix="/api/todos", tags=["todos"])

# 첫 방문 시 자동 생성하는 기본 분류 (이름, 색)
_DEFAULT_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("분류 1", "green"),
    ("분류 2", "sky"),
    ("분류 3", "gold"),
)


async def _my_categories(db: AsyncSession, user_id: int) -> list[TodoCategory]:
    return list(
        (
            await db.scalars(
                select(TodoCategory)
                .where(TodoCategory.user_id == user_id)
                .order_by(TodoCategory.order_index, TodoCategory.id)
            )
        ).all()
    )


async def _owned_category(db: AsyncSession, category_id: int, user_id: int) -> TodoCategory:
    category = await db.get(TodoCategory, category_id)
    if category is None or category.user_id != user_id:
        raise HTTPException(status_code=404, detail="category not found")
    return category


async def _owned_item(db: AsyncSession, item_id: int, user_id: int) -> TodoItem:
    item = await db.get(TodoItem, item_id)
    if item is None or item.user_id != user_id:
        raise HTTPException(status_code=404, detail="item not found")
    return item


@router.get("/day", response_model=TodoDayOut)
async def get_day(
    date_: date = Query(alias="date"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TodoDayOut:
    """선택한 날짜의 할 일 + 내 전체 분류. 분류가 없으면 기본 3개를 만들어준다."""
    categories = await _my_categories(db, user.id)
    if not categories:
        # 개인 리소스라 write-on-read 허용 - 처음 오면 바로 쓸 수 있게 기본 분류 시드
        for i, (name, color) in enumerate(_DEFAULT_CATEGORIES):
            db.add(TodoCategory(user_id=user.id, name=name, color=color, order_index=i))
        await db.commit()
        categories = await _my_categories(db, user.id)

    items = (
        await db.scalars(
            select(TodoItem)
            .where(TodoItem.user_id == user.id, TodoItem.due_date == date_)
            .order_by(TodoItem.order_index, TodoItem.id)
        )
    ).all()
    return TodoDayOut(
        categories=[category_to_out(c) for c in categories],
        items=[item_to_out(i) for i in items],
    )


@router.get("/calendar", response_model=list[CalendarDayOut])
async def get_calendar(
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CalendarDayOut]:
    """해당 월의 날짜별 완료/전체 집계 (캘린더 콩 강도용)."""
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    rows = (
        await db.execute(
            select(
                TodoItem.due_date,
                func.count().label("total"),
                func.sum(cast(TodoItem.is_completed, Integer)).label("done"),
            )
            .where(
                TodoItem.user_id == user.id,
                TodoItem.due_date >= start,
                TodoItem.due_date < end,
            )
            .group_by(TodoItem.due_date)
        )
    ).all()
    return [
        CalendarDayOut(date=due, completed_count=int(done or 0), total_count=int(total))
        for due, total, done in rows
    ]


@router.post("/categories", response_model=TodoCategoryOut, status_code=201)
async def create_category(
    request: CategoryCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TodoCategoryOut:
    next_order = await db.scalar(
        select(func.coalesce(func.max(TodoCategory.order_index), -1) + 1).where(
            TodoCategory.user_id == user.id
        )
    )
    category = TodoCategory(
        user_id=user.id, name=request.name, color=request.color, order_index=int(next_order or 0)
    )
    db.add(category)
    await db.commit()
    return category_to_out(category)


@router.patch("/categories/{category_id}", response_model=TodoCategoryOut)
async def patch_category(
    category_id: int,
    request: CategoryPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TodoCategoryOut:
    category = await _owned_category(db, category_id, user.id)
    if request.name is not None:
        category.name = request.name
    if request.color is not None:
        category.color = request.color
    if request.order_index is not None:
        category.order_index = request.order_index
    await db.commit()
    return category_to_out(category)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    category = await _owned_category(db, category_id, user.id)
    await db.delete(category)  # items cascade
    await db.commit()


@router.post("/items", response_model=TodoItemOut, status_code=201)
async def create_item(
    request: ItemCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TodoItemOut:
    # 분류 소유권 확인 (남의 분류에 못 넣도록)
    await _owned_category(db, request.category_id, user.id)
    next_order = await db.scalar(
        select(func.coalesce(func.max(TodoItem.order_index), -1) + 1).where(
            TodoItem.user_id == user.id,
            TodoItem.category_id == request.category_id,
            TodoItem.due_date == request.due_date,
        )
    )
    item = TodoItem(
        user_id=user.id,
        category_id=request.category_id,
        content=request.content,
        due_date=request.due_date,
        order_index=int(next_order or 0),
    )
    db.add(item)
    await db.commit()
    return item_to_out(item)


@router.patch("/items/{item_id}", response_model=TodoItemOut)
async def patch_item(
    item_id: int,
    request: ItemPatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TodoItemOut:
    item = await _owned_item(db, item_id, user.id)
    if request.content is not None:
        item.content = request.content
    if request.order_index is not None:
        item.order_index = request.order_index
    if request.is_completed is not None:
        item.is_completed = request.is_completed
        item.completed_at = datetime.now() if request.is_completed else None
    await db.commit()
    return item_to_out(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    item = await _owned_item(db, item_id, user.id)
    await db.delete(item)
    await db.commit()
