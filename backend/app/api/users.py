from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.roadmap import User
from app.schemas.roadmap import UserOut, user_to_out

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserOut]:
    """더미 유저 스위처용 목록."""
    users = (await db.scalars(select(User).order_by(User.id))).all()
    return [user_to_out(u) for u in users]
