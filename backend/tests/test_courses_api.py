"""과목 검색 API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_explore_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터 스킵 가드도
그 파일을 그대로 복사한 관례). 인증은 app.dependency_overrides로 대체한다.
conftest.py가 FIRESTORE_PROJECT_ID를 demo-ourlab-test로 강제 격리하므로 실데이터
(course_catalog 7,109건, demo-ourlab 프로젝트)는 이 스위트가 건드리지 않는다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore,auth --project demo-ourlab-test \
        ".venv/Scripts/python.exe -m pytest tests/test_courses_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.etl.yonsei_courses import MergedCourse
from app.firestore import course_repo as repo
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
        "firebase emulators:exec --only firestore,auth --project demo-ourlab-test 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    """app이 모듈 전역 싱글턴이라, 테스트가 실패하든 성공하든 override는 항상 지운다."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], DecodedToken]:
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다.

    yonsei_verified 인자를 받아 "미인증 유저도 200이어야 한다" 시나리오를 명시적으로
    검증할 수 있게 한다(브리핑의 게이트 없음 확인 요구사항).
    """

    def _set(uid: str, *, yonsei_verified: bool = False) -> DecodedToken:
        token = DecodedToken(uid=uid, yonsei_verified=yonsei_verified)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token
        return token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _seed_courses(*courses: MergedCourse) -> None:
    db = get_firestore_client()
    repo.upsert_courses(db, list(courses))


def _make_course(
    code: str,
    *,
    name: str = "철학개론",
    department: str = "철학과",
    college: str = "문과대학",
    level: int | None = 1,
    credits: float | None = 3.0,
    kind: str | None = "전기",
) -> MergedCourse:
    return MergedCourse(
        code=code,
        name=name,
        kind=kind,
        years=[1, 2],
        credits=credits,
        level=level,
        college=college,
        department=department,
    )


# ---------------------------------------------------------------------------
# GET /api/courses/search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_anonymous_returns_401() -> None:
    async with _client() as client:
        resp = await client.get("/api/courses/search", params={"q": "철학"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_search_name_substring_match(authed_as: Callable[..., DecodedToken]) -> None:
    _seed_courses(
        _make_course("PHI1001", name="철학개론"),
        _make_course("ECO1001", name="경제원론", department="경제학과", college="상경대학"),
    )
    authed_as("searcher")
    async with _client() as client:
        resp = await client.get("/api/courses/search", params={"q": "철학"})
    assert resp.status_code == 200
    codes = [item["code"] for item in resp.json()]
    assert "PHI1001" in codes
    assert "ECO1001" not in codes


@pytest.mark.asyncio
async def test_search_course_code_prefix_match(authed_as: Callable[..., DecodedToken]) -> None:
    _seed_courses(
        _make_course("HUM2037", name="철학과인간"),
        _make_course("HUM2099", name="다른과목"),
        _make_course("ECO1001", name="경제원론", department="경제학과", college="상경대학"),
    )
    authed_as("searcher")
    async with _client() as client:
        resp = await client.get("/api/courses/search", params={"q": "HUM20"})
    assert resp.status_code == 200
    codes = {item["code"] for item in resp.json()}
    assert codes == {"HUM2037", "HUM2099"}


@pytest.mark.asyncio
async def test_search_department_filter(authed_as: Callable[..., DecodedToken]) -> None:
    _seed_courses(
        _make_course("PHI1001", department="철학과", college="문과대학"),
        _make_course("PHI1002", department="철학과", college="문과대학"),
        _make_course("ECO1001", department="경제학과", college="상경대학"),
    )
    authed_as("searcher")
    async with _client() as client:
        resp = await client.get("/api/courses/search", params={"department": "철학과"})
    assert resp.status_code == 200
    codes = {item["code"] for item in resp.json()}
    assert codes == {"PHI1001", "PHI1002"}


@pytest.mark.asyncio
async def test_search_limit_clamps_to_30(authed_as: Callable[..., DecodedToken]) -> None:
    _seed_courses(*(_make_course(f"CLM{i:03d}", department="클램프학과") for i in range(40)))
    authed_as("searcher")
    async with _client() as client:
        resp = await client.get(
            "/api/courses/search", params={"department": "클램프학과", "limit": 999}
        )
    assert resp.status_code == 200
    assert len(resp.json()) == 30


@pytest.mark.asyncio
async def test_search_unverified_user_still_gets_200(
    authed_as: Callable[..., DecodedToken],
) -> None:
    """require_yonsei_verified 게이트가 걸려있지 않은지 확인한다 - 미인증 유저도
    캔버스에서 혼자 놀 때 수업을 붙일 수 있어야 한다는 게 사용자 지시의 취지다."""
    _seed_courses(_make_course("UNV1001", name="미인증접근과목"))
    authed_as("unverified-user", yonsei_verified=False)
    async with _client() as client:
        resp = await client.get("/api/courses/search", params={"q": "미인증"})
    assert resp.status_code == 200
    codes = [item["code"] for item in resp.json()]
    assert "UNV1001" in codes


@pytest.mark.asyncio
async def test_search_no_filters_returns_default_list(
    authed_as: Callable[..., DecodedToken],
) -> None:
    """q/department/college가 전부 비어도 400이 아니라 필터 없는 기본 목록을 준다."""
    _seed_courses(_make_course("DEF0001", name="기본목록과목"))
    authed_as("searcher")
    async with _client() as client:
        resp = await client.get("/api/courses/search")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


# ---------------------------------------------------------------------------
# GET /api/courses/taxonomy
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_taxonomy_returns_departments_and_colleges(
    authed_as: Callable[..., DecodedToken],
) -> None:
    repo._taxonomy_cache = None
    try:
        _seed_courses(
            _make_course("TAX0001", department="철학과", college="문과대학"),
            _make_course("TAX0002", department="경제학과", college="상경대학"),
            _make_course("TAX0003", department="전산학과", college="공과대학"),
        )
        authed_as("searcher")
        async with _client() as client:
            resp = await client.get("/api/courses/taxonomy")
        assert resp.status_code == 200
        body = resp.json()
        assert "철학과" in body["departments"]
        assert "문과대학" in body["colleges"]
    finally:
        repo._taxonomy_cache = None


@pytest.mark.asyncio
async def test_taxonomy_anonymous_returns_401() -> None:
    async with _client() as client:
        resp = await client.get("/api/courses/taxonomy")
    assert resp.status_code == 401
