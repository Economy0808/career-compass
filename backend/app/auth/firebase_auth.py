"""Firebase ID 토큰 검증 + 연세대 인증(yonsei_verified) 커스텀 클레임 관리.

이 모듈은 firebase_admin(Admin SDK)을 직접 다루는 유일한 계층이다. HTTP 관심사
(401/403, Authorization 헤더 파싱)는 여기서 다루지 않고 app/auth/deps.py로
넘긴다 - 이 모듈은 FastAPI를 몰라도 되고, deps.py는 firebase_admin의 예외 계층을
몰라도 되게 하기 위한 경계다.

## 앱 초기화를 Firestore 클라이언트에 위임하는 이유

firebase_admin은 프로세스당 App을 하나만 등록할 수 있다. app/firestore/client.py
가 이미 그 App을 초기화하는 로직(_EmulatorCredential 트릭 포함 - 에뮬레이터
환경에서 credentials.ApplicationDefault()가 실제 GCP 인증 부재로 죽는 문제를
우회)을 갖고 있으므로, 이 모듈은 그 로직을 재구현하지 않고 get_firestore_client()
를 한 번 호출해 그 부수효과(App 등록)만 얻어 쓴다(반환된 Firestore Client 자체는
쓰지 않는다).

참고로 firebase_admin의 Auth 모듈은 Firestore 클라이언트와 달리
FIREBASE_AUTH_EMULATOR_HOST 환경변수를 "직접" 인식한다(firebase_admin/_token_gen.py,
_user_mgt.py가 이 환경변수를 보고 자동으로 에뮬레이터의 비보안 서명 경로로
전환한다) - 그래서 Auth 쪽에는 _EmulatorCredential류의 별도 우회가 필요 없다.
다만 App 자체를 초기화할 "자격 증명 객체"는 여전히 필요해서(에뮬레이터 감지와
무관하게 initialize_app에 뭔가는 넘겨야 함) 위 위임이 필요하다. 이 커플링(Auth
모듈이 Firestore 에뮬레이터 host 유무에 암묵적으로 의존)은 report에도 남겨둔다 -
지금은 두 에뮬레이터를 항상 같이 띄우는 워크플로우(firebase emulators:exec
--only auth,firestore)라 문제가 없지만, 나중에 Auth만 단독으로 띄워 테스트하고
싶어지면 이 결합을 풀어야 한다.
"""

from __future__ import annotations

from typing import Any

from firebase_admin import auth as fb_auth
from firebase_admin.exceptions import FirebaseError
from pydantic import BaseModel

from app.firestore.client import get_firestore_client

_YONSEI_ROOT_DOMAIN = "yonsei.ac.kr"


class DecodedToken(BaseModel):
    """검증된 Firebase ID 토큰에서 뽑아낸, 이 백엔드가 실제로 쓰는 필드만 담은 모델.

    firebase_admin.auth.verify_id_token()이 반환하는 raw dict를 호출부까지 그대로
    흘려보내지 않는 이유: dict는 오타 나는 키를 런타임까지 잡아주지 못하고, JWT의
    모든 표준 클레임(iss/aud/exp/iat/sub/auth_time 등)까지 그대로 노출해 호출부가
    실수로 "검증되지 않은 의미"의 필드에 의존하게 만들기 쉽다. 이 모델은 실제로
    필요한 필드만 노출해 타입 안전성과 최소 노출을 함께 확보한다.
    """

    uid: str
    email: str | None = None
    email_verified: bool = False
    yonsei_verified: bool = False


