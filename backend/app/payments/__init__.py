"""결제 클라이언트 팩토리. LLM/이메일과 같은 Mock/실제 분리 패턴."""

from functools import lru_cache

from app.payments.base import PaymentClient
from app.payments.mock_client import MockPaymentClient


@lru_cache
def get_payment_client() -> PaymentClient:
    # TODO: 실 서비스 전 토스페이먼츠 등 실제 PG 어댑터로 교체.
    # Mock은 무조건 승인이므로 이 상태로 절대 운영 배포 금지.
    return MockPaymentClient()
