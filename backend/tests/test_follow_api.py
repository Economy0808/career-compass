import pytest
from httpx import ASGITransport, AsyncClient

from app.db import get_session_factory
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade


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
