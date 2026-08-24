"""이메일 발송 팩토리 분기와 Resend 어댑터 테스트.

핵심 회귀 방어: .env / .env.example이 싣고 있는 "re_..." 플레이스홀더가
실제 발송을 켜면 안 된다 (첫 가입이 401로 죽는다).
"""

import httpx
import pytest

from app.config import Settings
from app.email import get_email_sender
from app.email.base import EmailSendError
from app.email.mock_sender import MockEmailSender
from app.email.resend_sender import ResendEmailSender

REAL_KEY = "re_" + "a" * 30


def _settings(**over) -> Settings:
    base = {"resend_api_key": "", "app_env": "development"}
    return Settings(**{**base, **over})


# --- use_real_email 판별 ---------------------------------------------------


@pytest.mark.parametrize(
    "key,app_env,expected",
    [
        (REAL_KEY, "production", True),
        (REAL_KEY, "development", True),
        (REAL_KEY, "test", False),  # 테스트는 절대 실제 발송 안 함
        ("re_...", "production", False),  # .env가 싣고 있는 플레이스홀더
        ("", "production", False),  # 키 없음
        ("re_short", "production", False),  # 너무 짧음
        ("sk-ant-" + "a" * 30, "production", False),  # 다른 서비스 키
        (f"  {REAL_KEY}  ", "production", True),  # 공백 허용
    ],
)
def test_use_real_email(key: str, app_env: str, expected: bool) -> None:
    assert _settings(resend_api_key=key, app_env=app_env).use_real_email is expected


# --- 팩토리 분기 -----------------------------------------------------------


def test_factory_returns_mock_without_real_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.email.get_settings", lambda: _settings(resend_api_key="re_..."))
    get_email_sender.cache_clear()
    assert isinstance(get_email_sender(), MockEmailSender)
    get_email_sender.cache_clear()


def test_factory_returns_resend_with_real_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.email.get_settings",
        lambda: _settings(resend_api_key=REAL_KEY, app_env="production"),
    )
    get_email_sender.cache_clear()
    assert isinstance(get_email_sender(), ResendEmailSender)
    get_email_sender.cache_clear()


# --- Resend 어댑터 --------------------------------------------------------


def _sender(handler, **over) -> ResendEmailSender:
    st = _settings(resend_api_key=REAL_KEY, app_env="production", **over)
    return ResendEmailSender(
        settings=st, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


async def test_send_posts_expected_payload() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["json"] = __import__("json").loads(request.content)
        return httpx.Response(200, json={"id": "abc-123"})

    await _sender(handler).send(to="a@yonsei.ac.kr", subject="제목", body="인증 코드: 123456")

    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["auth"] == f"Bearer {REAL_KEY}"
    assert seen["json"]["to"] == ["a@yonsei.ac.kr"]
    assert seen["json"]["subject"] == "제목"
    assert seen["json"]["text"] == "인증 코드: 123456"
    assert "@" in seen["json"]["from"]


async def test_send_raises_on_auth_failure() -> None:
    """401은 재시도해도 소용없다 — 즉시 실패."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(401, json={"message": "API key is invalid"})

    with pytest.raises(EmailSendError):
        await _sender(handler).send(to="a@b.com", subject="s", body="b")
    assert len(calls) == 1, "4xx는 재시도하지 않는다"


async def test_send_retries_once_on_server_error() -> None:
    """5xx는 일시적일 수 있으니 한 번 재시도하고, 성공하면 통과."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, json={"message": "temporarily unavailable"})
        return httpx.Response(200, json={"id": "ok"})

    await _sender(handler).send(to="a@b.com", subject="s", body="b")
    assert len(calls) == 2


async def test_send_raises_after_retry_exhausted() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={"message": "boom"})

    with pytest.raises(EmailSendError):
        await _sender(handler).send(to="a@b.com", subject="s", body="b")
    assert len(calls) == 2


async def test_send_raises_on_connection_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    with pytest.raises(EmailSendError):
        await _sender(handler).send(to="a@b.com", subject="s", body="b")


async def test_send_does_not_log_verification_code(caplog: pytest.LogCaptureFixture) -> None:
    """PIPA: 인증 코드는 로그에 남기지 않는다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "ok"})

    with caplog.at_level("DEBUG"):
        await _sender(handler).send(to="a@b.com", subject="s", body="인증 코드: 987654")
    assert "987654" not in caplog.text
