"""학생증 심사 로직. CLI(scripts/review_student_cards.py)가 얇게 감싼다.

PIPA: 승인/거절 어느 쪽이든 결정 즉시 이미지 파일을 삭제하고
image_path를 비운다. DB에는 심사 결과만 남는다.
"""

from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import StudentCardVerification
from app.models.roadmap import User


async def list_pending(db: AsyncSession) -> list[StudentCardVerification]:
    return list(
        (
            await db.scalars(
                select(StudentCardVerification)
                .where(StudentCardVerification.status == "pending")
                .order_by(StudentCardVerification.created_at)
            )
        ).all()
    )


def _delete_image(card: StudentCardVerification) -> None:
    if card.image_path:
        path = Path(card.image_path)
        if path.exists():
            path.unlink()
    card.image_path = None


async def approve_card(db: AsyncSession, card_id: int) -> StudentCardVerification:
    card = await db.get(StudentCardVerification, card_id)
    if card is None or card.status != "pending":
        raise ValueError(f"pending card {card_id} not found")
    user = await db.get(User, card.user_id)
    assert user is not None

    card.status = "approved"
    card.reviewed_at = datetime.now()
    _delete_image(card)
    user.yonsei_verified_at = datetime.now()
    user.verification_method = "student_card"
    await db.commit()
    return card


async def reject_card(db: AsyncSession, card_id: int, reason: str) -> StudentCardVerification:
    card = await db.get(StudentCardVerification, card_id)
    if card is None or card.status != "pending":
        raise ValueError(f"pending card {card_id} not found")

    card.status = "rejected"
    card.reject_reason = reason
    card.reviewed_at = datetime.now()
    _delete_image(card)
    await db.commit()
    return card
