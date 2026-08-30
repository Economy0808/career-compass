"""비밀번호 해싱, 세션 토큰, 인증 코드 생성 유틸.

- 비밀번호: Argon2id (argon2-cffi 기본 파라미터).
- 세션 토큰: opaque 랜덤 문자열. DB에는 SHA-256 해시만 저장한다 —
  DB가 유출돼도 쿠키로 재사용할 수 있는 원본 토큰은 남지 않는다.
- 인증 코드: 6자리 숫자, 역시 해시로만 저장.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Response

from app.config import Settings

SESSION_COOKIE = "cc_session"

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_matches(token: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_token(token), token_hash)


def new_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def session_expiry(settings: Settings, now: datetime | None = None) -> datetime:
    return (now or datetime.now()) + timedelta(days=settings.session_max_age_days)


def verification_expiry(settings: Settings, now: datetime | None = None) -> datetime:
    return (now or datetime.now()) + timedelta(minutes=settings.email_verification_ttl_minutes)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=settings.session_max_age_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")
