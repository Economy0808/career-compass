"""공개 프로필 + 팔로우 그래프 API - Firestore 기반 신규 경로 (prefix /api/profiles).

옛 Postgres 기반 /api/users/*(app/api/users.py)가 같은 앱에 살아 있고 프론트
프로필이 아직 그걸 쓰지만, 그 라우터는 건드리지 않는다 - 일정 기능이 계속
의존하므로 끄지 않기로 확정했다(브리핑 참고). 이 라우터는 별도 prefix로 나란히
붙고, 프론트 전환은 별도 작업(F5)에서 이 경로로 갈아탈 때 이루어진다. 구
Postgres 데이터 이전은 없다(테스트 데이터라 폐기 - 사용자 확정).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user, get_current_user_optional, require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.config import get_settings
from app.core.rate_limit import rate_limit
from app.firestore import (
    follow_repo,
    notification_repo,
    student_verification_repo,
    user_private_repo,
    user_repo,
)
from app.firestore.client import get_firestore_client
from app.firestore.follow_repo import SelfFollowError
from app.schemas.profiles import (
    OnboardingStatusOut,
    ProfileOnboardingIn,
    ProfileOnboardingOut,
    ProfileOut,
    ProfilePatchIn,
)
from app.services.profile_embedding import refresh_profile_embedding

router = APIRouter(prefix="/api/profiles", tags=["profiles"])
logger = logging.getLogger(__name__)

_PROFILE_NOT_FOUND = HTTPException(status_code=404, detail="유저를 찾을 수 없어요.")


def _to_out(uid: str, profile: dict[str, Any], *, is_following: bool | None) -> ProfileOut:
    return ProfileOut(
        uid=uid,
        display_name=profile.get("display_name"),
        avatar_emoji=profile.get("avatar_emoji"),
        bio=profile.get("bio"),
        follower_count=profile.get("follower_count", 0),
        following_count=profile.get("following_count", 0),
        is_following=is_following,
    )


@router.get("/{uid}", response_model=ProfileOut, response_model_exclude_none=True)
async def get_profile(
    uid: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> ProfileOut:
    """공개 프로필 조회 - 익명 열람 허용. 없는 uid는 404.

    isFollowing은 요청자가 로그인했고 본인 프로필을 보는 게 아닐 때만 채운다
    (app/api/users.py의 옛 동작과 동일한 의미론).
    """
    profile = user_repo.get_user_profile(db, uid)
    if profile is None:
        raise _PROFILE_NOT_FOUND
    is_following = None
    if user is not None and user.uid != uid:
        is_following = follow_repo.is_following(db, user.uid, uid)
    return _to_out(uid, profile, is_following=is_following)


@router.patch("/me", response_model=ProfileOut, response_model_exclude_none=True)
async def patch_my_profile(
    payload: ProfilePatchIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ProfileOut:
    """본인 프로필(표시 이름/아바타/소개) 부분 갱신.

    bio가 바뀔 때만 프로필 임베딩을 재계산한다(app/services/profile_embedding.py) -
    표시 이름/아바타만 바꾸는 흔한 경우까지 매번 임베딩 API를 부르면 낭비다.
    """
    profile = user_repo.update_profile(
        db,
        user.uid,
        display_name=payload.display_name,
        avatar_emoji=payload.avatar_emoji,
        bio=payload.bio,
    )
    if payload.bio is not None:
        await refresh_profile_embedding(db, user.uid)
    return _to_out(user.uid, profile, is_following=None)


@router.post("/onboarding", response_model=ProfileOnboardingOut, response_model_exclude_none=True)
async def onboard_profile(
    payload: ProfileOnboardingIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ProfileOnboardingOut:
    """가입 직후 확장 프로필 온보딩 - 민감도별로 3개 목적지에 필드를 나눠 쓴다
    (보안 세션이 확정한 PIPA 아키텍처).

    - users/{uid}(전 로그인 유저 read 가능): declared_tags만. 학과·학번·진로
      자유서술은 여기 절대 넣지 않는다(전유저에게 새어나가므로).
    - user_private/{uid}(본인만 read): 학과/학년/복수전공/진로서술/동의시점.
    - student_verifications/{uid}(클라 read 불가): 학번의 HMAC 해시만(원문은
      어디에도 상시저장하지 않는다).

    서비스 이용·개인정보 국외이전 동의는 둘 다 필수라 하나라도 False면 422다
    (마케팅 동의는 선택). declared_tags는 트림·빈 값 제외·중복 제거 후 다시
    1~10개 범위인지 확인한다(스키마 검증은 원시 입력 개수만 본다 - 트림 후
    전부 공백이었다면 원시 개수 검증을 통과해도 실질적으로는 0개가 될 수 있다).

    마지막으로 프로필 임베딩을 재계산한다(declared_tags/career_text가 반영되도록
    - app/domain/constellation.py의 compute_profile_text, app/services/
    profile_embedding.py 참고). 임베딩 실패는 그 서비스 내부에서 이미 삼켜지므로
    온보딩 자체를 막지 않는다.
    """
    if not payload.consents.service:
        raise HTTPException(
            status_code=422,
            detail="서비스 이용 동의가 필요합니다.",
        )

    declared_tags = list(dict.fromkeys(tag.strip() for tag in payload.declared_tags if tag.strip()))
    if not (1 <= len(declared_tags) <= 10):
        raise HTTPException(
            status_code=422, detail="관심사 태그는 1개 이상 10개 이하로 입력해주세요."
        )

    user_repo.set_declared_tags(db, user.uid, declared_tags)
    user_private_repo.set_private_profile(
        db,
        user.uid,
        department=payload.department,
        grade=payload.grade,
        double_major=payload.double_major,
        career_text=payload.career_text,
        consents=payload.consents.model_dump(),
    )
    student_verification_repo.store_student_id_hash(
        db, user.uid, payload.student_id, secret_key=get_settings().secret_key
    )

    await refresh_profile_embedding(db, user.uid)

    profile = user_repo.get_user_profile(db, user.uid) or {}
    out = _to_out(user.uid, profile, is_following=None)
    return ProfileOnboardingOut(**out.model_dump(), onboarding_complete=True)


@router.get("/me/onboarding", response_model=OnboardingStatusOut)
async def get_my_onboarding_status(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> OnboardingStatusOut:
    """본인 온보딩 완료 여부. user_private 문서 존재로 판정한다(온보딩이 그 문서를
    쓰므로). 프론트가 로그인 직후 false면 /onboarding으로 라우팅해 limbo(계정만
    있고 온보딩 미완) 유저를 되돌린다. 경로가 두 세그먼트라 GET /{uid}와 충돌 없음.
    """
    private = user_private_repo.get_private_profile(db, user.uid)
    return OnboardingStatusOut(onboarding_complete=private is not None)


@router.post("/{uid}/follow", response_model=ProfileOut, response_model_exclude_none=True)
async def follow_user(
    uid: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("profile-follow", limit=30)),
) -> ProfileOut:
    """uid를 팔로우한다. 응답은 갱신된 uid의 공개 프로필."""
    try:
        follow_repo.follow(db, user.uid, uid)
    except SelfFollowError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        notification_repo.create_notification(
            db,
            recipient_uid=uid,
            actor_uid=user.uid,
            type="follow",
            created_at=int(datetime.now(UTC).timestamp() * 1000),
        )
    except Exception:  # 알림 생성 실패가 팔로우 자체를 막으면 안 된다.
        logger.warning("follow notification 생성 실패", exc_info=True)
    profile = user_repo.get_user_profile(db, uid)
    if profile is None:
        raise _PROFILE_NOT_FOUND
    return _to_out(uid, profile, is_following=True)


@router.delete("/{uid}/follow", response_model=ProfileOut, response_model_exclude_none=True)
async def unfollow_user(
    uid: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("profile-follow", limit=30)),
) -> ProfileOut:
    """uid에 대한 팔로우를 해제한다. 응답은 갱신된 uid의 공개 프로필."""
    follow_repo.unfollow(db, user.uid, uid)
    profile = user_repo.get_user_profile(db, uid)
    if profile is None:
        raise _PROFILE_NOT_FOUND
    return _to_out(uid, profile, is_following=False)
