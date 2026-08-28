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
