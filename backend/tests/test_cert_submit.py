"""유저 제보 자격증(user_submitted) API 통합 테스트 - 실제 Firestore 에뮬레이터를
상대로 실행한다.

tests/test_societies.py와 동일한 이유로 Mock을 쓰지 않는다(제출/신고가
moderation_status 전이·컬렉션 분리를 실제로 검증해야 의미가 있어서 Firestore
쿼리 동작 자체를 모킹하면 테스트가 공허해진다). 인증은
app.dependency_overrides로 대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(이 세션 하드 요구사항 -
공유 에뮬레이터 데이터가 전멸하는 함정이 있어 이 세션에서는 pytest를 절대
돌리지 않는다).

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 검증 시):
    firebase emulators:exec --only firestore,auth --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_cert_submit.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.api import certifications as certifications_module
from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore.client import get_firestore_client
from app.main import app

_VALID_URL = "https://issuer.example.com/cert-info"


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
def _clear_overrides_and_cache() -> Iterator[None]:
    """의존성 override + search 결과 TTL 캐시(app/api/certifications.py) 초기화.

    TTL 캐시를 안 비우면 한 테스트가 심어둔 문서를 다음 테스트가 60초 안에
    돌면서 "이미 캐싱된 옛 목록"으로 보게 돼 순서에 따라 플레이키해진다.
    """
    certifications_module._cache["certs"] = None
    certifications_module._cache["at"] = 0.0
    yield
    certifications_module._cache["certs"] = None
    certifications_module._cache["at"] = 0.0
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
        "name": "사내 데이터분석 자격증",
        "issuer": "한국데이터산업진흥원",
        "officialUrl": _VALID_URL,
    }
    payload.update(overrides)
    return payload


def _set_curated_cert(doc_id: str, name_norm: str) -> None:
    """certifications(큐레이션) 컬렉션에 문서를 직접 심는다 - 충돌/신고 거부 테스트용."""
    get_firestore_client().collection("certifications").document(doc_id).set(
        {
            "jmcd": doc_id,
            "name": "정보처리기사",
            "name_norm": name_norm,
            "issuer": "한국산업인력공단",
            "scope": "domestic_national",
            "source_type": "open_api",
        }
    )


def _set_user_cert_doc(doc_id: str, data: dict) -> None:
    """리포지토리를 거치지 않고 raw user_certifications 문서를 직접 세팅한다."""
    get_firestore_client().collection("user_certifications").document(doc_id).set(data)


# --- POST /api/certifications : 인증 게이트 ---


@pytest.mark.asyncio
async def test_submit_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/certifications", json=_valid_payload())
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_submit_requires_yonsei_verification() -> None:
    token = DecodedToken(uid="unverified-user", yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token
    async with _client() as client:
        resp = await client.post("/api/certifications", json=_valid_payload())
    assert resp.status_code == 403
    assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


# --- POST /api/certifications : 정상 제출 ---


@pytest.mark.asyncio
async def test_submit_valid_stores_as_pending_unverified(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/certifications", json=_valid_payload())
    assert resp.status_code == 201
    body = resp.json()
    assert body["moderationStatus"] == "pending"
    assert "id" in body

    doc = (
        get_firestore_client()
        .collection("user_certifications")
        .document(body["id"])
        .get()
        .to_dict()
    )
    assert doc["moderation_status"] == "pending"
    assert doc["source_type"] == "user_submitted"
    assert doc["verified"] is False
    assert doc["submitter_uid"] == "user-a"


# --- POST /api/certifications : PII 가드 ---


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field_name,value",
    [
        ("name", "010-1234-5678 자격증"),
        ("issuer", "문의는 club-lead@example.com 로 주세요."),
        ("issuer", "카톡 openchat123 로 문의주세요."),
    ],
)
async def test_submit_rejects_pii_in_free_text(
    authed_as: Callable[[str], None], field_name: str, value: str
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/certifications", json=_valid_payload(**{field_name: value}))
    assert resp.status_code == 422
    assert "연락처" in resp.json()["detail"]


# --- POST /api/certifications : URL 검증 ---


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_url",
    [
        "http://issuer.example.com",  # https 아님
        "https://192.168.0.1/cert",  # IP 리터럴
        "https://user:pass@issuer.example.com",  # userinfo 포함
    ],
)
async def test_submit_rejects_invalid_official_url(
    authed_as: Callable[[str], None], bad_url: str
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/certifications", json=_valid_payload(officialUrl=bad_url))
    assert resp.status_code == 422
    assert "https" in resp.json()["detail"]


# --- POST /api/certifications : 큐레이션 자격증과의 충돌 ---


@pytest.mark.asyncio
async def test_submit_collides_with_curated_cert_returns_409(
    authed_as: Callable[[str], None],
) -> None:
    _set_curated_cert("1320", "정보처리기사")
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/certifications", json=_valid_payload(name="정보처리기사", issuer="다른표기")
        )
    assert resp.status_code == 409


# --- GET /api/certifications : 승인된 유저 제보만 노출 + verified 플래그 ---


@pytest.mark.asyncio
async def test_search_excludes_pending_and_flags_approved_user_cert_unverified() -> None:
    _set_curated_cert("1320", "정보처리기사")
    _set_user_cert_doc(
        "approved-1",
        {
            "name": "승인된 유저 제보 자격증",
            "name_norm": "승인된유저제보자격증",
            "issuer": "제보자",
            "official_url": _VALID_URL,
            "source_type": "user_submitted",
            "verified": False,
            "submitter_uid": "secret-submitter",
            "moderation_status": "approved",
        },
    )
    _set_user_cert_doc(
        "pending-1",
        {
            "name": "대기중인 유저 제보 자격증",
            "name_norm": "대기중인유저제보자격증",
            "issuer": "제보자",
            "official_url": _VALID_URL,
            "source_type": "user_submitted",
            "verified": False,
            "submitter_uid": "someone-else",
            "moderation_status": "pending",
        },
    )

    async with _client() as client:
        resp = await client.get("/api/certifications")

    assert resp.status_code == 200
    items = resp.json()
    by_name = {item["name"]: item for item in items}
    assert "대기중인 유저 제보 자격증" not in by_name
    assert "정보처리기사" in by_name
    assert by_name["정보처리기사"]["verified"] is True
    assert by_name["승인된 유저 제보 자격증"]["verified"] is False
    for item in items:
        assert "submitterUid" not in item


# --- POST /api/certifications/{id}/report ---


@pytest.mark.asyncio
async def test_report_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/certifications/some-id/report")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_report_flips_approved_to_pending_and_hides_reporter(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_cert_doc(
        "report-target-1",
        {
            "name": "신고당할 자격증",
            "name_norm": "신고당할자격증",
            "issuer": "제보자",
            "official_url": _VALID_URL,
            "source_type": "user_submitted",
            "verified": False,
            "submitter_uid": "original-submitter",
            "moderation_status": "approved",
        },
    )
    authed_as("reporter-a")
    async with _client() as client:
        report_resp = await client.post("/api/certifications/report-target-1/report")
        assert report_resp.status_code == 200
        body = report_resp.json()
        assert set(body.keys()) == {"status"}

        list_resp = await client.get("/api/certifications")
    names = [item["name"] for item in list_resp.json()]
    assert "신고당할 자격증" not in names

    doc = (
        get_firestore_client()
        .collection("user_certifications")
        .document("report-target-1")
        .get()
        .to_dict()
    )
    assert doc["moderation_status"] == "pending"
    assert doc["reported_by"] == "reporter-a"


@pytest.mark.asyncio
async def test_report_curated_certification_returns_400(
    authed_as: Callable[[str], None],
) -> None:
    _set_curated_cert("1320", "정보처리기사")
    authed_as("reporter-b")
    async with _client() as client:
        resp = await client.post("/api/certifications/1320/report")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_report_unknown_id_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("reporter-c")
    async with _client() as client:
        resp = await client.post("/api/certifications/no-such-id/report")
    assert resp.status_code == 404
