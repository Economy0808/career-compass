"""/api/community API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_posts_api.py/test_profiles_api.py와 동일한 이유로 Mock을 쓰지 않고, 인증은
app.dependency_overrides로 대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(작업 지시 - 공유 에뮬레이터에는
사용자 라이브 데이터가 있고 conftest의 autouse 픽스처가 매 테스트 후 에뮬레이터
전체를 삭제하므로, 이 세션에서 pytest를 돌리면 그 데이터가 전멸한다). 격리된
에뮬레이터에서의 일괄 실행은 별도로 진행한다.

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 격리 에뮬레이터에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_community_api.py -q"
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


def _set_display_name(uid: str, display_name: str) -> None:
    """실명 공개 테스트용 - 리포지토리를 거치지 않고 프로필 문서를 직접 세팅한다."""
    get_firestore_client().collection("users").document(uid).set({"display_name": display_name})


# --- GET /api/community/boards ---


@pytest.mark.asyncio
async def test_list_boards_returns_six_with_secret_forced_anonymous() -> None:
    async with _client() as client:
        resp = await client.get("/api/community/boards")
    assert resp.status_code == 200
    boards = resp.json()
    assert {b["id"] for b in boards} == {"free", "secret", "question", "info", "career", "promo"}
    secret = next(b for b in boards if b["id"] == "secret")
    assert secret["forcedAnonymous"] is True
    free = next(b for b in boards if b["id"] == "free")
    assert free["forcedAnonymous"] is False


# --- 게시판 유효성 ---


@pytest.mark.asyncio
async def test_unknown_board_id_returns_404_for_list_and_create(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        list_resp = await client.get("/api/community/boards/no-such-board/posts")
        create_resp = await client.post(
            "/api/community/boards/no-such-board/posts",
            json={"title": "제목", "body": "내용"},
        )
    assert list_resp.status_code == 404
    assert create_resp.status_code == 404


# --- 익명 기본값 직렬화 ---


@pytest.mark.asyncio
async def test_default_anonymous_post_hides_author_but_marks_is_mine(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/community/boards/free/posts",
            json={"title": "익명 글", "body": "내용입니다"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["isAnonymous"] is True
    assert "authorUid" not in data
    assert "authorDisplayName" not in data
    assert data["isMine"] is True
    assert data["likeCount"] == 0
    assert data["commentCount"] == 0


@pytest.mark.asyncio
async def test_anonymous_post_hides_author_from_other_viewer(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/community/boards/free/posts",
            json={"title": "익명 글", "body": "내용입니다"},
        )
    post_id = create_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        detail_resp = await client.get(f"/api/community/posts/{post_id}")
    assert detail_resp.status_code == 200
    post = detail_resp.json()["post"]
    assert "authorUid" not in post
    assert "authorDisplayName" not in post
    assert post["isMine"] is False


# --- 실명 공개 ---


@pytest.mark.asyncio
async def test_real_name_post_exposes_author_and_display_name(
    authed_as: Callable[[str], None],
) -> None:
    _set_display_name("user-a", "홍길동")
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/community/boards/free/posts",
            json={"isAnonymous": False, "title": "실명 글", "body": "내용입니다"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["isAnonymous"] is False
    assert data["authorUid"] == "user-a"
    assert data["authorDisplayName"] == "홍길동"


# --- secret 게시판 강제 익명 ---


@pytest.mark.asyncio
async def test_secret_board_forces_anonymous_even_if_requested_false(
    authed_as: Callable[[str], None],
) -> None:
    _set_display_name("user-a", "홍길동")
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/community/boards/secret/posts",
            json={"isAnonymous": False, "title": "비밀 글", "body": "내용입니다"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["isAnonymous"] is True
    assert "authorUid" not in data
    assert "authorDisplayName" not in data


@pytest.mark.asyncio
async def test_comment_on_secret_board_post_forces_anonymous(
    authed_as: Callable[[str], None],
) -> None:
    _set_display_name("user-a", "홍길동")
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/secret/posts",
            json={"title": "비밀 글", "body": "내용입니다"},
        )
        post_id = post_resp.json()["id"]

        comment_resp = await client.post(
            f"/api/community/posts/{post_id}/comments",
            json={"isAnonymous": False, "body": "댓글입니다"},
        )
    assert comment_resp.status_code == 201
    comment = comment_resp.json()
    assert comment["isAnonymous"] is True
    assert "authorUid" not in comment
    assert "authorDisplayName" not in comment


# --- 댓글 카운트 ---


@pytest.mark.asyncio
async def test_comment_create_and_delete_updates_comment_count(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/free/posts", json={"title": "글", "body": "내용"}
        )
        post_id = post_resp.json()["id"]

        comment_resp = await client.post(
            f"/api/community/posts/{post_id}/comments", json={"body": "댓글"}
        )
        comment_id = comment_resp.json()["id"]

        detail_after_create = await client.get(f"/api/community/posts/{post_id}")
        assert detail_after_create.json()["post"]["commentCount"] == 1
        assert len(detail_after_create.json()["comments"]) == 1

        delete_resp = await client.delete(f"/api/community/posts/{post_id}/comments/{comment_id}")
        assert delete_resp.status_code == 204

        detail_after_delete = await client.get(f"/api/community/posts/{post_id}")
        assert detail_after_delete.json()["post"]["commentCount"] == 0
        assert detail_after_delete.json()["comments"] == []


@pytest.mark.asyncio
async def test_delete_comment_by_non_author_returns_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/free/posts", json={"title": "글", "body": "내용"}
        )
        post_id = post_resp.json()["id"]
        comment_resp = await client.post(
            f"/api/community/posts/{post_id}/comments", json={"body": "댓글"}
        )
        comment_id = comment_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        delete_resp = await client.delete(f"/api/community/posts/{post_id}/comments/{comment_id}")
    assert delete_resp.status_code == 403


# --- 좋아요 ---


@pytest.mark.asyncio
async def test_like_then_unlike_toggles_count_and_is_liked(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/free/posts", json={"title": "글", "body": "내용"}
        )
        post_id = post_resp.json()["id"]

        like_resp = await client.post(f"/api/community/posts/{post_id}/like")
        assert like_resp.status_code == 200
        assert like_resp.json()["likeCount"] == 1
        assert like_resp.json()["isLiked"] is True

        # 중복 좋아요는 no-op (카운트가 두 번 오르지 않는다).
        like_again_resp = await client.post(f"/api/community/posts/{post_id}/like")
        assert like_again_resp.json()["likeCount"] == 1

        list_resp = await client.get("/api/community/boards/free/posts")
        listed = next(p for p in list_resp.json() if p["id"] == post_id)
        assert listed["isLiked"] is True

        unlike_resp = await client.request("DELETE", f"/api/community/posts/{post_id}/like")
        assert unlike_resp.status_code == 200
        assert unlike_resp.json()["likeCount"] == 0
        assert unlike_resp.json()["isLiked"] is False


# --- 게시글 삭제 권한 ---


@pytest.mark.asyncio
async def test_delete_post_by_non_author_returns_403(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/free/posts", json={"title": "글", "body": "내용"}
        )
        post_id = post_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        delete_resp = await client.delete(f"/api/community/posts/{post_id}")
    assert delete_resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_own_post_then_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post(
            "/api/community/boards/free/posts", json={"title": "글", "body": "내용"}
        )
        post_id = post_resp.json()["id"]

        delete_resp = await client.delete(f"/api/community/posts/{post_id}")
        assert delete_resp.status_code == 204

        get_resp = await client.get(f"/api/community/posts/{post_id}")
        assert get_resp.status_code == 404
