"""개발용 Mock 결제: 항상 승인하고 가짜 영수증 id를 돌려준다."""
import logging
import uuid

logger = logging.getLogger("app.payments")


class MockPaymentClient:
    async def charge(self, user_id: int, amount_krw: int, description: str) -> str:
        receipt_id = f"mock-{uuid.uuid4().hex}"
        logger.info(
            "[MOCK PAYMENT] user=%s amount=%s krw desc=%s receipt=%s",
            user_id, amount_krw, description, receipt_id,
        )
        print(
            f"[MOCK PAYMENT] user={user_id} | {amount_krw}KRW | {description} | {receipt_id}",
            flush=True,
        )
        return receipt_id
