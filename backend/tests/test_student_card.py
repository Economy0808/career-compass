from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.student_review import approve_card, list_pending, reject_card
from app.db import get_session_factory
from app.main import app
from app.models.account import StudentCardVerification
from app.models.roadmap import User
from tests.auth_utils import create_session_token, create_user, delete_user_cascade

# 1x1 PNG (매직 바이트 포함 유효 파일)
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63fcff9fa10e0002fe01fda9e70d0d0000000049454e44ae426082"
)


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def email_only_user():
    """이메일 인증까지만 끝난 유저 (연세 인증 전) + 세션 토큰."""
    session = await _get_session()
    user = await create_user(session, yonsei_verified=False)
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_upload_and_approve_flow(email_only_user) -> None:
    user, token = email_only_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.post(
            "/api/auth/student-card", files={"file": ("card.png", PNG_BYTES, "image/png")}
        )
        assert resp.status_code == 201

        resp = await client.get("/api/auth/student-card/status")
        assert resp.json()["detail"] == "pending"

    session = await _get_session()
    card = await session.scalar(
        select(StudentCardVerification).where(StudentCardVerification.user_id == user.id)
    )
    assert card is not None and card.image_path is not None
    image_path = Path(card.image_path)
    assert image_path.exists()

    pending = await list_pending(session)
    assert any(c.id == card.id for c in pending)

    await approve_card(session, card.id)

    # PIPA: 승인 즉시 이미지 파일 파기 + 경로 제거
    assert not image_path.exists()
    await session.refresh(card)
    assert card.image_path is None and card.status == "approved"
    refreshed = await session.get(User, user.id)
    assert refreshed is not None
    assert refreshed.yonsei_verified_at is not None
    assert refreshed.verification_method == "student_card"


@pytest.mark.asyncio
async def test_reject_deletes_image(email_only_user) -> None:
    user, token = email_only_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.post(
            "/api/auth/student-card", files={"file": ("card.png", PNG_BYTES, "image/png")}
        )
        assert resp.status_code == 201

    session = await _get_session()
    card = await session.scalar(
        select(StudentCardVerification).where(StudentCardVerification.user_id == user.id)
    )
    assert card is not None and card.image_path is not None
    image_path = Path(card.image_path)

    await reject_card(session, card.id, "학생증이 아닙니다")
    assert not image_path.exists()
    await session.refresh(card)
    assert card.status == "rejected" and card.image_path is None
    refreshed = await session.get(User, user.id)
    assert refreshed is not None and refreshed.yonsei_verified_at is None


@pytest.mark.asyncio
async def test_upload_rejects_non_image_bytes(email_only_user) -> None:
    _, token = email_only_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        # Content-Type은 이미지라고 주장하지만 실제 바이트는 아님 → 매직바이트 검사에서 거부
        resp = await client.post(
            "/api/auth/student-card",
            files={"file": ("fake.png", b"<script>alert(1)</script>", "image/png")},
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_rejects_oversize(email_only_user) -> None:
    _, token = email_only_user
    big = PNG_BYTES + b"\x00" * (5 * 1024 * 1024)
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.post(
            "/api/auth/student-card", files={"file": ("big.png", big, "image/png")}
        )
        assert resp.status_code == 413


@pytest.mark.asyncio
async def test_upload_requires_login() -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/auth/student-card", files={"file": ("card.png", PNG_BYTES, "image/png")}
        )
        assert resp.status_code == 401
