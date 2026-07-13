import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import get_db
from app.main import app
from app.models.roadmap import Roadmap, User


async def _get_session():
    async for session in get_db():
        return session


@pytest.fixture
async def test_user():
    session = await _get_session()
    user = User(display_name="API테스트유저", avatar_emoji="🐸")
    session.add(user)
    await session.commit()
    await session.refresh(user)

    yield user

    roadmaps = (await session.scalars(select(Roadmap).where(Roadmap.user_id == user.id))).all()
    for roadmap in roadmaps:
        await session.delete(roadmap)
    await session.delete(user)
    await session.commit()


@pytest.mark.asyncio
async def test_full_roadmap_flow(test_user: User) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/users")
        assert resp.status_code == 200
        assert any(u["id"] == test_user.id for u in resp.json())

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

        resp = await client.post(
            "/api/roadmap/generate",
            json={"user_id": test_user.id, "goal_raw_text": goal, "messages": messages},
        )
        assert resp.status_code == 201
        roadmap = resp.json()
        assert roadmap["title"] == "데이터 분석가 로드맵"
        assert len(roadmap["milestones"]) == 5
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
        assert patch_data["roadmap_progress_pct"] == 20.0

        resp = await client.get(f"/api/roadmap/{roadmap_id}")
        assert resp.json()["progress_pct"] == 20.0


@pytest.mark.asyncio
async def test_generate_with_unknown_user_returns_404() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/roadmap/generate",
            json={"user_id": 9_999_999, "goal_raw_text": "목표", "messages": []},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_unknown_roadmap_returns_404() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/roadmap/9999999")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_unknown_milestone_returns_404() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.patch(
            "/api/roadmap/milestones/9999999", json={"is_completed": True}
        )
        assert resp.status_code == 404
