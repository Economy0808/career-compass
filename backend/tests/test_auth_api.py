import re

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import get_session_factory
from app.email.base import EmailSendError
from app.email.mock_sender import MockEmailSender
from app.main import app
from app.models.roadmap import User
from tests.auth_utils import (
    create_session_token,
    create_user,
    delete_user_cascade,
    unique_suffix,
)


async def _get_session():
    return get_session_factory()()


def _last_code() -> str:
    match = re.search(r"\d{6}", MockEmailSender.outbox[-1]["body"])
    assert match is not None
    return match.group()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def cleanup_emails():
    """테스트에서 만든 가입 유저를 이메일 패턴으로 정리한다."""
    created: list[str] = []
    yield created
    session = await _get_session()
    for email in created:
        user = await session.scalar(select(User).where(User.email == email))
        if user is not None:
            await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_signup_verify_login_flow_non_yonsei(cleanup_emails: list[str]) -> None:
    sfx = unique_suffix()
    email = f"{sfx}@gmail.com"
    cleanup_emails.append(email)
    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": email,
                "display_name": "가입테스트",
                "consent": True,
            },
        )
        assert resp.status_code == 201

        # 이메일 인증 전 로그인 불가
        resp = await client.post(
            "/api/auth/login", json={"username": f"u{sfx}", "password": "hunter2hunter2!"}
        )
        assert resp.status_code == 403

        resp = await client.post(
            "/api/auth/verify-email", json={"email": email, "code": _last_code()}
        )
        assert resp.status_code == 200

        resp = await client.post(
            "/api/auth/login", json={"username": f"u{sfx}", "password": "hunter2hunter2!"}
        )
        assert resp.status_code == 200
        me = resp.json()
        assert me["email_verified"] is True
        assert me["yonsei_verified"] is False  # 일반 메일은 연세 인증 아님
        assert "cc_session" in resp.cookies

        # 세션 쿠키로 /me 조회
        resp = await client.get("/api/auth/me")
        assert resp.status_code == 200

        # 로그아웃하면 세션이 폐기된다
        resp = await client.post("/api/auth/logout")
        assert resp.status_code == 204
        client.cookies.clear()
        resp = await client.get("/api/auth/me")
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_yonsei_email_signup_verifies_instantly(cleanup_emails: list[str]) -> None:
    sfx = unique_suffix()
    email = f"{sfx}@yonsei.ac.kr"
    cleanup_emails.append(email)
    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": email,
                "display_name": "연세메일",
                "consent": True,
            },
        )
        assert resp.status_code == 201
        resp = await client.post(
            "/api/auth/verify-email", json={"email": email, "code": _last_code()}
        )
        assert resp.status_code == 200

        resp = await client.post(
            "/api/auth/login", json={"username": f"u{sfx}", "password": "hunter2hunter2!"}
        )
        assert resp.status_code == 200
        me = resp.json()
        assert me["yonsei_verified"] is True
        assert me["verification_method"] == "school_email"


@pytest.mark.asyncio
async def test_school_email_verification_after_signup(cleanup_emails: list[str]) -> None:
    session = await _get_session()
    user = await create_user(session, yonsei_verified=False)
    cleanup_emails.append(user.email or "")
    token = await create_session_token(session, user)

    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.post(
            "/api/auth/school-email/request", json={"email": f"{unique_suffix()}@yonsei.ac.kr"}
        )
        assert resp.status_code == 200
        resp = await client.post("/api/auth/school-email/verify", json={"code": _last_code()})
        assert resp.status_code == 200

        resp = await client.get("/api/auth/me")
        assert resp.json()["yonsei_verified"] is True


@pytest.mark.asyncio
async def test_school_email_rejects_non_yonsei_domain(cleanup_emails: list[str]) -> None:
    session = await _get_session()
    user = await create_user(session, yonsei_verified=False)
    cleanup_emails.append(user.email or "")
    token = await create_session_token(session, user)
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.post(
            "/api/auth/school-email/request", json={"email": "someone@gmail.com"}
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_login_failure_is_generic(cleanup_emails: list[str]) -> None:
    session = await _get_session()
    user = await create_user(session)
    cleanup_emails.append(user.email or "")

    async with _client() as client:
        wrong_pw = await client.post(
            "/api/auth/login", json={"username": user.username, "password": "wrong-password1"}
        )
        no_user = await client.post(
            "/api/auth/login", json={"username": "no_such_user00", "password": "wrong-password1"}
        )
        assert wrong_pw.status_code == no_user.status_code == 401
        assert wrong_pw.json()["detail"] == no_user.json()["detail"]


@pytest.mark.asyncio
async def test_signup_requires_consent() -> None:
    sfx = unique_suffix()
    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": f"{sfx}@gmail.com",
                "display_name": "동의안함",
                "consent": False,
            },
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_signup_duplicate_username(cleanup_emails: list[str]) -> None:
    session = await _get_session()
    user = await create_user(session)
    cleanup_emails.append(user.email or "")
    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": user.username,
                "password": "hunter2hunter2!",
                "email": f"{unique_suffix()}@gmail.com",
                "display_name": "중복",
                "consent": True,
            },
        )
        assert resp.status_code == 409


