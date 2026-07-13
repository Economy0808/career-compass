import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import get_db
from app.main import app
from app.models.roadmap import Follow, Roadmap, User


async def _get_session():
    async for session in get_db():
        return session


@pytest.fixture
async def two_users():
    session = await _get_session()
    alice = User(display_name="팔로우테스트앨리스", avatar_emoji="🐱")
    bob = User(display_name="팔로우테스트밥", avatar_emoji="🐶")
    session.add_all([alice, bob])
    await session.commit()
    await session.refresh(alice)
    await session.refresh(bob)

    yield alice, bob

    ids = [alice.id, bob.id]
    follows = (
        await session.scalars(
            select(Follow).where(
                Follow.follower_id.in_(ids) | Follow.followee_id.in_(ids)
            )
        )
    ).all()
    for f in follows:
        await session.delete(f)
    roadmaps = (await session.scalars(select(Roadmap).where(Roadmap.user_id.in_(ids)))).all()
    for r in roadmaps:
        await session.delete(r)
    await session.delete(alice)
    await session.delete(bob)
    await session.commit()


@pytest.mark.asyncio
async def test_follow_unfollow_idempotent(two_users) -> None:
    alice, bob = two_users
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(f"/api/users/{bob.id}/follow", json={"follower_id": alice.id})
        assert resp.status_code == 204
        resp = await client.post(f"/api/users/{bob.id}/follow", json={"follower_id": alice.id})
        assert resp.status_code == 204

        resp = await client.request(
            "DELETE", f"/api/users/{bob.id}/follow", json={"follower_id": alice.id}
        )
        assert resp.status_code == 204
        resp = await client.request(
            "DELETE", f"/api/users/{bob.id}/follow", json={"follower_id": alice.id}
        )
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_follow_self_returns_400(two_users) -> None:
    alice, _ = two_users
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(f"/api/users/{alice.id}/follow", json={"follower_id": alice.id})
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_follow_unknown_user_returns_404(two_users) -> None:
    alice, _ = two_users
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/users/9999999/follow", json={"follower_id": alice.id})
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_feed_following_scope_filters_and_marks_is_following(two_users) -> None:
    alice, bob = two_users
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/roadmap/generate",
            json={"user_id": bob.id, "goal_raw_text": "팔로우테스트 목표가 되고 싶어", "messages": []},
        )
        assert resp.status_code == 201
        roadmap_id = resp.json()["id"]

        resp = await client.get(f"/api/roadmap/feed?scope=following&viewer_id={alice.id}")
        assert resp.status_code == 200
        assert resp.json() == []

        resp = await client.get(f"/api/roadmap/feed?viewer_id={alice.id}")
        card = next(c for c in resp.json() if c["id"] == roadmap_id)
        assert card["is_following"] is False

        resp = await client.post(f"/api/users/{bob.id}/follow", json={"follower_id": alice.id})
        assert resp.status_code == 204

        resp = await client.get(f"/api/roadmap/feed?scope=following&viewer_id={alice.id}")
        assert any(c["id"] == roadmap_id for c in resp.json())

        resp = await client.get(f"/api/roadmap/{roadmap_id}?viewer_id={alice.id}")
        assert resp.json()["is_following"] is True


@pytest.mark.asyncio
async def test_feed_following_scope_requires_viewer_id() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/roadmap/feed?scope=following")
        assert resp.status_code == 400
