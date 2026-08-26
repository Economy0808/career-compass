"""Firebase Auth 검증 계층(app/auth/firebase_auth.py, app/auth/deps.py) 통합 테스트.

Mock을 쓰지 않는 이유는 tests/test_constellation_repo.py와 같다: 이 테스트들이
검증하려는 대상 자체가 "firebase_admin이 실제로 만든/검증한 토큰의 동작"이므로
Mock으로 대체하면 검증하려는 대상이 사라진다.

FIREBASE_AUTH_EMULATOR_HOST가 없거나 에뮬레이터가 응답하지 않으면 이 파일의 모든
테스트를 스킵한다(실패가 아니라 스킵).

실행 방법 (repo 루트에서 - firebase.json이 루트에 있으므로, backend/가 아님):
    firebase emulators:exec --only auth,firestore --project demo-ourlab \
        "backend/.venv/Scripts/python.exe -m pytest backend/tests/test_firebase_auth.py -q"
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099, FIRESTORE_EMULATOR_HOST=localhost:8080이
emulators:exec에 의해 자동으로 export된다. Firestore 에뮬레이터도 함께 띄우는
이유는 app/auth/firebase_auth.py가 firebase_admin 앱 초기화를
app/firestore/client.py의 get_firestore_client()에 위임하기 때문이다(해당 모듈
docstring 참고).
"""

from __future__ import annotations

import os

import pytest
import requests
from fastapi import HTTPException, Request
from firebase_admin import auth as fb_auth

from app.auth import deps
from app.auth.firebase_auth import (
    DecodedToken,
    InvalidTokenError,
    grant_yonsei_verified,
    is_yonsei_email,
    maybe_auto_grant_yonsei,
    verify_id_token,
)
from app.firestore.client import get_firestore_client


