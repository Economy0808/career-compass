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

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore import follow_repo, notification_repo, user_repo
from app.firestore.client import get_firestore_client
from app.firestore.follow_repo import SelfFollowError
from app.schemas.profiles import ProfileOut, ProfilePatchIn

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
    """본인 프로필(표시 이름/아바타/소개) 부분 갱신."""
    profile = user_repo.update_profile(
        db,
        user.uid,
        display_name=payload.display_name,
        avatar_emoji=payload.avatar_emoji,
        bio=payload.bio,
    )
    return _to_out(user.uid, profile, is_following=None)


@router.post("/{uid}/follow", response_model=ProfileOut, response_model_exclude_none=True)
async def follow_user(
    uid: str,
    user: DecodedToken = Depends(get_current_user),
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
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("profile-follow", limit=30)),
) -> ProfileOut:
    """uid에 대한 팔로우를 해제한다. 응답은 갱신된 uid의 공개 프로필."""
    follow_repo.unfollow(db, user.uid, uid)
    profile = user_repo.get_user_profile(db, uid)
    if profile is None:
        raise _PROFILE_NOT_FOUND
    return _to_out(uid, profile, is_following=False)
