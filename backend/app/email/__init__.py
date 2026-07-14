"""이메일 발송 클라이언트 팩토리. app/llm/ 과 같은 Mock/실제 분리 패턴."""
from functools import lru_cache

from app.email.base import EmailSender
from app.email.mock_sender import MockEmailSender


@lru_cache
def get_email_sender() -> EmailSender:
    # TODO: app_env에 따라 Resend 어댑터로 교체 (RESEND_API_KEY는 env로만).
    return MockEmailSender()
