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
async def verified_user():
    session = await _get_session()
    user = await create_user(session, display_name="API테스트유저", avatar_emoji="🐸")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


@pytest.fixture
async def other_verified_user():
    session = await _get_session()
    user = await create_user(session, display_name="다른유저", avatar_emoji="🦊")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_full_roadmap_flow(verified_user) -> None:
    _, token = verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)

        goal = "데이터 분석가가 되고 싶어"
        messages: list[dict] = []
        done = False
        question_count = 0
        while not done:
            resp = await client.post(
                "/api/roadmap/chat", json={"goal_raw_text": goal, "messages": messages}
            )
            assert resp.status_code == 200
            data = resp.json()
            done = data["done"]
            messages = data["messages"]
            if not done:
                question_count += 1
                assert data["question"] is not None
                messages.append({"role": "user", "content": "답변입니다"})
        assert question_count == 3

        # 작성자는 세션에서 결정된다 - body에 user_id 없음
        resp = await client.post(
            "/api/roadmap/generate", json={"goal_raw_text": goal, "messages": messages}
        )
        assert resp.status_code == 201
        roadmap = resp.json()
        assert roadmap["title"] == "데이터 분석가 로드맵"
        milestone_count = len(roadmap["milestones"])
        assert 5 <= milestone_count <= 8  # 최소 5개, 목표에 따라 가변
        assert roadmap["progress_pct"] == 0.0
        roadmap_id = roadmap["id"]

        resp = await client.get("/api/roadmap/feed")
        assert resp.status_code == 200
        assert any(card["id"] == roadmap_id for card in resp.json())

        resp = await client.get(f"/api/roadmap/{roadmap_id}")
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["progress_pct"] == 0.0
        milestone_id = detail["milestones"][0]["id"]

        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": True}
        )
        assert resp.status_code == 200
        patch_data = resp.json()
        assert patch_data["milestone"]["status"] == "완료"
        assert patch_data["roadmap_progress_pct"] == round(100 / milestone_count, 1)


@pytest.mark.asyncio
async def test_feed_and_detail_are_public() -> None:
    async with _client() as client:
        resp = await client.get("/api/roadmap/feed")
        assert resp.status_code == 200
        resp = await client.get("/api/roadmap/9999999")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_write_endpoints_require_auth() -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/roadmap/generate", json={"goal_raw_text": "목표", "messages": []}
        )
        assert resp.status_code == 401
        resp = await client.patch("/api/roadmap/milestones/1", json={"is_completed": True})
        assert resp.status_code == 401
        resp = await client.post(
            "/api/roadmap/chat", json={"goal_raw_text": "목표", "messages": []}
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_write_endpoints_require_yonsei_verification() -> None:
    session = await _get_session()
    user = await create_user(session, yonsei_verified=False)
    token = await create_session_token(session, user)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", token)
            resp = await client.post(
                "/api/roadmap/generate", json={"goal_raw_text": "목표", "messages": []}
            )
            assert resp.status_code == 403
    finally:
        await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_cannot_patch_others_milestone(verified_user, other_verified_user) -> None:
    _, owner_token = verified_user
    _, attacker_token = other_verified_user
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        resp = await client.post(
            "/api/roadmap/generate", json={"goal_raw_text": "내 목표", "messages": []}
        )
        assert resp.status_code == 201
        milestone_id = resp.json()["milestones"][0]["id"]

    async with _client() as client:
        client.cookies.set("cc_session", attacker_token)
        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": True}
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_patch_unknown_milestone_returns_404(verified_user) -> None:
    _, token = verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.patch(
            "/api/roadmap/milestones/9999999", json={"is_completed": True}
        )
        assert resp.status_code == 404
