"""실제 이메일 발송 (Resend HTTP API).

Resend 공식 SDK 대신 httpx를 직접 쓴다 — httpx는 이미 런타임 의존성이고
(fastapi[standard]가 끌고 온다), 쓰는 엔드포인트가 POST 하나뿐이라 의존성을
새로 추가할 이유가 없다.

컴플라이언스(PIPA): 본문에는 인증 코드가 들어가므로 어떤 레벨에서도 본문을
로그에 남기지 않는다. 실패 로그에는 수신 주소와 상태 코드만 남긴다.
"""

import logging

import httpx

from app.config import Settings, get_settings
from app.email.base import EmailSendError

logger = logging.getLogger("app.email")

API_URL = "https://api.resend.com/emails"
_MAX_ATTEMPTS = 2  # 최초 1회 + 일시적 실패 시 재시도 1회


class ResendEmailSender:
    """Resend로 메일 한 통을 보낸다."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        # 주입된 클라이언트는 호출측 소유 — 여기서 닫지 않는다 (테스트용).
        # 없으면 send() 때마다 만들고 닫는다: 메일은 가입·재설정 시에만
        # 드물게 나가므로 커넥션 재사용 이득보다 이벤트 루프 수명에
        # 얽히지 않는 단순함이 낫다 (get_db()의 지연 생성과 같은 이유).
        self._client = client

    async def send(self, to: str, subject: str, body: str) -> None:
        payload = {
            "from": self._settings.email_from,
            "to": [to],
            "subject": subject,
            "text": body,
        }
        headers = {
            "Authorization": f"Bearer {self._settings.resend_api_key.strip()}",
            "Content-Type": "application/json",
        }

        last_error: str = "unknown"
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = await self._post(payload, headers)
            except httpx.HTTPError as exc:
                # 연결 실패·타임아웃은 일시적일 수 있다.
                last_error = f"{type(exc).__name__}: {exc}"
                logger.warning(
                    "이메일 발송 연결 실패 (attempt %d/%d) to=%s: %s",
                    attempt,
                    _MAX_ATTEMPTS,
                    to,
                    last_error,
                )
            else:
                if response.status_code < 300:
                    logger.info("이메일 발송 성공 to=%s status=%d", to, response.status_code)
                    return
                last_error = f"HTTP {response.status_code} {self._reason(response)}"
                retryable = response.status_code >= 500 or response.status_code == 429
                logger.warning(
                    "이메일 발송 실패 (attempt %d/%d) to=%s: %s",
                    attempt,
                    _MAX_ATTEMPTS,
                    to,
                    last_error,
                )
                if not retryable:
                    # 401(키 오류)·422(발신 도메인 미검증) 등은 재시도해도 같다.
                    break

        raise EmailSendError(f"Resend 발송 실패 (to={to}): {last_error}")

    async def _post(self, payload: dict, headers: dict) -> httpx.Response:
        if self._client is not None:
            return await self._client.post(API_URL, json=payload, headers=headers)
        timeout = httpx.Timeout(self._settings.email_timeout_sec, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.post(API_URL, json=payload, headers=headers)

    @staticmethod
    def _reason(response: httpx.Response) -> str:
        """Resend가 준 오류 메시지만 뽑는다 (본문 전체를 로그에 붓지 않기 위해)."""
        try:
            data = response.json()
        except ValueError:
            return ""
        if isinstance(data, dict):
            return str(data.get("message") or data.get("name") or "")
        return ""
