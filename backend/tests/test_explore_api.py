"""탐색(Explore) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_profiles_api.py/test_posts_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터
스킵 가드도 그 파일들을 그대로 복사한 관례). 인증은 app.dependency_overrides로
대체한다. users.interest_tags는 별자리 발행 흐름을 통해서만 갱신되므로(brief
E1), 이 스위트는 그 계산 경로를 거치지 않고 raw Firestore 문서를 직접 세팅한다
(test_constellation_api.py의 _mark_published와 동일한 관례) - 검증 대상은 탐색
API의 필터/정렬/검색 로직이지 태그 계산 자체(그건 test_constellation.py의
compute_interest_tags 단위 테스트 몫)가 아니다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(작업 지시 - 공유 에뮬레이터
데이터가 전멸하는 함정이 있어 이 세션에서는 pytest를 절대 돌리지 않는다).

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 검증 시):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_explore_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore import follow_repo
from app.firestore.client import get_firestore_client
from app.main import app


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
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다."""

    def _set(uid: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: DecodedToken(uid=uid)
        app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(uid=uid)

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _seed_user(
    uid: str,
    *,
    display_name: str | None,
    interest_tags: list[str],
    updated_at: datetime,
) -> None:
    """탐색 API가 읽는 users 문서를 리포지토리를 거치지 않고 직접 세팅한다(테스트 셋업 전용)."""
    db = get_firestore_client()
    doc: dict[str, object] = {"interest_tags": interest_tags, "updated_at": updated_at}
    if display_name is not None:
        doc["display_name"] = display_name
    db.collection("users").document(uid).set(doc)


# ---------------------------------------------------------------------------
# GET /api/explore/users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_excludes_self_and_requires_display_name(
    authed_as: Callable[[str], None],
) -> None:
    _seed_user(
        "requester",
        display_name="나",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "no-name",
        display_name=None,
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "candidate",
        display_name="후보",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("requester")
    async with _client() as client:
        resp = await client.get("/api/explore/users")
    assert resp.status_code == 200
    uids = [item["uid"] for item in resp.json()]
    assert "requester" not in uids
    assert "no-name" not in uids
    assert "candidate" in uids


@pytest.mark.asyncio
async def test_list_users_regression_self_never_appears(
    authed_as: Callable[[str], None],
) -> None:
    """회귀 테스트: 프론트 세션이 탐색 추천 결과에 본인 계정이 한 번 섞여 나온 것을
    관측했다(explore.py 편집 중 과도 상태였을 가능성이 높음). 본인이 추천 조건을
    완벽히 충족해도(표시 이름 있음 + 공통 관심사 보유) 결과에는 항상 빠져야 한다."""
    _seed_user(
        "regress-viewer",
        display_name="회귀뷰어",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "regress-other",
        display_name="다른유저",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("regress-viewer")
    async with _client() as client:
        resp = await client.get("/api/explore/users")
    uids = [item["uid"] for item in resp.json()]
    assert "regress-viewer" not in uids
    assert "regress-other" in uids


@pytest.mark.asyncio
async def test_list_users_sorts_by_intersection_size_when_logged_in(
    authed_as: Callable[[str], None],
) -> None:
    _seed_user(
        "requester2",
        display_name="나",
        interest_tags=["철학", "논리학", "윤리학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "low-overlap",
        display_name="낮은겹침",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "high-overlap",
        display_name="높은겹침",
        interest_tags=["철학", "논리학", "윤리학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("requester2")
    async with _client() as client:
        resp = await client.get("/api/explore/users")
    body = resp.json()
    uids = [item["uid"] for item in body]
    assert uids.index("high-overlap") < uids.index("low-overlap")
    high = next(item for item in body if item["uid"] == "high-overlap")
    assert set(high["commonTags"]) == {"철학", "논리학", "윤리학"}


@pytest.mark.asyncio
async def test_list_users_anonymous_sorts_by_updated_at_and_has_no_common_tags(
    authed_as: Callable[[str], None],
) -> None:
    _seed_user(
        "older",
        display_name="오래된",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "newer",
        display_name="최근",
        interest_tags=["철학"],
        updated_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    async with _client() as client:
        resp = await client.get("/api/explore/users")
    body = resp.json()
    uids = [item["uid"] for item in body]
    assert uids.index("newer") < uids.index("older")
    assert all("commonTags" not in item for item in body)


# ---------------------------------------------------------------------------
# GET /api/explore/search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_prefix_match_anonymous_allowed() -> None:
    _seed_user(
        "prefix-match",
        display_name="탐색테스트유저",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "no-match",
        display_name="다른이름",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "탐색테스트"})
    assert resp.status_code == 200
    uids = [item["uid"] for item in resp.json()]
    assert "prefix-match" in uids
    assert "no-match" not in uids


@pytest.mark.asyncio
async def test_search_empty_q_returns_422() -> None:
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_missing_q_returns_422() -> None:
    async with _client() as client:
        resp = await client.get("/api/explore/search")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_at_prefix_matches_nickname_substring() -> None:
    """`@`로 시작하면 뒤 문자열로 표시 이름 부분일치(중간 포함) 검색을 한다."""
    _seed_user(
        "nickname-match",
        display_name="별빛수집가",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "nickname-no-match",
        display_name="다른유저",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "@빛수집"})
    assert resp.status_code == 200
    uids = [item["uid"] for item in resp.json()]
    assert "nickname-match" in uids
    assert "nickname-no-match" not in uids


@pytest.mark.asyncio
async def test_search_keyword_matches_interest_tag() -> None:
    """일반 키워드 검색은 표시 이름/소개뿐 아니라 관심사 태그 부분일치도 걸린다."""
    _seed_user(
        "tag-match",
        display_name="아무개",
        interest_tags=["백엔드개발"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "tag-no-match",
        display_name="다른아무개",
        interest_tags=["미술"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "백엔드"})
    assert resp.status_code == 200
    uids = [item["uid"] for item in resp.json()]
    assert "tag-match" in uids
    assert "tag-no-match" not in uids


@pytest.mark.asyncio
async def test_search_sorts_by_viewer_interest_overlap_when_logged_in(
    authed_as: Callable[[str], None],
) -> None:
    """로그인 상태면 검색 결과도 뷰어 관심사와 겹치는 태그 수 내림차순으로 정렬된다."""
    _seed_user(
        "search-viewer",
        display_name="검색뷰어",
        interest_tags=["철학", "논리학", "AI"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "search-low-overlap",
        display_name="검색결과-낮음",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "search-high-overlap",
        display_name="검색결과-높음",
        interest_tags=["철학", "논리학", "AI"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("search-viewer")
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "검색결과"})
    assert resp.status_code == 200
    uids = [item["uid"] for item in resp.json()]
    assert uids.index("search-high-overlap") < uids.index("search-low-overlap")


@pytest.mark.asyncio
async def test_search_excludes_self(authed_as: Callable[[str], None]) -> None:
    _seed_user(
        "self-search",
        display_name="셀프검색유저",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("self-search")
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "셀프검색"})
    uids = [item["uid"] for item in resp.json()]
    assert "self-search" not in uids


@pytest.mark.asyncio
async def test_search_regression_self_never_appears_keyword_and_nickname(
    authed_as: Callable[[str], None],
) -> None:
    """회귀 테스트: 검색어가 본인 표시 이름/관심사 태그와 정확히 일치해도(키워드·@
    닉네임 양쪽 모두) 본인은 항상 결과에서 빠져야 한다."""
    _seed_user(
        "regress-search-viewer",
        display_name="겹침검색유저",
        interest_tags=["회귀검색태그"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    authed_as("regress-search-viewer")
    async with _client() as client:
        keyword_resp = await client.get("/api/explore/search", params={"q": "회귀검색태그"})
        nickname_resp = await client.get("/api/explore/search", params={"q": "@겹침검색유저"})
    assert keyword_resp.status_code == 200
    assert nickname_resp.status_code == 200
    assert "regress-search-viewer" not in [item["uid"] for item in keyword_resp.json()]
    assert "regress-search-viewer" not in [item["uid"] for item in nickname_resp.json()]


# ---------------------------------------------------------------------------
# isFollowing 반영 (팔로우 후 새로고침해도 버튼이 되돌아가는 버그 수정)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_excludes_already_followed(
    authed_as: Callable[[str], None],
) -> None:
    """추천(/users)에 이미 팔로우 중인 유저는 다시 뜨면 안 된다."""
    db = get_firestore_client()
    _seed_user(
        "follow-viewer",
        display_name="팔로우뷰어",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "already-followed",
        display_name="이미팔로우",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "not-followed",
        display_name="미팔로우",
        interest_tags=["철학"],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    follow_repo.follow(db, "follow-viewer", "already-followed")
    authed_as("follow-viewer")
    async with _client() as client:
        resp = await client.get("/api/explore/users")
    body = resp.json()
    uids = [item["uid"] for item in body]
    assert "already-followed" not in uids
    assert "not-followed" in uids
    not_followed = next(item for item in body if item["uid"] == "not-followed")
    assert not_followed["isFollowing"] is False


@pytest.mark.asyncio
async def test_search_shows_followed_user_with_is_following_true(
    authed_as: Callable[[str], None],
) -> None:
    """검색(/search)은 이미 팔로우한 유저도 결과에 남기되 isFollowing으로 표시한다."""
    db = get_firestore_client()
    _seed_user(
        "search-follow-viewer",
        display_name="검색팔로우뷰어",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    _seed_user(
        "search-followed-target",
        display_name="검색팔로우대상",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    follow_repo.follow(db, "search-follow-viewer", "search-followed-target")
    authed_as("search-follow-viewer")
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "검색팔로우대상"})
    assert resp.status_code == 200
    body = resp.json()
    uids = [item["uid"] for item in body]
    assert "search-followed-target" in uids
    target = next(item for item in body if item["uid"] == "search-followed-target")
    assert target["isFollowing"] is True


@pytest.mark.asyncio
async def test_search_anonymous_has_no_is_following_key() -> None:
    """익명 요청이면 응답에 isFollowing 키 자체가 없어야 한다(response_model_exclude_none)."""
    _seed_user(
        "anon-search-target",
        display_name="익명검색대상",
        interest_tags=[],
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    async with _client() as client:
        resp = await client.get("/api/explore/search", params={"q": "익명검색대상"})
    assert resp.status_code == 200
    body = resp.json()
    assert body
    assert all("isFollowing" not in item for item in body)
