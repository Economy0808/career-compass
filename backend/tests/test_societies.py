"""학회/동아리 크라우드소싱 제출(Stage A) API 통합 테스트 - 실제 Firestore 에뮬레이터를
상대로 실행한다.

test_stories_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터 스킵 가드도 그
파일을 그대로 복사한 관례). 인증은 app.dependency_overrides로 대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(작업 지시 - 공유 에뮬레이터
데이터가 전멸하는 함정이 있어 이 세션에서는 pytest를 절대 돌리지 않는다).

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 검증 시):
    firebase emulators:exec --only firestore,auth --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_societies.py -q"
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

_VALID_URL = "https://society.example.com/notice"


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
        "firebase emulators:exec --only firestore,auth --project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user/get_current_user_optional을 연세대 인증 완료
    상태로 override한다."""

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _valid_payload(**overrides: object) -> dict:
    payload = {
        "departmentId": "cse",
        "name": "알고리즘 연구회",
        "kind": "학회",
        "officialUrl": _VALID_URL,
        "recruitSeason": "매 학기 초",
        "field": "알고리즘",
        "description": "코딩테스트와 알고리즘을 함께 공부하는 학회입니다.",
    }
    payload.update(overrides)
    return payload


def _set_society_doc(department_id: str, doc_id: str, data: dict) -> None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 세팅한다(GET 필터 테스트 전용)."""
    (
        get_firestore_client()
        .collection("academic_societies")
        .document(department_id)
        .collection("societies")
        .document(doc_id)
        .set(data)
    )


# --- POST /api/societies : 인증 게이트 ---


@pytest.mark.asyncio
async def test_submit_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload())
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_submit_requires_yonsei_verification() -> None:
    token = DecodedToken(uid="unverified-user", yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload())
    assert resp.status_code == 403
    assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


# --- POST /api/societies : 정상 제출 ---


@pytest.mark.asyncio
async def test_submit_valid_stores_as_pending(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload())
    assert resp.status_code == 201
    body = resp.json()
    assert body["moderationStatus"] == "pending"
    assert "id" in body

    doc = (
        get_firestore_client()
        .collection("academic_societies")
        .document("cse")
        .collection("societies")
        .document(body["id"])
        .get()
    )
    stored = doc.to_dict()
    assert stored["moderation_status"] == "pending"
    assert stored["submitter_uid"] == "user-a"
    assert stored["source_type"] == "crowdsource"


@pytest.mark.asyncio
async def test_submit_rejects_department_id_with_slash(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload(departmentId="cse/../other"))
    assert resp.status_code == 422


# --- POST /api/societies : PII 가드 ---


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field_name,value",
    [
        ("description", "문의는 010-1234-5678 로 주세요."),
        ("description", "문의는 club-lead@example.com 로 주세요."),
        ("description", "카톡 openchat123 로 문의주세요."),
        ("name", "010-9999-8888 학회"),
    ],
)
async def test_submit_rejects_pii_in_free_text(
    authed_as: Callable[[str], None], field_name: str, value: str
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload(**{field_name: value}))
    assert resp.status_code == 422
    assert "연락처" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_submit_allows_contact_keyword_without_identifier(
    authed_as: Callable[[str], None],
) -> None:
    """키워드만 있고 식별자스러운 토큰이 안 붙어 있으면 정상적인 설명문으로 통과시킨다."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/societies",
            json=_valid_payload(description="동문 연락처 관리 시스템을 함께 개발하는 학회입니다."),
        )
    assert resp.status_code == 201


