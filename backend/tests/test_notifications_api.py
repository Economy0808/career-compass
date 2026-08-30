"""알림함(Notification) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_posts_api.py/test_explore_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터
스킵 가드도 그 파일들을 그대로 복사한 관례). 인증은 app.dependency_overrides로
대체한다.

실행 방법 (backend/ 에서):
    .venv/Scripts/python.exe -m pytest tests/test_notifications_api.py -q
(conftest.py가 FIRESTORE_PROJECT_ID를 demo-ourlab-test로 강제하므로 실데이터에는
영향이 없다.)
"""

from __future__ import annotations

import os
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
    """FIRESTORE_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
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
        "firebase emulators:exec --only firestore --project demo-ourlab-test 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    """app이 모듈 전역 싱글턴이라, 테스트가 실패하든 성공하든 override는 항상 지운다."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다.

    yonsei_verified=True가 기본이다 - 팔로우/좋아요/댓글 등 알림을 발생시키는 행동은
    전부 인증 게이트(require_yonsei_verified) 뒤에 있으므로, 기본값 False로 두면
    이 스위트가 알림 로직이 아니라 게이트에서 403으로 막힌다(다른 API 테스트 파일과
    동일한 관례). 미인증 케이스는 dependency_overrides를 직접 세팅해 검증한다.
    """

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_follow_creates_notification_for_followee(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("follower")
    async with _client() as client:
        resp = await client.post("/api/profiles/followee/follow")
        assert resp.status_code == 200

    authed_as("followee")
    async with _client() as client:
        list_resp = await client.get("/api/notifications")
    assert list_resp.status_code == 200
    body = list_resp.json()
    assert body["unreadCount"] == 1
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["type"] == "follow"
    assert item["actorUid"] == "follower"
    assert "postId" not in item
    # follower의 프로필 문서를 세팅한 적 없으므로 actor 임베드 자체가 응답에서 빠진다.
    assert "actor" not in item


@pytest.mark.asyncio
async def test_like_creates_notification_for_post_owner(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("owner")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("liker")
    async with _client() as client:
        like_resp = await client.post(f"/api/posts/{post_id}/like")
        assert like_resp.status_code == 200

    authed_as("owner")
    async with _client() as client:
        list_resp = await client.get("/api/notifications")
    body = list_resp.json()
    assert body["unreadCount"] == 1
    item = body["items"][0]
    assert item["type"] == "like"
    assert item["actorUid"] == "liker"
    assert item["postId"] == post_id


@pytest.mark.asyncio
async def test_comment_creates_notification_for_post_owner(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("owner2")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("commenter")
    async with _client() as client:
        comment_resp = await client.post(f"/api/posts/{post_id}/comments", json={"body": "좋아요"})
        assert comment_resp.status_code == 201

    authed_as("owner2")
    async with _client() as client:
        list_resp = await client.get("/api/notifications")
    body = list_resp.json()
    assert body["unreadCount"] == 1
    item = body["items"][0]
    assert item["type"] == "comment"
    assert item["actorUid"] == "commenter"
    assert item["postId"] == post_id


@pytest.mark.asyncio
async def test_notification_embeds_actor_profile_and_dedupes_repeated_actor(
    authed_as: Callable[[str], None],
) -> None:
    """actor 프로필이 있으면 각 알림에 동봉되고, 같은 actor가 여러 알림을 만들어도
    (댓글 2개) 항목마다 정확한 프로필이 실린다(get_profiles 배치 조회의 중복 제거가
    결과를 깨뜨리지 않는지 확인)."""
    db = get_firestore_client()
    db.collection("users").document("repeat-commenter").set(
        {"display_name": "별빛댓글러", "avatar_emoji": "🌟"}
    )

    authed_as("owner3")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("repeat-commenter")
    async with _client() as client:
        assert (
            await client.post(f"/api/posts/{post_id}/comments", json={"body": "첫 댓글"})
        ).status_code == 201
        assert (
            await client.post(f"/api/posts/{post_id}/comments", json={"body": "두번째 댓글"})
        ).status_code == 201

    authed_as("owner3")
    async with _client() as client:
        list_resp = await client.get("/api/notifications")
    body = list_resp.json()
    assert body["unreadCount"] == 2
    assert len(body["items"]) == 2
    for item in body["items"]:
        assert item["actorUid"] == "repeat-commenter"
        assert item["actor"] == {"displayName": "별빛댓글러", "avatarEmoji": "🌟"}


@pytest.mark.asyncio
async def test_self_like_creates_no_notification(authed_as: Callable[[str], None]) -> None:
    authed_as("solo")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]
        like_resp = await client.post(f"/api/posts/{post_id}/like")
        assert like_resp.status_code == 200

        list_resp = await client.get("/api/notifications")
    body = list_resp.json()
    assert body["unreadCount"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_list_notifications_requires_auth() -> None:
    async with _client() as client:
        resp = await client.get("/api/notifications")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_read_all_marks_unread_count_zero(authed_as: Callable[[str], None]) -> None:
    authed_as("follower-a")
    async with _client() as client:
        assert (await client.post("/api/profiles/read-all-target/follow")).status_code == 200

    authed_as("follower-b")
    async with _client() as client:
        assert (await client.post("/api/profiles/read-all-target/follow")).status_code == 200

    authed_as("read-all-target")
    async with _client() as client:
        before_resp = await client.get("/api/notifications")
        assert before_resp.json()["unreadCount"] == 2

        read_all_resp = await client.post("/api/notifications/read-all")
        assert read_all_resp.status_code == 204

        after_resp = await client.get("/api/notifications")
    assert after_resp.json()["unreadCount"] == 0
    assert len(after_resp.json()["items"]) == 2


@pytest.mark.asyncio
async def test_notifications_are_newest_first(authed_as: Callable[[str], None]) -> None:
    """order-target이 먼저 follow 알림을, 나중에 like 알림을 받으면 목록은 like가 먼저 나와야 한다."""
    authed_as("early-actor")
    async with _client() as client:
        assert (await client.post("/api/profiles/order-target/follow")).status_code == 200

    authed_as("order-target")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("later-actor")
    async with _client() as client:
        assert (await client.post(f"/api/posts/{post_id}/like")).status_code == 200

    authed_as("order-target")
    async with _client() as client:
        list_resp = await client.get("/api/notifications")
    items = list_resp.json()["items"]
    assert [item["type"] for item in items] == ["like", "follow"]
