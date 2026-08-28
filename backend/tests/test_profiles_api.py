"""/api/profiles API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_constellation_api.py와 동일한 이유로 Firebase Auth 에뮬레이터 대신
app.dependency_overrides로 인증을 대체한다(이 스위트가 검증하려는 대상은
리포지토리/라우터 로직이지 토큰 검증 자체가 아니다).

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_profiles_api.py -q"
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
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다.

    profiles.py는 엔드포인트별로 둘 중 하나만 쓰지만(GET은 optional, 나머지는
    필수), 로그인 상태를 흉내낼 땐 둘 다 같은 uid를 돌려줘야 자연스럽다.
    """

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_user_doc(uid: str, data: dict) -> None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 세팅한다 (테스트 셋업 전용)."""
    get_firestore_client().collection("users").document(uid).set(data)


# --- GET /api/profiles/{uid} ---


@pytest.mark.asyncio
async def test_get_unknown_uid_returns_404() -> None:
    async with _client() as client:
        resp = await client.get("/api/profiles/no-such-uid")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_profile_anonymous_omits_is_following() -> None:
    _set_user_doc("user-a", {"display_name": "에이", "avatar_emoji": "🚀", "bio": "안녕"})
    async with _client() as client:
        resp = await client.get("/api/profiles/user-a")
    assert resp.status_code == 200
    data = resp.json()
    assert data["uid"] == "user-a"
    assert data["displayName"] == "에이"
    assert data["avatarEmoji"] == "🚀"
    assert data["bio"] == "안녕"
    assert data["followerCount"] == 0
    assert data["followingCount"] == 0
    assert "isFollowing" not in data


@pytest.mark.asyncio
async def test_get_own_profile_omits_is_following(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/profiles/user-a")
    assert resp.status_code == 200
    assert "isFollowing" not in resp.json()


# --- PATCH /api/profiles/me ---


@pytest.mark.asyncio
async def test_patch_me_requires_auth() -> None:
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"bio": "hi"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_me_updates_bio(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.patch(
            "/api/profiles/me",
            json={"displayName": "새이름", "bio": "철학과 1학년입니다"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["displayName"] == "새이름"
    assert data["bio"] == "철학과 1학년입니다"

    async with _client() as client:
        again = await client.get("/api/profiles/user-a")
    assert again.json()["bio"] == "철학과 1학년입니다"


@pytest.mark.asyncio
async def test_patch_me_with_none_fields_leaves_them_unchanged(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_doc("user-a", {"display_name": "기존이름", "avatar_emoji": "🧭"})
    authed_as("user-a")
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"bio": "새 소개"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["displayName"] == "기존이름"
    assert data["avatarEmoji"] == "🧭"
    assert data["bio"] == "새 소개"


# --- 팔로우 / 언팔로우 ---


@pytest.mark.asyncio
async def test_follow_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/profiles/user-b/follow")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_follow_then_unfollow_updates_counts(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        follow_resp = await client.post("/api/profiles/user-b/follow")
        assert follow_resp.status_code == 200
        follow_data = follow_resp.json()
        assert follow_data["followerCount"] == 1
        assert follow_data["isFollowing"] is True

        me_resp = await client.get("/api/profiles/user-a")
        assert me_resp.json()["followingCount"] == 1

        unfollow_resp = await client.delete("/api/profiles/user-b/follow")
        assert unfollow_resp.status_code == 200
        unfollow_data = unfollow_resp.json()
        assert unfollow_data["followerCount"] == 0
        assert unfollow_data["isFollowing"] is False

        me_resp2 = await client.get("/api/profiles/user-a")
        assert me_resp2.json()["followingCount"] == 0


@pytest.mark.asyncio
async def test_duplicate_follow_is_noop(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        first = await client.post("/api/profiles/user-b/follow")
        second = await client.post("/api/profiles/user-b/follow")
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["followerCount"] == 1


@pytest.mark.asyncio
async def test_unfollow_without_following_is_noop(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        resp = await client.delete("/api/profiles/user-b/follow")
    assert resp.status_code == 200
    assert resp.json()["followerCount"] == 0


@pytest.mark.asyncio
async def test_self_follow_returns_400(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    authed_as("user-a")

    async with _client() as client:
        resp = await client.post("/api/profiles/user-a/follow")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_is_following_true_when_viewer_follows_target(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        await client.post("/api/profiles/user-b/follow")

    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/profiles/user-b")
    assert resp.json()["isFollowing"] is True
