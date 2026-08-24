"""인증 API: 가입, 이메일 인증, 로그인/로그아웃, 연세대 인증(학교메일/학생증).

보안 노트:
- 모든 DB 접근은 SQLAlchemy ORM 파라미터 바인딩 (raw SQL 없음 → SQLi 차단).
- 로그인 실패는 아이디/비밀번호 어느 쪽이 틀렸는지 구분하지 않는다 (유저 열거 방지).
- 가입 시 중복 409는 UX를 위해 허용 — 아이디/이메일 존재 여부가 노출되는
  트레이드오프는 인지된 결정이다.
- 인증 코드·세션 토큰은 해시로만 저장.
"""

import logging
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.account_deletion import delete_account
from app.core.deps import get_current_user
from app.core.rate_limit import rate_limit
from app.core.security import (
    SESSION_COOKIE,
    clear_session_cookie,
    hash_password,
    hash_token,
    new_session_token,
    new_verification_code,
    session_expiry,
    set_session_cookie,
    token_matches,
    verification_expiry,
    verify_password,
)
from app.core.uploads import detect_image_ext
from app.db import get_db
from app.email import get_email_sender
from app.email.base import EmailSendError
from app.models.account import AuthSession, EmailVerification, StudentCardVerification
from app.models.roadmap import User
from app.schemas.auth import (
    YONSEI_DOMAIN,
    DeleteAccountRequest,
    DetailOut,
    LoginRequest,
    MeOut,
    PasswordResetConfirm,
    PasswordResetRequest,
    SchoolEmailRequest,
    SchoolEmailVerifyRequest,
    SignupRequest,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

logger = logging.getLogger("app.api.auth")

# 존재하지 않는 유저의 로그인 시도에도 해시 검증 1회를 수행해
# 응답 시간으로 계정 존재를 추정하기 어렵게 한다.
_DUMMY_HASH = hash_password("timing-equalizer-not-a-real-password")


def _is_yonsei(email: str) -> bool:
    return email.lower().endswith(YONSEI_DOMAIN)


async def _latest_card(db: AsyncSession, user_id: int) -> StudentCardVerification | None:
    return await db.scalar(
        select(StudentCardVerification)
        .where(StudentCardVerification.user_id == user_id)
        .order_by(StudentCardVerification.created_at.desc(), StudentCardVerification.id.desc())
        .limit(1)
    )


async def _me_out(db: AsyncSession, user: User) -> MeOut:
    card = await _latest_card(db, user.id)
    return MeOut(
        id=user.id,
        username=user.username or "",
        display_name=user.display_name,
        avatar_emoji=user.avatar_emoji,
        email=user.email or "",
        bio=user.bio,
        email_verified=user.email_verified_at is not None,
        yonsei_verified=user.yonsei_verified_at is not None,
        verification_method=user.verification_method,
        card_status=card.status if card else None,
    )


async def _issue_verification(
    db: AsyncSession, user: User, email: str, purpose: str, settings: Settings
) -> None:
    """기존 미사용 코드를 무효화하고 새 코드를 발급·발송한다."""
    stale = (
        await db.scalars(
            select(EmailVerification).where(
                EmailVerification.user_id == user.id,
                EmailVerification.purpose == purpose,
                EmailVerification.consumed_at.is_(None),
            )
        )
    ).all()
    for v in stale:
        v.consumed_at = datetime.now()

    code = new_verification_code()
    db.add(
        EmailVerification(
            user_id=user.id,
            email=email.lower(),
            purpose=purpose,
            code_hash=hash_token(code),
            expires_at=verification_expiry(settings),
        )
    )
    try:
        await get_email_sender().send(
            to=email,
            subject="[Career Compass] 이메일 인증 코드",
            body=f"인증 코드: {code} (10분 안에 입력해주세요)",
        )
    except EmailSendError as exc:
        # 발송 실패는 삼키지 않는다. 이 호출은 commit 앞이므로 가입/재설정
        # 전체가 롤백된다 — 코드가 안 간 계정을 남기지 않으려는 의도된 동작.
        # 다만 500 스택트레이스 대신 원인이 드러나는 502로 바꿔, 유저가
        # 재시도하면 되는 상황인지 알 수 있게 한다.
        logger.error("인증 코드 발송 실패 user_id=%s purpose=%s: %s", user.id, purpose, exc)
        raise HTTPException(
            status_code=502,
            detail="인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.",
        ) from exc


async def _consume_verification(
    db: AsyncSession, user_id: int, purpose: str, code: str, settings: Settings
) -> EmailVerification:
    """코드 검증. 실패 사유는 구분하지 않고 동일한 400을 낸다."""
    generic = HTTPException(status_code=400, detail="인증 코드가 올바르지 않거나 만료되었습니다.")
    verification = await db.scalar(
        select(EmailVerification)
        .where(
            EmailVerification.user_id == user_id,
            EmailVerification.purpose == purpose,
            EmailVerification.consumed_at.is_(None),
        )
        .order_by(EmailVerification.created_at.desc(), EmailVerification.id.desc())
        .limit(1)
    )
    if verification is None or verification.expires_at < datetime.now():
        raise generic
    if verification.attempts >= settings.email_verification_max_attempts:
        raise generic
    verification.attempts += 1
    if not token_matches(code, verification.code_hash):
        await db.commit()  # 실패한 시도 횟수도 저장
        raise generic
    verification.consumed_at = datetime.now()
    return verification


@router.post("/signup", response_model=DetailOut, status_code=201)
async def signup(
    request: SignupRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("signup", limit=3)),
) -> DetailOut:
    email = request.email.lower()
    dup = await db.scalar(
        select(User).where((User.username == request.username) | (User.email == email))
    )
    if dup is not None:
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디 또는 이메일입니다.")

    user = User(
        display_name=request.display_name,
        avatar_emoji=request.avatar_emoji,
        username=request.username,
        email=email,
        password_hash=hash_password(request.password),
    )
    db.add(user)
    await db.flush()
    await _issue_verification(db, user, email, "signup_email", settings)
    await db.commit()
    return DetailOut(detail="인증 코드를 이메일로 보냈어요. 10분 안에 입력해주세요.")


