"""콩 화폐 API: 주간 랭킹(수확 콩만), 현금 구매(Mock PG)."""
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.beans import get_balance
from app.core.deps import require_yonsei_verified
from app.core.rate_limit import rate_limit
from app.db import get_db
from app.models.roadmap import BeanTransaction, User
from app.payments import get_payment_client
from app.payments.base import PaymentError
from app.schemas.roadmap import (
    BeanPurchaseRequest,
    BeanPurchaseResponse,
    BeanRankingEntry,
    user_to_out,
)

router = APIRouter(prefix="/api/beans", tags=["beans"])

# 패키지: id -> (콩 개수, 가격 KRW)
PACKAGES: dict[str, tuple[int, int]] = {
    "bean_10": (10, 1_000),
    "bean_55": (55, 5_000),
    "bean_120": (120, 10_000),
}


def week_start(today: date | None = None) -> datetime:
    """이번 주 시작(월요일 00:00)."""
    today = today or date.today()
    return datetime.combine(today - timedelta(days=today.weekday()), time.min)


@router.get("/ranking", response_model=list[BeanRankingEntry])
async def weekly_ranking(db: AsyncSession = Depends(get_db)) -> list[BeanRankingEntry]:
    """이번 주 수확 콩 TOP 20. 구매 콩(bean_purchase)은 집계하지 않는다."""
    earned = func.sum(BeanTransaction.amount).label("earned")
    rows = (
        await db.execute(
            select(User, earned)
            .join(BeanTransaction, BeanTransaction.user_id == User.id)
            .where(
                BeanTransaction.reason == "roadmap_completed",
                BeanTransaction.created_at >= week_start(),
            )
            .group_by(User.id)
            .order_by(desc("earned"), User.id)
            .limit(20)
        )
    ).all()
    return [
        BeanRankingEntry(rank=i + 1, user=user_to_out(user), beans_earned=int(total))
        for i, (user, total) in enumerate(rows)
    ]


@router.post("/purchase", response_model=BeanPurchaseResponse)
async def purchase_beans(
    request: BeanPurchaseRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_yonsei_verified),
    _: None = Depends(rate_limit("bean-purchase", limit=5)),
) -> BeanPurchaseResponse:
    """콩 현금 구매. 현재 결제는 Mock PG(무조건 승인) - 실 PG 연동 전 운영 금지."""
    beans, price_krw = PACKAGES[request.package_id]
    try:
        receipt_id = await get_payment_client().charge(
            user_id=user.id, amount_krw=price_krw, description=f"콩 {beans}개 패키지"
        )
    except PaymentError as e:
        raise HTTPException(status_code=402, detail="결제에 실패했어요.") from e

    db.add(
        BeanTransaction(
            user_id=user.id,
            amount=beans,
            reason="bean_purchase",
            external_ref=receipt_id,
        )
    )
    await db.commit()
    balance = await get_balance(db, user.id)
    return BeanPurchaseResponse(
        detail=f"콩 {beans}개 충전 완료!", bean_balance=balance, receipt_id=receipt_id
    )
