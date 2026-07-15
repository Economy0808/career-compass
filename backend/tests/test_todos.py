import pytest
from httpx import ASGITransport, AsyncClient

from app.db import get_session_factory
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade

TODAY = "2026-07-15"


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def todo_user():
    session = await _get_session()
    user = await create_user(session, display_name="투두유저", avatar_emoji="🗓️")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_first_visit_seeds_default_categories(todo_user) -> None:
    _, token = todo_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.get("/api/todos/day", params={"date": TODAY})
        assert resp.status_code == 200
        data = resp.json()
        assert [c["name"] for c in data["categories"]] == ["분류 1", "분류 2", "분류 3"]
        assert data["items"] == []

        # 두 번째 방문은 중복 생성하지 않는다
        resp = await client.get("/api/todos/day", params={"date": TODAY})
        assert len(resp.json()["categories"]) == 3


@pytest.mark.asyncio
async def test_category_crud_and_order(todo_user) -> None:
    _, token = todo_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        await client.get("/api/todos/day", params={"date": TODAY})  # seed

        resp = await client.post("/api/todos/categories", json={"name": "코딩", "color": "violet"})
        assert resp.status_code == 201
        cat = resp.json()
        assert cat["color"] == "violet"
        assert cat["order_index"] == 3  # 기본 3개 뒤

        resp = await client.patch(
            f"/api/todos/categories/{cat['id']}", json={"name": "알고리즘", "color": "coral"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "알고리즘"
        assert resp.json()["color"] == "coral"

        # 잘못된 색은 거부
        resp = await client.post("/api/todos/categories", json={"name": "x", "color": "rainbow"})
        assert resp.status_code == 422

        resp = await client.delete(f"/api/todos/categories/{cat['id']}")
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_item_crud_and_toggle(todo_user) -> None:
    _, token = todo_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
        cat_id = day["categories"][0]["id"]

        resp = await client.post(
            "/api/todos/items",
            json={"category_id": cat_id, "due_date": TODAY, "content": "수학문제 10번까지 풀기"},
        )
        assert resp.status_code == 201
        item = resp.json()
        assert item["is_completed"] is False
        assert item["category_id"] == cat_id

        # 완료 토글 (양방향)
        resp = await client.patch(f"/api/todos/items/{item['id']}", json={"is_completed": True})
        assert resp.json()["is_completed"] is True
        resp = await client.patch(f"/api/todos/items/{item['id']}", json={"is_completed": False})
        assert resp.json()["is_completed"] is False

        # 내용 수정
        resp = await client.patch(
            f"/api/todos/items/{item['id']}", json={"content": "영어 단어 100개 외우기"}
        )
        assert resp.json()["content"] == "영어 단어 100개 외우기"

        # day 조회에 반영
        day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
        assert any(i["id"] == item["id"] for i in day["items"])

        resp = await client.delete(f"/api/todos/items/{item['id']}")
        assert resp.status_code == 204
        day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
        assert all(i["id"] != item["id"] for i in day["items"])


@pytest.mark.asyncio
async def test_items_are_per_date(todo_user) -> None:
    _, token = todo_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
        cat_id = day["categories"][0]["id"]
        await client.post(
            "/api/todos/items",
            json={"category_id": cat_id, "due_date": TODAY, "content": "오늘 할 일"},
        )
        # 다른 날짜에는 안 보인다
        other = (await client.get("/api/todos/day", params={"date": "2026-07-16"})).json()
        assert other["items"] == []
        # 분류는 날짜 공통
        assert len(other["categories"]) == 3


@pytest.mark.asyncio
async def test_calendar_aggregates_completed_and_total(todo_user) -> None:
    _, token = todo_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
        cat_id = day["categories"][0]["id"]

        ids = []
        for content in ("a", "b", "c"):
            r = await client.post(
                "/api/todos/items",
                json={"category_id": cat_id, "due_date": TODAY, "content": content},
            )
            ids.append(r.json()["id"])
        # 3개 중 2개 완료
        await client.patch(f"/api/todos/items/{ids[0]}", json={"is_completed": True})
        await client.patch(f"/api/todos/items/{ids[1]}", json={"is_completed": True})

        resp = await client.get("/api/todos/calendar", params={"year": 2026, "month": 7})
        assert resp.status_code == 200
        cell = next(c for c in resp.json() if c["date"] == TODAY)
        assert cell["total_count"] == 3
        assert cell["completed_count"] == 2


@pytest.mark.asyncio
async def test_todos_require_login() -> None:
    async with _client() as client:
        assert (await client.get("/api/todos/day", params={"date": TODAY})).status_code == 401
        assert (
            await client.post("/api/todos/categories", json={"name": "x", "color": "green"})
        ).status_code == 401


@pytest.mark.asyncio
async def test_cannot_touch_others_todos(todo_user) -> None:
    _, token = todo_user
    session = await _get_session()
    other = await create_user(session, display_name="타인", avatar_emoji="🥷")
    other_token = await create_session_token(session, other)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", token)
            day = (await client.get("/api/todos/day", params={"date": TODAY})).json()
            cat_id = day["categories"][0]["id"]
            item_id = (
                await client.post(
                    "/api/todos/items",
                    json={"category_id": cat_id, "due_date": TODAY, "content": "비밀"},
                )
            ).json()["id"]

        async with _client() as client:
            client.cookies.set("cc_session", other_token)
            # 남의 분류/아이템은 404
            assert (
                await client.patch(f"/api/todos/categories/{cat_id}", json={"name": "탈취"})
            ).status_code == 404
            assert (
                await client.patch(f"/api/todos/items/{item_id}", json={"is_completed": True})
            ).status_code == 404
            # 남의 분류에 아이템 추가 시도도 404
            assert (
                await client.post(
                    "/api/todos/items",
                    json={"category_id": cat_id, "due_date": TODAY, "content": "침입"},
                )
            ).status_code == 404
    finally:
        await delete_user_cascade(session, other.id)