@router.post("/verify-email", response_model=DetailOut)
async def verify_email(
    request: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("verify-email", limit=5)),
) -> DetailOut:
    generic = HTTPException(status_code=400, detail="인증 코드가 올바르지 않거나 만료되었습니다.")
    user = await db.scalar(select(User).where(User.email == request.email.lower()))
    if user is None or user.email_verified_at is not None:
        raise generic
    await _consume_verification(db, user.id, "signup_email", request.code, settings)

    user.email_verified_at = datetime.now()
    # 하이브리드 핵심: 가입 메일이 연세대 도메인이면 학부생 인증까지 동시 완료.
    if _is_yonsei(user.email or ""):
        user.yonsei_verified_at = datetime.now()
        user.verification_method = "school_email"
    await db.commit()
    return DetailOut(detail="이메일 인증이 완료됐어요. 이제 로그인할 수 있어요.")


@router.post("/login", response_model=MeOut)
async def login(
    request: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("login", limit=5)),
) -> MeOut:
    user = await db.scalar(select(User).where(User.username == request.username))
    password_ok = verify_password(
        user.password_hash if user and user.password_hash else _DUMMY_HASH,
        request.password,
    )
    if user is None or not password_ok:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail="이메일 인증을 먼저 완료해주세요.")

    token = new_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=session_expiry(settings),
        )
    )
    await db.commit()
    set_session_cookie(response, token, settings)
    return await _me_out(db, user)


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = await db.scalar(
            select(AuthSession).where(AuthSession.token_hash == hash_token(token))
        )
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now()
            await db.commit()
    clear_session_cookie(response, settings)


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> MeOut:
    return await _me_out(db, user)


@router.post("/password-reset/request", response_model=DetailOut)
async def password_reset_request(
    request: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("password-reset", limit=3)),
) -> DetailOut:
    """비밀번호 재설정 코드 발송. 유저 열거 방지를 위해 존재 여부와 무관하게 동일 응답."""
    email = request.email.lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None:
        await _issue_verification(db, user, email, "password_reset", settings)
        await db.commit()
    # 이메일이 없어도 성공처럼 응답 (계정 존재 노출 방지)
    return DetailOut(detail="해당 이메일로 재설정 코드를 보냈어요 (계정이 있는 경우).")


