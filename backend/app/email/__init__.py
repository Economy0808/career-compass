"""이메일 발송 클라이언트 팩토리. app/llm/ 과 같은 Mock/실제 분리 패턴."""

from functools import lru_cache

from app.config import get_settings
from app.email.base import EmailSender
from app.email.mock_sender import MockEmailSender


@lru_cache
def get_email_sender() -> EmailSender:
    """이메일 발송 factory.

    RESEND_API_KEY가 그럴듯한 실제 키이고 test 환경이 아니면 Resend 연동을,
    아니면 콘솔에 코드를 찍는 Mock을 반환한다 (개발/테스트 $0). 다른 코드는
    EmailSender 인터페이스에만 의존한다.
    """
    settings = get_settings()
    if settings.use_real_email:
        # 지연 import: 키가 없으면 어댑터를 로드하지 않는다.
        from app.email.resend_sender import ResendEmailSender

        return ResendEmailSender()
    return MockEmailSender()
