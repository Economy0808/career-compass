"""이메일 발송 인터페이스."""
from typing import Protocol


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None:
        """이메일 한 통을 발송한다."""
        ...
