"""자격증 검색 API(app/api/certifications.py) 테스트 - Firestore를 완전히 모킹한다.

tests/test_cert_grounding.py와 동일한 이유로 에뮬레이터가 필요 없다: 이 라우터는
certification_repo.list_all/get_career_path 호출 결과를 파이썬 필터링만 하는
얇은 계층이라, 그 두 함수를 patch하고 get_firestore_client도 더미로 override하면
충분하다(SAFETY: 이 세션은 Firestore를 전혀 건드리지 않는다).
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import certifications as certifications_module
from app.firestore.client import get_firestore_client
from app.main import app

_CERTS: list[dict] = [
    {
        "jmcd": "1320",
        "name": "정보처리기사",
        "name_norm": "정보처리기사",
        "issuer": "한국산업인력공단",
        "scope": "domestic_national",
        "cert_class": "career_credential",
        "tier": "우대",
        "official_url": "https://www.q-net.or.kr",
        "schedule": {"impl_yy": "2026"},
        "source_type": "open_api",
    },
    {
        "jmcd": "",
        "name": "CFA",
        "name_norm": "cfa",
        "issuer": "CFA Institute",
        "scope": "international",
        "cert_class": "career_credential",
        "tier": "우대",
        "official_url": "https://www.cfainstitute.org",
        "schedule": None,
        "source_type": "curated",
    },
]


@pytest.fixture(autouse=True)
def _reset_cache_and_overrides() -> Iterator[None]:
    """모듈 전역 TTL 캐시 + app 의존성 override를 테스트마다 초기화한다.

    user_certification_repo.list_approved도 기본적으로 빈 목록으로 patch해둔다 -
    db가 더미 object()라 실제 Firestore 호출은 무엇이든 터진다. 유저 제보 병합
    동작 자체를 검증하는 테스트는 개별적으로 return_value를 바꿔 재-patch한다.
    """
    certifications_module._cache["certs"] = None
    certifications_module._cache["at"] = 0.0
    app.dependency_overrides[get_firestore_client] = lambda: object()
    with patch("app.firestore.user_certification_repo.list_approved", return_value=[]):
        yield
    certifications_module._cache["certs"] = None
    certifications_module._cache["at"] = 0.0
    app.dependency_overrides.clear()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# --- filter_certifications (순수 함수) ---------------------------------------


class TestFilterCertifications:
    def test_no_filters_returns_all(self) -> None:
        assert certifications_module.filter_certifications(_CERTS) == _CERTS

    def test_scope_filter(self) -> None:
        result = certifications_module.filter_certifications(_CERTS, scope="international")
        assert [c["name"] for c in result] == ["CFA"]

    def test_q_filter_matches_normalized_substring(self) -> None:
        result = certifications_module.filter_certifications(_CERTS, q="정보처리")
        assert [c["name"] for c in result] == ["정보처리기사"]

    def test_q_filter_ignores_case_and_punctuation(self) -> None:
        result = certifications_module.filter_certifications(_CERTS, q="  cfa  ")
        assert [c["name"] for c in result] == ["CFA"]

    def test_q_and_scope_combine_to_empty(self) -> None:
        result = certifications_module.filter_certifications(
            _CERTS, q="cfa", scope="domestic_national"
        )
        assert result == []


# --- GET /api/certifications ---------------------------------------------


@pytest.mark.asyncio
async def test_search_returns_all_without_filters() -> None:
    with patch("app.firestore.certification_repo.list_all", return_value=_CERTS):
        async with _client() as client:
            resp = await client.get("/api/certifications")
    assert resp.status_code == 200
    body = resp.json()
    assert [c["name"] for c in body] == ["정보처리기사", "CFA"]
    # 큐레이션/공식 자격증은 저장된 필드가 없어도 verified=True로 계산돼 내려간다.
    assert all(c["verified"] is True for c in body)


@pytest.mark.asyncio
async def test_search_merges_approved_user_certification_as_unverified() -> None:
    user_cert = {
        "jmcd": "",
        "name": "사내 데이터분석 자격",
        "name_norm": "사내데이터분석자격",
        "issuer": "제보자 본인",
        "scope": "",
        "cert_class": "",
        "tier": "",
        "official_url": "https://example.com/cert",
        "schedule": None,
        "source_type": "user_submitted",
        "verified": False,
    }
    with (
        patch("app.firestore.certification_repo.list_all", return_value=_CERTS),
        patch("app.firestore.user_certification_repo.list_approved", return_value=[user_cert]),
    ):
        async with _client() as client:
            resp = await client.get("/api/certifications")
    assert resp.status_code == 200
    body = resp.json()
    names = {c["name"]: c for c in body}
    assert "사내 데이터분석 자격" in names
    submitted = names["사내 데이터분석 자격"]
    assert submitted["verified"] is False
    assert submitted["sourceType"] == "user_submitted"
    assert "submitterUid" not in submitted


@pytest.mark.asyncio
async def test_search_filters_by_q() -> None:
    with patch("app.firestore.certification_repo.list_all", return_value=_CERTS):
        async with _client() as client:
            resp = await client.get("/api/certifications", params={"q": "정보처리"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "정보처리기사"
    assert data[0]["jmcd"] == "1320"
    assert data[0]["schedule"] == {"impl_yy": "2026"}


@pytest.mark.asyncio
async def test_search_filters_by_scope() -> None:
    with patch("app.firestore.certification_repo.list_all", return_value=_CERTS):
        async with _client() as client:
            resp = await client.get("/api/certifications", params={"scope": "international"})
    assert resp.status_code == 200
    assert [c["name"] for c in resp.json()] == ["CFA"]


@pytest.mark.asyncio
async def test_search_caches_list_all_across_calls() -> None:
    """TTL 캐시 - 같은 프로세스에서 연속 호출해도 list_all은 한 번만 불린다."""
    with patch("app.firestore.certification_repo.list_all", return_value=_CERTS) as mock_list:
        async with _client() as client:
            await client.get("/api/certifications")
            await client.get("/api/certifications")
    assert mock_list.call_count == 1


# --- GET /api/certifications/by-career ------------------------------------


@pytest.mark.asyncio
async def test_by_career_returns_matching_document() -> None:
    doc = {
        "name": "회계/세무 전문가",
        "certs": [{"name": "공인회계사(CPA)", "tier": "필수", "cert_id": "cert-공인회계사cpa"}],
    }
    with patch("app.firestore.certification_repo.get_career_path", return_value=doc) as mock_get:
        async with _client() as client:
            resp = await client.get(
                "/api/certifications/by-career", params={"career": "회계/세무 전문가"}
            )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "회계/세무 전문가"
    assert body["certs"][0]["certId"] == "cert-공인회계사cpa"
    # 슬러그(정규화된 이름)로 조회했는지 확인 - '/' 등 구두점이 빠져야 한다.
    mock_get.assert_called_once()
    called_slug = mock_get.call_args[0][1]
    assert "/" not in called_slug


@pytest.mark.asyncio
async def test_by_career_unknown_returns_404() -> None:
    with patch("app.firestore.certification_repo.get_career_path", return_value=None):
        async with _client() as client:
            resp = await client.get(
                "/api/certifications/by-career", params={"career": "존재하지않는진로"}
            )
    assert resp.status_code == 404
