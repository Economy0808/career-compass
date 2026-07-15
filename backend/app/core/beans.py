"""콩 화폐 서비스: 잔액 조회, 완주 보상 지급."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.roadmap import BeanTransaction, Roadmap, compute_progress_pct


async def get_balance(db: AsyncSession, user_id: int) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(BeanTransaction.amount), 0)).where(
            BeanTransaction.user_id == user_id
        )
    )
    return int(total or 0)


def award_completion_if_due(roadmap: Roadmap, settings: Settings) -> BeanTransaction | None:
    """진행률이 100%에 처음 도달했으면 보상 트랜잭션을 만들어 돌려준다.

    호출자가 세션에 add/commit 한다. 로드맵당 1회만 (beans_awarded_at).
    """
    if roadmap.beans_awarded_at is not None:
        return None
    if compute_progress_pct(roadmap.milestones) < 100.0:
        return None
    amount = len(roadmap.milestones) * settings.bean_reward_multiplier
    roadmap.beans_awarded_at = datetime.now()
    return BeanTransaction(
        user_id=roadmap.user_id,
        amount=amount,
        reason="roadmap_completed",
        roadmap_title=roadmap.title,
    )
