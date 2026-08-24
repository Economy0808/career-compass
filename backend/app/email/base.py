"""이메일 발송 인터페이스."""

from typing import Protocol


class EmailSendError(RuntimeError):
    """이메일 발송 실패. 호출측이 사용자에게 보일 오류로 변환한다.

    발송은 조용히 실패해서는 안 된다 — 인증 코드가 안 가면 가입이
    그 자리에서 막히므로, 삼키지 말고 반드시 위로 던진다.
    """


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None:
        """이메일 한 통을 발송한다. 실패 시 EmailSendError."""
        ...
