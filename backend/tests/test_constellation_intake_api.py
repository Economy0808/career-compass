"""인테이크(intake) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_constellation_api.py/test_bin_suggestion.py와 동일한 이유로 Mock을 쓰지 않고
에뮬레이터를 쓴다(bin_suggestion이 실제 course_catalog 쿼리를 거치므로) - 스킵 가드/
authed_as 픽스처 스타일도 그 파일을 그대로 복사한 관례다.

get_llm_client는 app.llm.get_llm_client가 lru_cache된 FastAPI dependency이며,
app_env=test에서는 어차피 MockClaudeClient를 돌려주지만(config.use_real_llm),
이 스위트에서는 결정론을 명시적으로 보장하고 lru_cache 상태에 기대지 않기 위해
dependency_overrides로 직접 MockClaudeClient를 주입한다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_constellation_intake_api.py -q"
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.etl.yonsei_courses import MergedCourse
from app.firestore.client import get_firestore_client
from app.firestore.course_repo import upsert_courses
from app.llm import get_llm_client
from app.llm.mock_client import MockClaudeClient
from app.main import app
from app.services import bin_jobs


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
    app.dependency_overrides[get_llm_client] = lambda: MockClaudeClient()
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_bin_jobs() -> Iterator[None]:
    """인메모리 잡 레지스트리가 테스트 간에 새어나가지 않도록 초기화."""
    bin_jobs.reset_jobs()
    yield
    bin_jobs.reset_jobs()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user_optional override를 세팅하는 함수를 돌려준다.

    이 라우터의 네 엔드포인트 모두 get_current_user_optional을 직접 의존하므로
    (인증 불필요 - 모듈 docstring 참고) 그 객체를 그대로 키로 override해야 먹는다.
    """

    def _set(uid: str) -> None:
        app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(uid=uid)

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _course(
    code: str,
    name: str = "테스트 과목",
    level: int | None = 1,
    department: str = "경영대학",
) -> MergedCourse:
    return MergedCourse(
        code=code,
        name=name,
        level=level,
        years=[],
        kind=None,
        description="설명",
        department=department,
        college=department,
    )


_BUSINESS_GOAL = "전략 컨설턴트가 되고 싶다"


def _seed_business_courses() -> None:
    db = get_firestore_client()
    upsert_courses(
        db,
        [
            _course("BIZ1001", "경영학 원론", level=1, department="경영대학"),
            _course("BIZ2001", "회계원리", level=2, department="경영대학"),
        ],
    )


async def _poll_job(client: AsyncClient, job_id: str, *, timeout: float = 10.0) -> dict:
    """job이 done/error가 될 때까지 짧은 간격으로 폴링한다."""
    elapsed = 0.0
    step = 0.1
    while elapsed < timeout:
        resp = await client.get(f"/api/constellation-intake/jobs/{job_id}")
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] in ("done", "error"):
            return data
        await asyncio.sleep(step)
        elapsed += step
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


# --- 인증 (인증 불필요 - 모듈 docstring 참고) ---


@pytest.mark.asyncio
async def test_chat_without_auth_header_succeeds_for_anonymous_visitor() -> None:
    """렌즈->대화->초안 체인은 로그인 전 방문자도 끝까지 돌려볼 수 있어야 한다."""
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/chat",
            json={"goalRawText": "데이터 분석가가 되고 싶어", "messages": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["done"] is False
        assert data["reply"] is not None


@pytest.mark.asyncio
async def test_anon_bins_job_completes_and_is_pollable_without_auth(
    authed_as: Callable[[str], None],
) -> None:
    """비로그인으로 시작한 /bins 잡을 비로그인 그대로 폴링해 결과를 받을 수 있어야 한다."""
    _seed_business_courses()
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/bins", json={"goalText": _BUSINESS_GOAL}
        )
        assert resp.status_code == 202
        job_id = resp.json()["jobId"]

        data = await _poll_job(client, job_id)  # 인증 헤더 없이 폴링
        assert data["status"] == "done"
        assert data["result"]["bins"]


@pytest.mark.asyncio
async def test_authed_user_cannot_read_anon_job(authed_as: Callable[[str], None]) -> None:
    """익명 잡(uid="anon")은 로그인한 유저의 uid로는 조회되지 않는다(404)."""
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/bins", json={"goalText": _BUSINESS_GOAL}
        )
        job_id = resp.json()["jobId"]

    authed_as("user-a")
    async with _client() as client:
        resp = await client.get(f"/api/constellation-intake/jobs/{job_id}")
        assert resp.status_code == 404


# --- 질답 (/chat) ---


