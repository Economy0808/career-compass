"""결제 클라이언트 인터페이스."""

from typing import Protocol


class PaymentClient(Protocol):
    async def charge(self, user_id: int, amount_krw: int, description: str) -> str:
        """결제를 승인하고 영수증 id를 돌려준다. 실패 시 PaymentError."""
        ...


class PaymentError(Exception):
    """결제 실패."""
