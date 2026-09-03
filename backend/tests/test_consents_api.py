"""/api/consents API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_profiles_api.py와 동일한 이유로 Firebase Auth 에뮬레이터 대신
app.dependency_overrides로 인증을 대체한다(이 스위트가 검증하려는 대상은
리포지토리/라우터 로직이지 토큰 검증 자체가 아니다). 스킵 가드/authed_as
픽스처도 그 파일을 그대로 복사한 관례다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_consents_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.config import get_settings
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
    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


_CURRENT_VERSION = "2026-09-04-v1"


@pytest.mark.asyncio
async def test_get_overseas_consent_requires_auth() -> None:
    async with _client() as client:
        resp = await client.get("/api/consents/overseas")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_overseas_consent_defaults_to_not_consented(
    authed_as: Callable[[str], None],
) -> None:
    """동의 기록이 아예 없는 유저(user_private 문서 없음)는 consented=false."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/consents/overseas")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"consented": False, "currentVersion": _CURRENT_VERSION}


@pytest.mark.asyncio
async def test_post_then_get_reflects_consented_true(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        post_resp = await client.post("/api/consents/overseas", json={"version": _CURRENT_VERSION})
        assert post_resp.status_code == 200
        assert post_resp.json() == {"consented": True, "currentVersion": _CURRENT_VERSION}

        get_resp = await client.get("/api/consents/overseas")
        assert get_resp.status_code == 200
        assert get_resp.json() == {"consented": True, "currentVersion": _CURRENT_VERSION}


@pytest.mark.asyncio
async def test_post_stale_version_returns_422_and_does_not_record(
    authed_as: Callable[[str], None],
) -> None:
    """구 판본으로 동의를 제출하면 422 - 그리고 그 시도 자체가 기록되면 안 된다."""
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post("/api/consents/overseas", json={"version": "2026-01-01-v0"})
        assert resp.status_code == 422

        get_resp = await client.get("/api/consents/overseas")
        assert get_resp.json()["consented"] is False


@pytest.mark.asyncio
async def test_current_version_reflects_settings_override(
    authed_as: Callable[[str], None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """settings.current_overseas_consent_version이 바뀌면 응답의 currentVersion도 따라간다."""
    monkeypatch.setattr(get_settings(), "current_overseas_consent_version", "2099-01-01-v9")
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/consents/overseas")
    assert resp.json() == {"consented": False, "currentVersion": "2099-01-01-v9"}
