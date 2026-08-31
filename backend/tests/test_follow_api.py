import pytest
from httpx import ASGITransport, AsyncClient

from app.db import get_session_factory
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade



# 이 파일이 검증하는 라우터(app/api/auth.py, app/api/users.py)는 2026-08-31
# Postgres 제거 배포에서 **등록만 해제**됐다(app/main.py 참고). 라우터 소스는
# 학생증 인증을 Firestore로 옮길 때 참조하려고 남겨뒀고, 이 테스트도 같은
# 이유로 남긴다 - 지우면 그때 되살릴 계약이 사라진다.
#
# 등록이 해제된 동안에는 모든 요청이 404라 단언이 전부 깨지므로 모듈째 스킵한다.
# Firestore로 재이관할 때 이 스킵을 제거하고 경로/의존성만 갱신하면 된다.
pytestmark = pytest.mark.skip(
    reason="auth/users 라우터 등록 해제(Postgres 제거). Firestore 이관 시 복구 예정."
)

async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def two_users():
    session = await _get_session()
    alice = await create_user(session, display_name="팔로우테스트앨리스", avatar_emoji="🐱")
    bob = await create_user(session, display_name="팔로우테스트밥", avatar_emoji="🐶")
    alice_token = await create_session_token(session, alice)
    yield alice, bob, alice_token
    await delete_user_cascade(session, alice.id)
    await delete_user_cascade(session, bob.id)


@pytest.mark.asyncio
async def test_follow_unfollow_idempotent(two_users) -> None:
    _, bob, alice_token = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        # 팔로워는 세션에서 결정된다 - body 없음
        resp = await client.post(f"/api/users/{bob.id}/follow")
        assert resp.status_code == 204
        resp = await client.post(f"/api/users/{bob.id}/follow")
        assert resp.status_code == 204

        resp = await client.delete(f"/api/users/{bob.id}/follow")
        assert resp.status_code == 204
        resp = await client.delete(f"/api/users/{bob.id}/follow")
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_cannot_follow_self(two_users) -> None:
    alice, _, alice_token = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        resp = await client.post(f"/api/users/{alice.id}/follow")
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_follow_requires_auth(two_users) -> None:
    _, bob, _ = two_users
    async with _client() as client:
        resp = await client.post(f"/api/users/{bob.id}/follow")
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_follow_requires_yonsei_verification(two_users) -> None:
    _, bob, _ = two_users
    session = await _get_session()
    unverified = await create_user(session, yonsei_verified=False)
    token = await create_session_token(session, unverified)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", token)
            resp = await client.post(f"/api/users/{bob.id}/follow")
            assert resp.status_code == 403
    finally:
        await delete_user_cascade(session, unverified.id)