def _emulator_available() -> bool:
    """FIREBASE_AUTH_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
    host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
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
        "FIREBASE_AUTH_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only auth,firestore --project demo-ourlab 로 실행할 것"
    ),
)


def _mint_id_token(uid: str) -> str:
    """에뮬레이터 전용: 커스텀 토큰을 만들고 REST로 교환해 진짜 서명된 ID 토큰을 얻는다.

    프로덕션에서는 클라이언트 SDK가 로그인 시 이 과정을 대신 해준다(비밀번호/OAuth
    로그인 -> ID 토큰). 서버 프로세스(Admin SDK)는 애초에 ID 토큰을 직접 발급할
    권한이 없으므로, 에뮬레이터가 제공하는 signInWithCustomToken(서명 검증을
    생략하는 비보안 경로 - 프로덕션 Auth에는 없다)을 빌려 Admin SDK가 만든 커스텀
    토큰을 진짜 ID 토큰으로 교환한다. 이렇게 얻은 ID 토큰은 verify_id_token이 실제
    운영 코드와 동일한 경로로 검증한다.
    """
    custom_token = fb_auth.create_custom_token(uid).decode("utf-8")
    host = os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
    resp = requests.post(
        f"http://{host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
        params={"key": "fake-api-key"},
        json={"token": custom_token, "returnSecureToken": True},
        timeout=5,
    )
    resp.raise_for_status()
    id_token: str = resp.json()["idToken"]
    return id_token


def _make_request(headers: dict[str, str]) -> Request:
    """헤더만 채운 최소 ASGI scope로 Request를 만든다 (실제 서버 없이 의존성 단위 테스트)."""
    encoded = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": encoded})


@pytest.fixture(autouse=True)
def _ensure_firebase_app() -> None:
    """테스트 본문이 firebase_admin.auth를 직접 호출(fb_auth.create_user 등)하는 경우를 위한 준비.

    app/auth/firebase_auth.py의 공개 함수들은 내부에서 _ensure_app_initialized()를
    호출해 스스로 앱 초기화를 보장하지만, 이 테스트 파일이 유저를 만들기 위해 직접
    부르는 fb_auth.create_user/set_custom_user_claims 같은 호출은 그 보장을 거치지
    않는다. 매 테스트 시작 전에 한 번 초기화해 둔다(get_firestore_client()의 부수
    효과 - firebase_auth.py 모듈 docstring 참고).
    """
    get_firestore_client()


# --- is_yonsei_email ---


def test_is_yonsei_email_accepts_yonsei_domain() -> None:
    assert is_yonsei_email("student@yonsei.ac.kr") is True


def test_is_yonsei_email_case_insensitive() -> None:
    assert is_yonsei_email("Student@YONSEI.AC.KR") is True


def test_is_yonsei_email_accepts_documented_subdomain() -> None:
    # o365.yonsei.ac.kr 같은 학교 하위 시스템 메일도 인정하기로 한 결정 (모듈
    # docstring의 "서브도메인 허용 결정" 참고).
    assert is_yonsei_email("student@o365.yonsei.ac.kr") is True


def test_is_yonsei_email_rejects_lookalike_without_dot_boundary() -> None:
    # "evilyonsei.ac.kr".endswith("yonsei.ac.kr")은 True이지만 진짜 연세대 도메인이 아니다.
    assert is_yonsei_email("student@evilyonsei.ac.kr") is False


def test_is_yonsei_email_rejects_domain_with_attacker_suffix() -> None:
    # "yonsei.ac.kr"을 부분 문자열로 포함할 뿐 실제 등록 도메인은 attacker.com이다.
    assert is_yonsei_email("student@yonsei.ac.kr.attacker.com") is False


def test_is_yonsei_email_rejects_non_yonsei_domain() -> None:
    assert is_yonsei_email("student@gmail.com") is False


def test_is_yonsei_email_rejects_malformed_email() -> None:
    assert is_yonsei_email("not-an-email") is False


# --- verify_id_token ---


def test_verify_id_token_accepts_real_emulator_token() -> None:
    uid = "verify-uid-1"
    fb_auth.create_user(uid=uid, email="student@yonsei.ac.kr", email_verified=True)
    token = _mint_id_token(uid)

    decoded = verify_id_token(token)

    assert isinstance(decoded, DecodedToken)
    assert decoded.uid == uid
    assert decoded.email == "student@yonsei.ac.kr"
    assert decoded.email_verified is True
    assert decoded.yonsei_verified is False


def test_verify_id_token_rejects_garbage_token() -> None:
    with pytest.raises(InvalidTokenError):
        verify_id_token("this-is-not-a-real-jwt")


# --- grant_yonsei_verified ---


def test_grant_yonsei_verified_preserves_existing_claims() -> None:
    uid = "grant-uid-1"
    fb_auth.create_user(uid=uid)
    fb_auth.set_custom_user_claims(uid, {"beta_tester": True})

    grant_yonsei_verified(uid)

    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("beta_tester") is True
    assert claims.get("yonsei_verified") is True


# --- maybe_auto_grant_yonsei ---


def test_maybe_auto_grant_yonsei_grants_for_verified_yonsei_email() -> None:
    uid = "auto-grant-uid-1"
    fb_auth.create_user(uid=uid, email="student@yonsei.ac.kr", email_verified=True)

    granted = maybe_auto_grant_yonsei(uid, "student@yonsei.ac.kr", True)

    assert granted is True
    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("yonsei_verified") is True


def test_maybe_auto_grant_yonsei_denies_when_email_not_verified() -> None:
    uid = "auto-grant-uid-2"
    fb_auth.create_user(uid=uid, email="student@yonsei.ac.kr", email_verified=False)

    granted = maybe_auto_grant_yonsei(uid, "student@yonsei.ac.kr", False)

    assert granted is False
    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("yonsei_verified") is not True


def test_maybe_auto_grant_yonsei_denies_for_non_yonsei_email() -> None:
    uid = "auto-grant-uid-3"
    fb_auth.create_user(uid=uid, email="student@gmail.com", email_verified=True)

    granted = maybe_auto_grant_yonsei(uid, "student@gmail.com", True)

    assert granted is False
    claims = fb_auth.get_user(uid).custom_claims or {}
    assert claims.get("yonsei_verified") is not True


# --- deps: get_current_user_optional / get_current_user ---


async def test_get_current_user_optional_returns_none_without_header() -> None:
    request = _make_request({})
    assert await deps.get_current_user_optional(request) is None


async def test_get_current_user_optional_returns_none_for_malformed_header() -> None:
    request = _make_request({"Authorization": "NotBearer sometoken"})
    assert await deps.get_current_user_optional(request) is None


async def test_get_current_user_optional_returns_decoded_token_for_valid_bearer() -> None:
    uid = "deps-uid-1"
    fb_auth.create_user(uid=uid, email="student@yonsei.ac.kr", email_verified=True)
    token = _mint_id_token(uid)
    request = _make_request({"Authorization": f"Bearer {token}"})

    decoded = await deps.get_current_user_optional(request)

    assert decoded is not None
    assert decoded.uid == uid


async def test_get_current_user_raises_401_without_header() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await deps.get_current_user(None)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "로그인이 필요합니다."


async def test_get_current_user_raises_401_for_malformed_header() -> None:
    request = _make_request({"Authorization": "Basic xxx"})
    user = await deps.get_current_user_optional(request)

    with pytest.raises(HTTPException) as exc_info:
        await deps.get_current_user(user)
    assert exc_info.value.status_code == 401


# --- deps: require_yonsei_verified ---


async def test_require_yonsei_verified_raises_403_for_unverified_user() -> None:
    uid = "deps-uid-2"
    fb_auth.create_user(uid=uid, email="student@gmail.com", email_verified=True)
    token = _mint_id_token(uid)
    user = await deps.get_current_user(
        await deps.get_current_user_optional(_make_request({"Authorization": f"Bearer {token}"}))
    )

    with pytest.raises(HTTPException) as exc_info:
        await deps.require_yonsei_verified(user)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "연세대 학부생 인증이 필요합니다."


async def test_require_yonsei_verified_falls_back_to_live_lookup_when_claim_stale() -> None:
    """토큰 발급 '이후'에 grant_yonsei_verified가 호출된 stale-claim 상황을 재현한다.

    require_yonsei_verified의 라이브 조회 폴백(app/auth/deps.py docstring 참고)이
    실제로 동작하는지 확인한다: 토큰 자체에는 아직 yonsei_verified 클레임이 없지만,
    Firebase Auth 쪽 상태는 이미 승인됐으므로 403이 아니라 통과해야 한다.
    """
    uid = "deps-uid-3"
    fb_auth.create_user(uid=uid, email="student@yonsei.ac.kr", email_verified=True)
    token = _mint_id_token(uid)  # yonsei_verified 클레임이 아직 없는 상태로 발급된 토큰
    user = await deps.get_current_user(
        await deps.get_current_user_optional(_make_request({"Authorization": f"Bearer {token}"}))
    )
    assert user.yonsei_verified is False  # 토큰에는 아직 반영 안 됨(stale)

    grant_yonsei_verified(uid)  # 그 사이 승인 처리됨 (예: 학생증 심사 통과)

    verified_user = await deps.require_yonsei_verified(user)
    assert verified_user.yonsei_verified is True