@pytest.mark.asyncio
async def test_chat_turn_one_returns_question_and_appended_messages(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/chat",
            json={"goalRawText": "데이터 분석가가 되고 싶어", "messages": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["done"] is False
        assert data["reply"] is not None
        assert len(data["messages"]) == 1
        assert data["messages"][0]["role"] == "assistant"
        assert data["messages"][0]["content"] == data["reply"]


@pytest.mark.asyncio
async def test_chat_turn_includes_hint_and_options(authed_as: Callable[[str], None]) -> None:
    """질답 응답 하나하나가 입력 보조 칩(camelCase options)을 들고 와야 한다(board 3)."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/chat",
            json={"goalRawText": "데이터 분석가가 되고 싶어", "messages": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "hint" in data  # 키 존재(값은 null일 수 있음)
        assert data["options"], "mock은 매 질문마다 칩을 준다"
        assert all(isinstance(o, str) for o in data["options"])


@pytest.mark.asyncio
async def test_chat_done_turn_has_empty_options(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    goal = "데이터 분석가가 되고 싶어"
    messages: list[dict] = []
    async with _client() as client:
        for _ in range(10):  # mock은 질문 6개 - 넉넉한 상한
            resp = await client.post(
                "/api/constellation-intake/chat",
                json={"goalRawText": goal, "messages": messages},
            )
            assert resp.status_code == 200
            data = resp.json()
            messages = data["messages"]
            if data["done"]:
                assert data["options"] == []
                assert data["hint"] is None
                return
            messages.append({"role": "user", "content": "네, 그래요"})
        pytest.fail("6문항 안에 done=True에 도달해야 한다")


@pytest.mark.asyncio
async def test_chat_loop_reaches_done_within_mock_question_budget(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    goal = "데이터 분석가가 되고 싶어"
    messages: list[dict] = []
    async with _client() as client:
        done = False
        for _ in range(10):  # mock은 질문 6개 - 넉넉한 상한
            resp = await client.post(
                "/api/constellation-intake/chat",
                json={"goalRawText": goal, "messages": messages},
            )
            assert resp.status_code == 200
            data = resp.json()
            messages = data["messages"]
            if data["done"]:
                done = True
                break
            messages.append({"role": "user", "content": "네, 그래요"})
        assert done, "6문항 안에 done=True에 도달해야 한다"


@pytest.mark.asyncio
async def test_chat_content_over_limit_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/chat",
            json={
                "goalRawText": "데이터 분석가가 되고 싶어",
                "messages": [{"role": "user", "content": "x" * 2001}],
            },
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_chat_messages_over_limit_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    too_many = [{"role": "user", "content": "x"} for _ in range(41)]
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/chat",
            json={"goalRawText": "데이터 분석가가 되고 싶어", "messages": too_many},
        )
        assert resp.status_code == 422


# --- 보관함 제안 (/bins) ---


@pytest.mark.asyncio
async def test_suggest_bins_job_completes_with_seeded_course_bins(
    authed_as: Callable[[str], None],
) -> None:
    _seed_business_courses()
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/bins", json={"goalText": _BUSINESS_GOAL}
        )
        assert resp.status_code == 202
        job_id = resp.json()["jobId"]
        assert resp.json()["status"] in ("pending", "running")

        data = await _poll_job(client, job_id)
        assert data["status"] == "done"
        bins = data["result"]["bins"]
        assert bins

        course_bins = [b for b in bins if any(i["id"].startswith("course:") for i in b["items"])]
        assert course_bins, "수업 군집이 최소 1개 있어야 한다"
        for b in bins:
            assert "label" in b
            assert "origin" in b


@pytest.mark.asyncio
async def test_job_status_for_different_owner_returns_404(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/bins", json={"goalText": _BUSINESS_GOAL}
        )
        job_id = resp.json()["jobId"]

    authed_as("user-b")
    async with _client() as client:
        resp = await client.get(f"/api/constellation-intake/jobs/{job_id}")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_job_status_unknown_id_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/constellation-intake/jobs/unknown-job-id")
        assert resp.status_code == 404


# --- 보관함 채우기 (/bins/fill) ---


@pytest.mark.asyncio
async def test_fill_bin_job_returns_one_bin_with_requested_label(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    bin_label = "네트워킹"
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/bins/fill",
            json={"goalText": _BUSINESS_GOAL, "binLabel": bin_label},
        )
        assert resp.status_code == 202
        job_id = resp.json()["jobId"]

        data = await _poll_job(client, job_id)
        assert data["status"] == "done"
        # fill job도 suggest job과 동일한 {"bins": [...]} 폴링 계약을 따른다
        bins = data["result"]["bins"]
        assert len(bins) == 1
        assert bins[0]["label"] == bin_label
        assert bins[0]["origin"] == "user"


# --- 선수관계 추론 (/prereqs) ---


@pytest.mark.asyncio
async def test_prereqs_links_courses_by_ascending_level(
    authed_as: Callable[[str], None],
) -> None:
    """mock의 infer_prerequisites는 level 오름차순 인접 쌍만 잇는다."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/prereqs",
            json={
                "items": [
                    {"code": "C300", "name": "심화", "level": 3, "kind": None},
                    {"code": "C100", "name": "기초", "level": 1, "kind": None},
                    {"code": "C200", "name": "중급", "level": 2, "kind": None},
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.json()["edges"] == [
            {"before": "course:C100", "after": "course:C200"},
            {"before": "course:C200", "after": "course:C300"},
        ]


@pytest.mark.asyncio
async def test_prereqs_with_single_item_returns_empty(authed_as: Callable[[str], None]) -> None:
    """항목이 2개 미만이면 판단 자체를 하지 않는다(확신 없으면 빈 결과 계약)."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellation-intake/prereqs",
            json={"items": [{"code": "C100", "name": "기초", "level": 1, "kind": None}]},
        )
        assert resp.status_code == 200
        assert resp.json()["edges"] == []
