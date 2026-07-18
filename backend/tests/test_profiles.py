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
    return (await plant_roadmap(client, goal))[0]


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
async def test_goal_cards_and_featured_toggle(two_users) -> None:
    """숲에는 대목표 관망 카드가 뜨고, 노출 토글은 대목표 단위다."""
    alice, _, alice_token, _ = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        first = await _plant(client, "첫번째 콩나무 목표")
        second = await _plant(client, "두번째 콩나무 목표")

        # 프로필 카드에서 대목표 id를 얻는다
        resp = await client.get(f"/api/users/{alice.id}/roadmaps")
        assert resp.status_code == 200
        goal_ids = {c["major_goal_title"]: c["major_goal_id"] for c in resp.json()}
        first_goal_id = goal_ids["첫번째 콩나무 목표 되기"]
        second_goal_id = goal_ids["두번째 콩나무 목표 되기"]

        # 기본: 숲에 대목표 관망 카드 2개, 소분류 로드맵은 직접 뜨지 않는다
        resp = await client.get("/api/roadmap/feed", params={"limit": 100})
        feed = resp.json()
        goal_cards = {c["id"]: c for c in feed if c["kind"] == "goal"}
        assert first_goal_id in goal_cards and second_goal_id in goal_cards
        assert goal_cards[first_goal_id]["milestone_count"] == 2  # 소분류 로드맵 수
        assert goal_cards[first_goal_id]["completed_count"] == 0
        legacy_ids = {c["id"] for c in feed if c["kind"] == "roadmap"}
        assert first["id"] not in legacy_ids

        # 대목표를 메인에서 내리면 그 관망 카드가 숲에서 사라진다
        resp = await client.patch(f"/api/goals/{first_goal_id}", json={"is_featured": False})
        assert resp.status_code == 200
        assert resp.json()["is_featured"] is False

        resp = await client.get("/api/roadmap/feed", params={"limit": 100})
        feed_goal_ids = {c["id"] for c in resp.json() if c["kind"] == "goal"}
        assert first_goal_id not in feed_goal_ids and second_goal_id in feed_goal_ids

        # 프로필의 콩나무 목록에는 전부 남는다 + 대목표 노출 플래그 반영
        resp = await client.get(f"/api/users/{alice.id}/roadmaps")
        cards = resp.json()
        assert {first["id"], second["id"]} <= {c["id"] for c in cards}
        flags = {c["major_goal_id"]: c["major_goal_featured"] for c in cards}
        assert flags[first_goal_id] is False
        assert flags[second_goal_id] is True


@pytest.mark.asyncio
async def test_featured_toggle_requires_ownership(two_users) -> None:
    alice, _, alice_token, bob_token = two_users
    async with _client() as client:
        client.cookies.set("cc_session", alice_token)
        roadmap = await _plant(client, "소유권 테스트")
        resp = await client.get(f"/api/users/{alice.id}/roadmaps")
        goal_id = resp.json()[0]["major_goal_id"]
    async with _client() as client:
        client.cookies.set("cc_session", bob_token)
        # 대목표 토글도, (레거시용) 로드맵 토글도 타인 것은 403
        resp = await client.patch(f"/api/goals/{goal_id}", json={"is_featured": False})
        assert resp.status_code == 403
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
        # mock 세트는 씨앗 한 번에 로드맵 2개(기초+실전)를 심는다
        assert profile["roadmap_count"] == 2
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
