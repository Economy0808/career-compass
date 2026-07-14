"""개발용 Mock 이메일 발송자: 실제 발송 대신 로그에 남긴다."""
import logging

logger = logging.getLogger("app.email")


class MockEmailSender:
    """발송 내역을 로그로 남기고 outbox에 쌓는다 (테스트에서 코드 확인용)."""

    outbox: list[dict[str, str]] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        MockEmailSender.outbox.append({"to": to, "subject": subject, "body": body})
        logger.info("[MOCK EMAIL] to=%s subject=%s body=%s", to, subject, body)
        # dev 서버 콘솔에서 인증 코드를 바로 볼 수 있게 print도 남긴다.
        print(f"[MOCK EMAIL] to={to} | {subject} | {body}", flush=True)
