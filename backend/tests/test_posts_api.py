"""프로필 사진 게시물(Post) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_constellation_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터 스킵
가드도 그 파일을 그대로 복사한 관례). 인증은 app.dependency_overrides[get_current_user]로
대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(작업 지시 - 공유 에뮬레이터
데이터가 전멸하는 함정이 있어 이 세션에서는 pytest를 절대 돌리지 않는다).

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 검증 시):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_posts_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
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
    """주어진 uid로 인증 override를 세팅하는 함수를 돌려준다.

    필수 인증(get_current_user)만 잡으면 목록 GET처럼 optional 의존성을 쓰는
    엔드포인트에서 viewer가 None으로 남아 isMine이 항상 False가 된다 - 격리
    에뮬레이터 런에서 실측된 함정이라 둘 다 같은 uid로 잡는다.
    """

    def _set(uid: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: DecodedToken(uid=uid)
        app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(uid=uid)

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_create_then_list_then_owner_delete(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts",
            json={"imageData": _TINY_PNG_DATA_URL, "caption": "오늘의 한 컷"},
        )
        assert create_resp.status_code == 201
        created = create_resp.json()
        assert created["ownerId"] == "user-a"
        assert created["caption"] == "오늘의 한 컷"
        assert isinstance(created["id"], str) and created["id"]
        assert isinstance(created["createdAt"], int)
        assert created["isMine"] is True

        list_resp = await client.get("/api/posts/user/user-a")
        assert list_resp.status_code == 200
        posts = list_resp.json()
        assert any(p["id"] == created["id"] and p["isMine"] is True for p in posts)

        delete_resp = await client.delete(f"/api/posts/{created['id']}")
        assert delete_resp.status_code == 204

        list_after_resp = await client.get("/api/posts/user/user-a")
        assert all(p["id"] != created["id"] for p in list_after_resp.json())


def _anonymous() -> None:
    """authed_as가 잡은 두 override를 모두 걷어내 익명 요청을 흉내낸다."""
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)


@pytest.mark.asyncio
async def test_list_user_posts_requires_login_only(authed_as: Callable[[str], None]) -> None:
    """옵션1 확정: 게시물 열람은 로그인 여부만 본다 - 익명=401, 로그인만 하면 팔로우
    여부와 무관하게 200(팔로우는 피드 구성 기준일 뿐 차단 장치가 아니다)."""
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
    assert create_resp.json()["isMine"] is True

    _anonymous()
    async with _client() as client:
        anon_resp = await client.get("/api/posts/user/user-a")
    assert anon_resp.status_code == 401

    authed_as("user-b")
    async with _client() as client:
        other_resp = await client.get("/api/posts/user/user-a")
    assert other_resp.status_code == 200
    assert all(p["isMine"] is False for p in other_resp.json())

    authed_as("user-a")
    async with _client() as client:
        own_resp = await client.get("/api/posts/user/user-a")
    assert own_resp.status_code == 200
    assert any(p["isMine"] is True for p in own_resp.json())


@pytest.mark.asyncio
async def test_other_user_delete_returns_403(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        delete_resp = await client.delete(f"/api/posts/{post_id}")
        assert delete_resp.status_code == 403


@pytest.mark.asyncio
async def test_invalid_image_data_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/posts", json={"imageData": "not-a-data-url", "caption": ""})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# P1: 다중 사진
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_with_multiple_images_and_fetch_in_order(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    images = [_TINY_PNG_DATA_URL] * 3
    async with _client() as client:
        create_resp = await client.post("/api/posts", json={"images": images, "caption": "3장"})
        assert create_resp.status_code == 201
        created = create_resp.json()
        assert created["imageCount"] == 3
        # 부모 문서는 첫 장을 썸네일로 유지한다(역호환).
        assert created["imageData"] == _TINY_PNG_DATA_URL

        images_resp = await client.get(f"/api/posts/{created['id']}/images")
        assert images_resp.status_code == 200
        image_list = images_resp.json()
        assert [item["index"] for item in image_list] == [0, 1, 2]
        assert all(item["imageData"] == _TINY_PNG_DATA_URL for item in image_list)


@pytest.mark.asyncio
async def test_create_with_more_than_ten_images_returns_422(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/posts", json={"images": [_TINY_PNG_DATA_URL] * 11, "caption": ""}
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_legacy_single_image_post_has_image_count_one(
    authed_as: Callable[[str], None],
) -> None:
    """imageData 단일 필드(역호환 경로)로 만든 글은 imageCount=1이고 images 서브컬렉션이
    비어 있어도 GET .../images가 부모 썸네일 한 장으로 폴백한다."""
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        assert create_resp.status_code == 201
        created = create_resp.json()
        assert created["imageCount"] == 1

        images_resp = await client.get(f"/api/posts/{created['id']}/images")
        assert images_resp.json() == [{"index": 0, "imageData": _TINY_PNG_DATA_URL}]


@pytest.mark.asyncio
async def test_create_without_images_or_image_data_returns_422(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/posts", json={"caption": "사진 없음"})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# P2: 좋아요·댓글
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_like_then_duplicate_then_unlike(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        like_resp = await client.post(f"/api/posts/{post_id}/like")
        assert like_resp.status_code == 200
        assert like_resp.json()["likeCount"] == 1
        assert like_resp.json()["isLiked"] is True

        # 중복 좋아요는 no-op - 카운트가 늘지 않는다.
        dup_resp = await client.post(f"/api/posts/{post_id}/like")
        assert dup_resp.json()["likeCount"] == 1

        unlike_resp = await client.request("DELETE", f"/api/posts/{post_id}/like")
        assert unlike_resp.status_code == 200
        assert unlike_resp.json()["likeCount"] == 0
        assert unlike_resp.json()["isLiked"] is False

        # 바닥은 0 - 이미 안 누른 상태에서 다시 취소해도 음수로 내려가지 않는다.
        floor_resp = await client.request("DELETE", f"/api/posts/{post_id}/like")
        assert floor_resp.json()["likeCount"] == 0


@pytest.mark.asyncio
async def test_comment_create_updates_count_and_delete_by_others_forbidden(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    authed_as("user-b")
    async with _client() as client:
        comment_resp = await client.post(f"/api/posts/{post_id}/comments", json={"body": "멋져요"})
        assert comment_resp.status_code == 201
        comment = comment_resp.json()
        assert comment["authorUid"] == "user-b"
        assert comment["body"] == "멋져요"
        comment_id = comment["id"]

        detail_resp = await client.get(f"/api/posts/{post_id}")
        assert detail_resp.json()["post"]["commentCount"] == 1

    authed_as("user-a")
    async with _client() as client:
        forbidden_resp = await client.delete(f"/api/posts/{post_id}/comments/{comment_id}")
        assert forbidden_resp.status_code == 403

    authed_as("user-b")
    async with _client() as client:
        ok_resp = await client.delete(f"/api/posts/{post_id}/comments/{comment_id}")
        assert ok_resp.status_code == 204

        detail_after_resp = await client.get(f"/api/posts/{post_id}")
        assert detail_after_resp.json()["post"]["commentCount"] == 0


# ---------------------------------------------------------------------------
# P3: 공유용 단건 조회
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_post_detail_not_found_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/posts/no-such-post-id")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_post_detail_requires_login_only(authed_as: Callable[[str], None]) -> None:
    """GET /{post_id}: 익명=401, 로그인만 하면(팔로우 여부 무관) 200."""
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    _anonymous()
    async with _client() as client:
        anon_resp = await client.get(f"/api/posts/{post_id}")
    assert anon_resp.status_code == 401

    authed_as("user-b")
    async with _client() as client:
        other_resp = await client.get(f"/api/posts/{post_id}")
    assert other_resp.status_code == 200
    assert other_resp.json()["post"]["isLiked"] is False
    assert other_resp.json()["comments"] == []

    authed_as("user-a")
    async with _client() as client:
        own_resp = await client.get(f"/api/posts/{post_id}")
    assert own_resp.status_code == 200
    assert own_resp.json()["post"]["isMine"] is True


@pytest.mark.asyncio
async def test_list_post_images_requires_login_only(authed_as: Callable[[str], None]) -> None:
    """GET /{post_id}/images: 익명=401, 로그인만 하면(팔로우 여부 무관) 200."""
    authed_as("user-a")
    async with _client() as client:
        create_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": ""}
        )
        post_id = create_resp.json()["id"]

    _anonymous()
    async with _client() as client:
        anon_resp = await client.get(f"/api/posts/{post_id}/images")
    assert anon_resp.status_code == 401

    authed_as("user-b")
    async with _client() as client:
        other_resp = await client.get(f"/api/posts/{post_id}/images")
    assert other_resp.status_code == 200


# ---------------------------------------------------------------------------
# E3: 전체 유저 피드
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_feed_route_is_not_shadowed_by_post_id_route(
    authed_as: Callable[[str], None],
) -> None:
    """/feed가 /{post_id}보다 먼저 선언돼야 한다 - 아니면 "feed"가 post_id로
    매칭돼 404가 난다(모듈 docstring의 라우트 순서 함정)."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/posts/feed")
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_feed_returns_newest_first_with_author_and_allows_anonymous(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("feed-author")
    async with _client() as client:
        first_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": "첫 글"}
        )
        first_id = first_resp.json()["id"]
        second_resp = await client.post(
            "/api/posts", json={"imageData": _TINY_PNG_DATA_URL, "caption": "둘째 글"}
        )
        second_id = second_resp.json()["id"]

    # 익명 열람도 허용 - isLiked 키 자체가 없어야 한다.
    app.dependency_overrides.pop(get_current_user_optional, None)
    app.dependency_overrides.pop(get_current_user, None)
    async with _client() as client:
        resp = await client.get("/api/posts/feed")
    assert resp.status_code == 200
    items = resp.json()
    ids_in_order = [item["post"]["id"] for item in items]
    # 최신순 - 둘째 글이 첫 글보다 먼저 나와야 한다.
    assert ids_in_order.index(second_id) < ids_in_order.index(first_id)
    second_item = next(item for item in items if item["post"]["id"] == second_id)
    assert second_item["author"]["uid"] == "feed-author"
    assert "isLiked" not in second_item["post"]
