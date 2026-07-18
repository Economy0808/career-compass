import pytest
from httpx import ASGITransport, AsyncClient

from app.db import get_session_factory
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade
from tests.roadmap_utils import plant_roadmap


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _plant(client: AsyncClient, goal: str) -> dict:
    return await plant_roadmap(client, goal)


@pytest.fixture
async def two_users():
    session = await _get_session()
    alice = await create_user(session, display_name="프로필앨리스", avatar_emoji="🌷")
    bob = await create_user(session, display_name="프로필밥", avatar_emoji="🌵")
    alice_token = await create_session_token(session, alice)
    bob_token = await create_session_token(session, bob)
    yield alice, bob, alice_token, bob_token
    await delete_user_cascade(session, alice.id)
    await delete_user_cascade(session, bob.id)


@pytest.mark.asyncio
async def test_multiple_beanstalks_and_featured_toggle(two_users) -> None:
    alice, _, alice_token, _ = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        first = await _plant(client, "첫번째 콩나무 목표")
        second = await _plant(client, "두번째 콩나무 목표")

        # 기본은 둘 다 숲(피드)에 노출
        resp = await client.get("/api/roadmap/feed", params={"limit": 100})
        feed_ids = {c["id"] for c in resp.json()}
        assert first["id"] in feed_ids and second["id"] in feed_ids

        # 하나를 메인에서 내리면 숲에서 사라진다
        resp = await client.patch(f"/api/roadmap/{first['id']}", json={"is_featured": False})
        assert resp.status_code == 200
        assert resp.json()["is_featured"] is False

        resp = await client.get("/api/roadmap/feed", params={"limit": 100})
        feed_ids = {c["id"] for c in resp.json()}
        assert first["id"] not in feed_ids and second["id"] in feed_ids

        # 프로필의 콩나무 목록에는 둘 다 남는다 (is_featured 플래그 포함)
        resp = await client.get(f"/api/users/{alice.id}/roadmaps")
        assert resp.status_code == 200
        cards = {c["id"]: c for c in resp.json()}
        assert cards[first["id"]]["is_featured"] is False
        assert cards[second["id"]]["is_featured"] is True


@pytest.mark.asyncio
async def test_featured_toggle_requires_ownership(two_users) -> None:
    _, _, alice_token, bob_token = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        roadmap = await _plant(client, "소유권 테스트")
    async with _client() as client:
        client.cookies.set("cc_session", bob_token)
        resp = await client.patch(f"/api/roadmap/{roadmap['id']}", json={"is_featured": False})
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_profile_counts_follow_and_bio(two_users) -> None:
    alice, bob, alice_token, bob_token = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        await _plant(client, "프로필 카운트용 목표")
        # bio 수정 (본인)
        resp = await client.patch("/api/users/me", json={"bio": "철학과 1학년, 방향 찾는 중 🌱"})
        assert resp.status_code == 200
        assert resp.json()["bio"] == "철학과 1학년, 방향 찾는 중 🌱"

    async with _client() as client:
        client.cookies.set("cc_session", bob_token)
        resp = await client.post(f"/api/users/{alice.id}/follow")
        assert resp.status_code == 204

        # bob이 보는 alice 프로필
        resp = await client.get(f"/api/users/{alice.id}")
        assert resp.status_code == 200
        profile = resp.json()
        assert profile["bio"] == "철학과 1학년, 방향 찾는 중 🌱"
        assert profile["roadmap_count"] == 1
        assert profile["follower_count"] == 1
        assert profile["following_count"] == 0
        assert profile["is_following"] is True
        assert profile["yonsei_verified"] is True

    # 비로그인 열람: is_following은 null
    async with _client() as client:
        resp = await client.get(f"/api/users/{alice.id}")
        assert resp.status_code == 200
        assert resp.json()["is_following"] is None


@pytest.mark.asyncio
async def test_bio_requires_login() -> None:
    async with _client() as client:
        resp = await client.patch("/api/users/me", json={"bio": "익명"})
        assert resp.status_code == 401