class FirebaseAuthError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스.

    firebase_admin이 던지는 예외(firebase_admin.exceptions.FirebaseError 계열)를
    이 계층 밖(의존성/라우터)으로 그대로 흘려보내지 않기 위한 경계다 - 호출부는
    firebase_admin의 예외 클래스 이름이나 계층 구조를 몰라도 되고, 이 모듈 하나만
    보면 무엇을 except해야 하는지 알 수 있다.
    """


class InvalidTokenError(FirebaseAuthError):
    """토큰이 형식/서명/발급자(issuer/audience) 등 어떤 이유로든 유효하지 않을 때.

    "만료"도 넓은 의미로는 유효하지 않은 토큰의 한 종류이지만, 별도로 구분하고
    싶은 호출부를 위해 ExpiredTokenError를 서브클래스로 분리했다(아래 참고).
    """


class ExpiredTokenError(InvalidTokenError):
    """토큰이 형식적으로는 정상이지만 만료 시각이 지났을 때.

    InvalidTokenError의 서브클래스로 둔 이유: 구분 없이 처리하고 싶은 호출부는
    InvalidTokenError 하나만 except해도 되고, "만료면 프론트에 조용히 토큰 갱신을
    유도, 그 외 위조/변조면 강제 로그아웃"처럼 구분이 필요한 호출부는
    ExpiredTokenError를 먼저 except하면 된다.
    """


class RevokedTokenError(InvalidTokenError):
    """토큰 자체는 발급될 당시 유효했지만 이후 서버에서 명시적으로 폐기됐을 때.

    기본적으로 verify_id_token(check_revoked=False)는 이 경로를 타지 않는다 -
    revoke 여부 확인은 매 요청마다 Firebase Auth에 추가 네트워크 호출을 하므로,
    필요한 호출부만 check_revoked=True로 명시적으로 켜도록 했다(아래 함수 참고).
    """


class UserNotFoundError(FirebaseAuthError):
    """지정한 uid의 Firebase Auth 유저가 존재하지 않을 때."""


def _ensure_app_initialized() -> None:
    """firebase_admin 앱이 아직 초기화 안 됐으면 초기화한다. 모듈 상단 docstring 참고."""
    get_firestore_client()


def verify_id_token(token: str, *, check_revoked: bool = False) -> DecodedToken:
    """Bearer ID 토큰을 Admin SDK로 검증하고 DecodedToken으로 변환한다.

    firebase_admin이 던질 수 있는 예외(ExpiredIdTokenError/RevokedIdTokenError/
    InvalidIdTokenError/그 외 FirebaseError/빈 문자열에 대한 ValueError)를 전부
    이 모듈의 타입 예외로 변환해서 던진다.

    check_revoked=True로 켜면 서명 검증 외에 "이 토큰이 이후 명시적으로 폐기됐는가"
    까지 Firebase Auth에 실시간으로 물어본다 - 정확도는 올라가지만 매 요청마다
    네트워크 호출이 하나 더 붙는다. 기본값을 False로 둔 이유: 옛 세션 시스템도
    "즉시 로그아웃"을 강제하는 기능이 없었고(만료 시각까지만 유효), 대부분의 읽기
    경로에서 이 정도 지연을 감수할 이유가 없다고 판단했다. revoke 즉시 반영이
    중요한 특정 엔드포인트(계정 탈퇴 직후 등)가 생기면 그 호출부만 check_revoked=True
    로 켜면 된다.
    """
    _ensure_app_initialized()
    try:
        claims = fb_auth.verify_id_token(token, check_revoked=check_revoked)
    except fb_auth.ExpiredIdTokenError as exc:
        raise ExpiredTokenError("ID 토큰이 만료되었습니다.") from exc
    except fb_auth.RevokedIdTokenError as exc:
        raise RevokedTokenError("ID 토큰이 폐기(revoke)되었습니다.") from exc
    except fb_auth.InvalidIdTokenError as exc:
        raise InvalidTokenError(f"ID 토큰이 유효하지 않습니다: {exc}") from exc
    except (FirebaseError, ValueError) as exc:
        raise InvalidTokenError(f"ID 토큰 검증 중 오류가 발생했습니다: {exc}") from exc

    return DecodedToken(
        uid=claims["uid"],
        email=claims.get("email"),
        email_verified=bool(claims.get("email_verified", False)),
        yonsei_verified=bool(claims.get("yonsei_verified", False)),
    )


def grant_yonsei_verified(uid: str) -> None:
    """yonsei_verified=True 커스텀 클레임을 부여하되 기존 클레임은 보존한다.

    set_custom_user_claims는 클레임 dict "전체"를 덮어쓴다 - 부분 병합이 아니다.
    그래서 반드시 읽기(auth.get_user로 현재 클레임 조회) -> 수정(딕셔너리에 키 추가)
    -> 쓰기(set_custom_user_claims) 순서를 지켜야 한다. 이 순서를 건너뛰고 바로
    {"yonsei_verified": True}만 써버리면, 이 함수를 호출하는 순간 그 유저에게 걸려
    있던 다른 커스텀 클레임(예: 향후 추가될 관리자 권한 플래그)이 통째로 사라진다.
    """
    _ensure_app_initialized()
    try:
        user = fb_auth.get_user(uid)
    except fb_auth.UserNotFoundError as exc:
        raise UserNotFoundError(f"Firebase Auth에 uid={uid} 유저가 존재하지 않습니다.") from exc
    claims: dict[str, Any] = dict(user.custom_claims or {})
    claims["yonsei_verified"] = True
    fb_auth.set_custom_user_claims(uid, claims)


def get_live_yonsei_verified(uid: str) -> bool:
    """Firebase Auth에서 uid의 커스텀 클레임을 실시간으로 조회해 yonsei_verified 여부를 반환한다.

    app/auth/deps.py의 require_yonsei_verified가 "토큰 안의 claim이 stale할 수
    있다"는 문제(모듈 상단 docstring 및 deps.py 참고)에 대한 폴백으로 쓴다. 유저가
    존재하지 않으면(삭제된 계정 등) 안전 측(False)으로 처리한다 - 존재하지 않는
    유저에게 권한을 준 적이 있다고 볼 이유가 없다.
    """
    _ensure_app_initialized()
    try:
        user = fb_auth.get_user(uid)
    except fb_auth.UserNotFoundError:
        return False
    claims = user.custom_claims or {}
    return bool(claims.get("yonsei_verified", False))


def is_yonsei_email(email: str) -> bool:
    """이메일 도메인이 연세대 소속(yonsei.ac.kr 또는 그 서브도메인)인지 판정한다.

    순수 함수 - Firebase Admin SDK를 호출하지 않는다.

    방어적으로 짜야 하는 이유(공격 사례):
    - "user@evilyonsei.ac.kr": 문자열 "evilyonsei.ac.kr"은 "yonsei.ac.kr"로
      "끝나기는" 하지만 그 앞에 도메인 레이블 경계(점)가 없다. 순진하게
      domain.endswith("yonsei.ac.kr")로 짜면 통과시켜버린다.
    - "user@yonsei.ac.kr.attacker.com": "yonsei.ac.kr"이라는 부분 문자열을
      포함할 뿐 실제 등록 도메인은 attacker.com이다. "yonsei.ac.kr" in email
      같은 부분 일치로 짜면 통과시켜버린다.
    두 경우 모두 "@" 뒤를 분리한 domain 전체에 대해 "yonsei.ac.kr과 완전히
    같거나, .yonsei.ac.kr로 끝나는가"만 확인하면(레이블 경계 강제) 정확히
    거부된다.

    서브도메인 허용 결정: 서브도메인(예: o365.yonsei.ac.kr - 학교 Office365 메일
    시스템)은 허용하기로 결정했다. 연세대가 실제로 운영하는 하위 시스템 메일도
    유효한 학교 메일로 보는 것이 합리적이고, *.yonsei.ac.kr 서브도메인을 발급할
    수 있는 주체는 yonsei.ac.kr DNS 관리자(즉 학교)뿐이라 evilyonsei.ac.kr류의
    위조 위험과는 질적으로 다르다(DNS 위임 없이는 제3자가 만들 수 없는 이름이다).
    """
    normalized = email.strip().lower()
    if normalized.count("@") != 1:
        return False
    local, _, domain = normalized.partition("@")
    if not local or not domain:
        return False
    return domain == _YONSEI_ROOT_DOMAIN or domain.endswith(f".{_YONSEI_ROOT_DOMAIN}")


def maybe_auto_grant_yonsei(uid: str, email: str | None, email_verified: bool) -> bool:
    """경로 A(학교 메일 회원가입) 전용: 조건을 만족하면 yonsei_verified를 자동 부여한다.

    email_verified가 False면 이메일이 진짜 그 유저의 것인지 Firebase가 아직 확인
    하지 못한 상태이므로 절대 부여하지 않는다 - 그러지 않으면 인증 메일을 확인하지
    않고도 @yonsei.ac.kr 주소를 자칭 입력하는 것만으로 인증을 받아갈 수 있다.
    email이 None이거나 연세대 도메인이 아니면 경로 B(학생증 심사)로 유도하기 위해
    역시 부여하지 않는다.

    반환값은 실제로 부여했는지 여부다 - 호출부(회원가입 핸들러, 이 브리핑의 범위
    밖)가 "자동 인증됨" 안내를 보여줄지 판단하는 데 쓸 수 있다.
    """
    if not email_verified or email is None or not is_yonsei_email(email):
        return False
    grant_yonsei_verified(uid)
    return True
