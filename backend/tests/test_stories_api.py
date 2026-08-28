"""스토리(Story) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_posts_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터 스킵 가드도
그 파일을 그대로 복사한 관례). 인증은 app.dependency_overrides로 대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(작업 지시 - 공유 에뮬레이터
데이터가 전멸하는 함정이 있어 이 세션에서는 pytest를 절대 돌리지 않는다).

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 검증 시):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_stories_api.py -q"
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore.client import get_firestore_client
from app.main import app

_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _emulator_available() -> bool:
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    """app이 모듈 전역 싱글턴이라, 테스트가 실패하든 성공하든 override는 항상 지운다."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다."""

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_story_doc(story_id: str, data: dict) -> None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 세팅한다(만료 필터 테스트 전용)."""
    get_firestore_client().collection("stories").document(story_id).set(data)


def _set_user_doc(uid: str, data: dict) -> None:
    get_firestore_client().collection("users").document(uid).set(data)


# --- POST /api/stories ---


@pytest.mark.asyncio
async def test_create_story_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_story_sets_24h_expiry(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
    assert resp.status_code == 201
    data = resp.json()
    assert data["ownerId"] == "user-a"
    assert data["expiresAt"] - data["createdAt"] == 24 * 60 * 60 * 1000


@pytest.mark.asyncio
async def test_create_story_invalid_image_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/stories", json={"imageData": "not-a-data-url"})
    assert resp.status_code == 422


# --- GET /api/stories/user/{uid} : 만료 필터 ---


@pytest.mark.asyncio
async def test_list_user_stories_excludes_expired_anonymous_allowed() -> None:
    # 만료 판정은 서버의 실제 시계 기준이므로 고정 상수를 쓰면 안 된다 -
    # 미래 시각을 "현재"로 둔 초판은 만료 문서가 아직 안 만료된 걸로 읽혔다(실측).
    now = int(time.time() * 1000)
    _set_story_doc(
        "expired-1",
        {
            "id": "expired-1",
            "owner_id": "user-a",
            "image_data": _TINY_PNG_DATA_URL,
            "created_at": now - 100_000,
            "expires_at": now - 1,  # 이미 만료
        },
    )
    _set_story_doc(
        "active-1",
        {
            "id": "active-1",
            "owner_id": "user-a",
            "image_data": _TINY_PNG_DATA_URL,
            "created_at": now - 100_000,
            "expires_at": now + 1_000_000_000,  # 충분히 미래
        },
    )
    async with _client() as client:
        resp = await client.get("/api/stories/user/user-a")
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert "active-1" in ids
    assert "expired-1" not in ids


@pytest.mark.asyncio
async def test_list_user_stories_orders_oldest_first(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        first = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
        second = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})

        list_resp = await client.get("/api/stories/user/user-a")
    ids = [s["id"] for s in list_resp.json()]
    assert ids.index(first.json()["id"]) < ids.index(second.json()["id"])


# --- GET /api/stories/ring ---


@pytest.mark.asyncio
async def test_ring_requires_auth() -> None:
    async with _client() as client:
        resp = await client.get("/api/stories/ring")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_ring_includes_self_and_followed_with_active_story(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {"display_name": "비", "avatar_emoji": "🎈"})

    authed_as("user-b")
    async with _client() as client:
        await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})

    authed_as("user-a")
    async with _client() as client:
        await client.post("/api/profiles/user-b/follow")
        ring_resp = await client.get("/api/stories/ring")

    assert ring_resp.status_code == 200
    ring = {item["uid"]: item for item in ring_resp.json()}
    assert "user-a" not in ring  # 본인은 스토리를 안 올렸으니 링에 없음
    assert "user-b" in ring
    assert ring["user-b"]["displayName"] == "비"
    assert ring["user-b"]["hasUnseen"] is True


@pytest.mark.asyncio
async def test_ring_marks_seen_after_view(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})

    authed_as("user-b")
    async with _client() as client:
        create_resp = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
    story_id = create_resp.json()["id"]

    authed_as("user-a")
    async with _client() as client:
        await client.post("/api/profiles/user-b/follow")
        await client.post(f"/api/stories/{story_id}/view")
        ring_resp = await client.get("/api/stories/ring")

    ring = {item["uid"]: item for item in ring_resp.json()}
    assert ring["user-b"]["hasUnseen"] is False


@pytest.mark.asyncio
async def test_view_story_anonymous_is_noop_200(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
    story_id = create_resp.json()["id"]

    async with _client() as client:
        resp = await client.post(f"/api/stories/{story_id}/view")
    assert resp.status_code == 200


# --- DELETE /api/stories/{story_id} ---


@pytest.mark.asyncio
async def test_delete_story_owner_ok_other_user_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post("/api/stories", json={"imageData": _TINY_PNG_DATA_URL})
    story_id = create_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        forbidden_resp = await client.delete(f"/api/stories/{story_id}")
    assert forbidden_resp.status_code == 403

    authed_as("user-a")
    async with _client() as client:
        ok_resp = await client.delete(f"/api/stories/{story_id}")
    assert ok_resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_unknown_story_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.delete("/api/stories/no-such-story")
    assert resp.status_code == 404