@router.post("/password-reset/confirm", response_model=DetailOut)
async def password_reset_confirm(
    request: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("password-reset", limit=5)),
) -> DetailOut:
    generic = HTTPException(status_code=400, detail="인증 코드가 올바르지 않거나 만료되었습니다.")
    user = await db.scalar(select(User).where(User.email == request.email.lower()))
    if user is None:
        raise generic
    await _consume_verification(db, user.id, "password_reset", request.code, settings)

    user.password_hash = hash_password(request.new_password)
    # 방어: 기존 세션 전부 폐기 (탈취 대비)
    sessions = (
        await db.scalars(
            select(AuthSession).where(
                AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)
            )
        )
    ).all()
    for s in sessions:
        s.revoked_at = datetime.now()
    await db.commit()
    return DetailOut(detail="비밀번호가 재설정됐어요. 새 비밀번호로 로그인해주세요.")


@router.post("/delete-account", status_code=204)
async def delete_account_endpoint(
    request: DeleteAccountRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("delete-account", limit=5)),
) -> None:
    """회원 탈퇴 (PIPA 삭제권). 비밀번호 재확인 후 모든 데이터를 하드 삭제한다."""
    if not verify_password(user.password_hash or "", request.password):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    await delete_account(db, user)
    clear_session_cookie(response, settings)


@router.post("/school-email/request", response_model=DetailOut)
async def school_email_request(
    request: SchoolEmailRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("school-email", limit=5)),
) -> DetailOut:
    if user.yonsei_verified_at is not None:
        raise HTTPException(status_code=409, detail="이미 연세대 인증이 완료된 계정입니다.")
    await _issue_verification(db, user, request.email, "school_email", settings)
    await db.commit()
    return DetailOut(detail="학교 이메일로 인증 코드를 보냈어요.")


@router.post("/school-email/verify", response_model=DetailOut)
async def school_email_verify(
    request: SchoolEmailVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("school-email", limit=5)),
) -> DetailOut:
    if user.yonsei_verified_at is not None:
        raise HTTPException(status_code=409, detail="이미 연세대 인증이 완료된 계정입니다.")
    await _consume_verification(db, user.id, "school_email", request.code, settings)
    user.yonsei_verified_at = datetime.now()
    user.verification_method = "school_email"
    await db.commit()
    return DetailOut(detail="연세대 학부생 인증이 완료됐어요!")


@router.post("/student-card", response_model=DetailOut, status_code=201)
async def upload_student_card(
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: None = Depends(rate_limit("student-card", limit=3)),
) -> DetailOut:
    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail="이메일 인증을 먼저 완료해주세요.")
    if user.yonsei_verified_at is not None:
        raise HTTPException(status_code=409, detail="이미 연세대 인증이 완료된 계정입니다.")

    # Content-Type은 위조 가능 → 매직 바이트와 크기를 직접 검사한다.
    data = await file.read(settings.student_card_max_bytes + 1)
    if len(data) > settings.student_card_max_bytes:
        raise HTTPException(status_code=413, detail="이미지는 5MB 이하만 올릴 수 있어요.")
    ext = detect_image_ext(data)
    if ext is None:
        raise HTTPException(status_code=422, detail="JPEG 또는 PNG 이미지만 올릴 수 있어요.")

    card_dir = Path(settings.student_card_dir)
    card_dir.mkdir(parents=True, exist_ok=True)
    # 랜덤 파일명: 경로 조작·추측 불가. 원본 파일명은 사용하지 않는다.
    image_path = card_dir / f"{uuid.uuid4().hex}.{ext}"
    image_path.write_bytes(data)

    existing = await _latest_card(db, user.id)
    if existing is not None and existing.status == "pending":
        # 재업로드: 이전 이미지는 즉시 파기 (PIPA 최소 보유)
        if existing.image_path and Path(existing.image_path).exists():
            Path(existing.image_path).unlink()
        existing.image_path = str(image_path)
        existing.created_at = datetime.now()
    else:
        db.add(StudentCardVerification(user_id=user.id, image_path=str(image_path)))
    await db.commit()
    return DetailOut(
        detail="학생증이 접수됐어요. 운영자 승인 후 이용할 수 있어요 (보통 24시간 이내)."
    )


@router.get("/student-card/status", response_model=DetailOut)
async def student_card_status(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> DetailOut:
    card = await _latest_card(db, user.id)
    return DetailOut(detail=card.status if card else "none")