# --- POST /api/societies : URL 검증 ---


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_url",
    [
        "http://society.example.com",  # https 아님
        "mailto:club@example.com",  # https 아님
        "https://192.168.0.1/notice",  # IP 리터럴
        "https://[::1]/notice",  # IPv6 리터럴
        "https://user:pass@society.example.com",  # userinfo 포함
    ],
)
async def test_submit_rejects_invalid_official_url(
    authed_as: Callable[[str], None], bad_url: str
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/societies", json=_valid_payload(officialUrl=bad_url))
    assert resp.status_code == 422
    assert "https" in resp.json()["detail"]


# --- GET /api/societies : 승인된 문서만, submitter_uid 비노출 ---


@pytest.mark.asyncio
async def test_list_returns_only_approved_and_hides_submitter_uid() -> None:
    _set_society_doc(
        "cse",
        "approved-1",
        {
            "name": "승인된 학회",
            "kind": "학회",
            "official_url": _VALID_URL,
            "recruit_season": "3월",
            "field": "AI",
            "description": "설명",
            "source_type": "crowdsource",
            "submitter_uid": "secret-submitter",
            "moderation_status": "approved",
        },
    )
    _set_society_doc(
        "cse",
        "pending-1",
        {
            "name": "대기중인 학회",
            "kind": "동아리",
            "official_url": _VALID_URL,
            "moderation_status": "pending",
            "submitter_uid": "someone-else",
        },
    )

    async with _client() as client:
        resp = await client.get("/api/societies", params={"departmentId": "cse"})

    assert resp.status_code == 200
    items = resp.json()
    names = [item["name"] for item in items]
    assert "승인된 학회" in names
    assert "대기중인 학회" not in names
    for item in items:
        assert "submitterUid" not in item
        assert "submitter_uid" not in item


# --- POST /api/societies/{department_id}/{society_id}/report : 인증 게이트 ---


@pytest.mark.asyncio
async def test_report_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/societies/cse/some-id/report")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_report_requires_yonsei_verification() -> None:
    token = DecodedToken(uid="unverified-user", yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token
    async with _client() as client:
        resp = await client.post("/api/societies/cse/some-id/report")
    assert resp.status_code == 403
    assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


# --- POST /api/societies/{department_id}/{society_id}/report : 임시조치 효과 ---


@pytest.mark.asyncio
async def test_report_flips_approved_to_pending_and_drops_from_get(
    authed_as: Callable[[str], None],
) -> None:
    _set_society_doc(
        "cse",
        "report-target-1",
        {
            "name": "신고당할 학회",
            "kind": "학회",
            "official_url": _VALID_URL,
            "source_type": "crowdsource",
            "submitter_uid": "original-submitter",
            "moderation_status": "approved",
        },
    )
    authed_as("reporter-a")
    async with _client() as client:
        report_resp = await client.post("/api/societies/cse/report-target-1/report")
        assert report_resp.status_code == 200
        assert report_resp.json() == {"status": "ok"}

        list_resp = await client.get("/api/societies", params={"departmentId": "cse"})
    names = [item["name"] for item in list_resp.json()]
    assert "신고당할 학회" not in names

    doc = (
        get_firestore_client()
        .collection("academic_societies")
        .document("cse")
        .collection("societies")
        .document("report-target-1")
        .get()
        .to_dict()
    )
    assert doc["moderation_status"] == "pending"
    assert doc["reported_by"] == "reporter-a"


@pytest.mark.asyncio
async def test_report_does_not_leak_reporter_identity(
    authed_as: Callable[[str], None],
) -> None:
    _set_society_doc(
        "cse",
        "report-target-2",
        {
            "name": "신고당할 학회2",
            "kind": "학회",
            "official_url": _VALID_URL,
            "source_type": "crowdsource",
            "submitter_uid": "original-submitter",
            "moderation_status": "approved",
        },
    )
    authed_as("reporter-b")
    async with _client() as client:
        resp = await client.post("/api/societies/cse/report-target-2/report")
    assert resp.status_code == 200
    body = resp.json()
    assert "reportedBy" not in body
    assert "reporterUid" not in body
    assert set(body.keys()) == {"status"}


@pytest.mark.asyncio
async def test_report_already_pending_is_noop_success(
    authed_as: Callable[[str], None],
) -> None:
    _set_society_doc(
        "cse",
        "report-target-3",
        {
            "name": "이미 대기중",
            "kind": "동아리",
            "official_url": _VALID_URL,
            "source_type": "crowdsource",
            "submitter_uid": "original-submitter",
            "moderation_status": "pending",
        },
    )
    authed_as("reporter-c")
    async with _client() as client:
        resp = await client.post("/api/societies/cse/report-target-3/report")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_report_unknown_doc_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("reporter-d")
    async with _client() as client:
        resp = await client.post("/api/societies/cse/no-such-id/report")
    assert resp.status_code == 404
