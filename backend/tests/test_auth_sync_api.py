"""POST /api/auth/sync 통합 테스트 - 실제 Firebase Auth + Firestore 에뮬레이터를 상대로 실행한다.

test_firebase_auth.py와 동일한 이유로 dependency_overrides를 쓰지 않는다: 이
엔드포인트가 실제로 검증하려는 대상 중 하나가 "진짜 서명된 ID 토큰이 실제
검증 경로(app.auth.deps.get_current_user)를 통과하는가"이기 때문이다(특히
stale-claim 회귀 케이스는 override로는 애초에 재현이 불가능하다 - override는
토큰 발급 시점의 claim 스냅샷이라는 개념 자체가 없다).

FIREBASE_AUTH_EMULATOR_HOST와 FIRESTORE_EMULATOR_HOST가 모두 없으면(또는
응답하지 않으면) 이 파일의 모든 테스트를 스킵한다.

실행 방법 (repo 루트에서):
    firebase emulators:exec --only auth,firestore --project demo-ourlab \
        "backend/.venv/Scripts/python.exe -m pytest backend/tests/test_auth_sync_api.py -q"
"""

from __future__ import annotations

import os

import pytest
import requests
from firebase_admin import auth as fb_auth
from httpx import ASGITransport, AsyncClient

from app.firestore.client import get_firestore_client
from app.main import app
from tests.firebase_utils import mint_id_token


def _emulator_available() -> bool:
    """두 에뮬레이터(Auth, Firestore)가 모두 설정돼 있고 응답하는지 확인한다."""
    auth_host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    firestore_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not auth_host or not firestore_host:
        return False
    try:
        requests.get(f"http://{auth_host}/", timeout=2)
        requests.get(f"http://{firestore_host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIREBASE_AUTH_EMULATOR_HOST/FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 "
        "에뮬레이터가 응답하지 않음 - firebase emulators:exec --only auth,firestore "
        "--project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _ensure_firebase_app() -> None:
    """test_firebase_auth.py와 동일한 이유(모듈 docstring 참고) - 이 테스트 파일이
    fb_auth.create_user 등을 직접 호출하기 전에 firebase_admin 앱 초기화를 보장한다."""
    get_firestore_client()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _get_user_doc(uid: str) -> dict | None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 읽는다 (테스트 검증 전용)."""
    snapshot = get_firestore_client().collection("users").document(uid).get()
    return snapshot.to_dict() if snapshot.exists else None


# --- 인증 실패 ---


async def test_sync_without_auth_header_returns_401() -> None:
    async with _client() as client:
        resp = await client.post("/api/auth/sync", json={})
        assert resp.status_code == 401


async def test_sync_with_garbage_token_returns_401() -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync",
            json={},
            headers={"Authorization": "Bearer this-is-not-a-real-jwt"},
        )
        assert resp.status_code == 401


# --- yonsei_verified 3단 판정 ---


async def test_sync_grants_yonsei_for_verified_school_email() -> None:
    uid = "sync-uid-1"
    fb_auth.create_user(uid=uid, email="s@yonsei.ac.kr", email_verified=True)
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200
    assert resp.json()["yonseiVerified"] is True

    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("yonsei_verified") is True


async def test_sync_denies_yonsei_for_unverified_school_email() -> None:
    uid = "sync-uid-2"
    fb_auth.create_user(uid=uid, email="s@yonsei.ac.kr", email_verified=False)
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200
    assert resp.json()["yonseiVerified"] is False
    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("yonsei_verified") is not True


async def test_sync_denies_yonsei_for_verified_non_school_email() -> None:
    uid = "sync-uid-3"
    fb_auth.create_user(uid=uid, email="s@gmail.com", email_verified=True)
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200
    assert resp.json()["yonseiVerified"] is False


async def test_sync_reflects_stale_token_via_live_lookup() -> None:
    """핵심 회귀 케이스: 토큰 발급 '이후'에 학생증 심사로 승인된 stale-claim 상황.

    maybe_auto_grant_yonsei는 이메일 조건만 보므로 gmail 유저를 절대 자동
    부여하지 않는다 - 이 케이스가 통과하려면 get_live_yonsei_verified 폴백이
    실제로 동작해야 한다.
    """
    uid = "sync-uid-4"
    fb_auth.create_user(uid=uid, email="s@gmail.com", email_verified=True)
    token = mint_id_token(uid)  # yonsei_verified 클레임이 아직 없는 상태로 발급

    fb_auth.set_custom_user_claims(uid, {"yonsei_verified": True})  # 발급 이후 승인

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200
    assert resp.json()["yonseiVerified"] is True


# --- 프로필 upsert ---


async def test_sync_persists_profile_fields_to_firestore() -> None:
    uid = "sync-uid-5"
    fb_auth.create_user(uid=uid, email="s@gmail.com", email_verified=True)
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync",
            json={"displayName": "이경재", "avatarEmoji": "🧭", "consent": True},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200

    doc = _get_user_doc(uid)
    assert doc is not None
    assert doc["display_name"] == "이경재"
    assert doc["avatar_emoji"] == "🧭"
    assert doc.get("consent_at") is not None
    assert doc.get("created_at") is not None
    assert doc.get("updated_at") is not None


async def test_sync_twice_keeps_created_at_and_consent_at_stable() -> None:
    uid = "sync-uid-6"
    fb_auth.create_user(uid=uid, email="s@gmail.com", email_verified=True)
    token = mint_id_token(uid)

    async with _client() as client:
        resp1 = await client.post(
            "/api/auth/sync",
            json={"displayName": "이경재", "avatarEmoji": "🧭", "consent": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp1.status_code == 200
        first_doc = _get_user_doc(uid)
        assert first_doc is not None

        resp2 = await client.post(
            "/api/auth/sync",
            json={"displayName": "이경재2", "consent": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200

    second_doc = _get_user_doc(uid)
    assert second_doc is not None
    assert second_doc["created_at"] == first_doc["created_at"]
    assert second_doc["consent_at"] == first_doc["consent_at"]
    assert second_doc["display_name"] == "이경재2"

    # 커스텀 클레임도 두 번째 호출로 사라지지 않아야 한다.
    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims is not None


async def test_sync_preserves_preexisting_custom_claims() -> None:
    uid = "sync-uid-7"
    fb_auth.create_user(uid=uid, email="s@yonsei.ac.kr", email_verified=True)
    fb_auth.set_custom_user_claims(uid, {"beta_tester": True})
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200

    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("beta_tester") is True
    assert claims.get("yonsei_verified") is True


# --- 응답 형태 ---


async def test_sync_response_keys_are_camel_case() -> None:
    uid = "sync-uid-8"
    fb_auth.create_user(uid=uid, email="s@yonsei.ac.kr", email_verified=True)
    token = mint_id_token(uid)

    async with _client() as client:
        resp = await client.post(
            "/api/auth/sync", json={}, headers={"Authorization": f"Bearer {token}"}
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "emailVerified" in data
    assert "yonseiVerified" in data
    assert "email_verified" not in data
    assert "yonsei_verified" not in data