@pytest.mark.asyncio
async def test_signup_conflict_refunds_rate_limit_slot(cleanup_emails: list[str]) -> None:
    """회귀 테스트: 중복 409가 반복돼도 슬롯이 환불되어 뒤이은 정상 가입은 성공해야 한다.

    signup의 soft limit은 3 — 중복 아이디/이메일로 3번(=limit 전부) 연속 실패해도
    환불되면 4번째 정상 요청은 여전히 통과해야 한다. 환불이 없다면(버그 상태) 4번째
    요청은 429로 막혀, 오탈자 몇 번에 정상 재시도까지 잠기는 실사용 버그가 재현된다.
    """
    session = await _get_session()
    existing = await create_user(session)
    cleanup_emails.append(existing.email or "")

    sfx = unique_suffix()
    email = f"{sfx}@gmail.com"
    cleanup_emails.append(email)

    async with _client() as client:
        for _ in range(3):
            resp = await client.post(
                "/api/auth/signup",
                json={
                    "username": existing.username,
                    "password": "hunter2hunter2!",
                    "email": existing.email,
                    "display_name": "중복재시도",
                    "consent": True,
                },
            )
            assert resp.status_code == 409

        # soft limit(3)을 전부 중복 실패로 소진했지만, 환불되었으므로 다음 정상
        # 가입은 레이트리밋에 막히지 않고 성공해야 한다.
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": email,
                "display_name": "정상가입",
                "consent": True,
            },
        )
        assert resp.status_code == 201


@pytest.mark.asyncio
async def test_signup_hard_limit_blocks_unbounded_enumeration(cleanup_emails: list[str]) -> None:
    """soft limit이 환불돼도 hard limit(20)은 절대 환불되지 않아 총 시도 횟수를 막는다."""
    session = await _get_session()
    existing = await create_user(session)
    cleanup_emails.append(existing.email or "")

    async with _client() as client:
        statuses = []
        for _ in range(22):
            resp = await client.post(
                "/api/auth/signup",
                json={
                    "username": existing.username,
                    "password": "hunter2hunter2!",
                    "email": existing.email,
                    "display_name": "열거시도",
                    "consent": True,
                },
            )
            statuses.append(resp.status_code)
        assert statuses[:20] == [409] * 20
        assert statuses[20] == 429
        assert statuses[21] == 429  # 429가 유지되어야 함 (hard limit은 환불되지 않음)


@pytest.mark.asyncio
async def test_verify_email_attempts_exhausted(cleanup_emails: list[str]) -> None:
    sfx = unique_suffix()
    email = f"{sfx}@gmail.com"
    cleanup_emails.append(email)
    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": email,
                "display_name": "시도초과",
                "consent": True,
            },
        )
        assert resp.status_code == 201
        code = _last_code()
        wrong = "000000" if code != "000000" else "111111"
        # 시도 5회 소진 (verify-email 레이트리밋과 겹치지 않게 최대 5회)
        for _ in range(5):
            resp = await client.post("/api/auth/verify-email", json={"email": email, "code": wrong})
            assert resp.status_code == 400
        # 시도 초과 후에는 올바른 코드도 거부된다 (단, 레이트리밋에 먼저 걸리면 429)
        resp = await client.post("/api/auth/verify-email", json={"email": email, "code": code})
        assert resp.status_code in (400, 429)


@pytest.mark.asyncio
async def test_login_rate_limited() -> None:
    async with _client() as client:
        statuses = []
        for _ in range(6):
            resp = await client.post(
                "/api/auth/login", json={"username": "nobody0000", "password": "wrongwrong1"}
            )
            statuses.append(resp.status_code)
        assert statuses[:5] == [401] * 5
        assert statuses[5] == 429


async def test_signup_returns_502_when_email_send_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """발송 실패를 삼키면 코드 없는 계정이 남는다 — 502 + 롤백을 잠근다."""
    sfx = unique_suffix()
    email = f"{sfx}@gmail.com"

    class _FailingSender:
        async def send(self, to: str, subject: str, body: str) -> None:
            raise EmailSendError("resend unavailable")

    monkeypatch.setattr("app.api.auth.get_email_sender", lambda: _FailingSender())

    async with _client() as client:
        resp = await client.post(
            "/api/auth/signup",
            json={
                "username": f"u{sfx}",
                "password": "hunter2hunter2!",
                "email": email,
                "display_name": "발송실패",
                "consent": True,
            },
        )
    assert resp.status_code == 502

    # commit 앞에서 터졌으므로 계정이 남아 있으면 안 된다.
    session = await _get_session()
    try:
        assert await session.scalar(select(User).where(User.email == email)) is None
    finally:
        await session.close()
