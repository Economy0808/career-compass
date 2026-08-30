"""알림함(Notification) API - 새 팔로워·좋아요·댓글 3종 (prefix /api/notifications).

발행 알림은 사용자 확정 스펙에서 명시적으로 제외한다(app/domain/notification.py
모듈 docstring 참고). actor_uid만 내려주면 프로필은 이미 로그인 사용자에게
공개돼 있으므로(app/api/profiles.py) 프론트가 미팔로우 상태에서도 상대 프로필로
바로 이동할 수 있다 - 이 라우터는 그 이상의 별도 작업이 필요 없다.

알림 생성 훅(팔로우/좋아요/댓글) 자체는 이 라우터가 아니라 각 행동의 라우터
(app/api/profiles.py의 follow_user, app/api/posts.py의 like_post/create_comment)에
있다 - 훅 실패가 본 동작을 막지 않도록 그쪽에서 개별적으로 try/except한다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.domain.notification import Notification
from app.firestore import notification_repo, user_repo
from app.firestore.client import get_firestore_client
from app.schemas.notifications import NotificationActorOut, NotificationListOut, NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _to_out(notification: Notification, actor_profile: dict[str, Any] | None) -> NotificationOut:
    display_name = (actor_profile or {}).get("display_name")
    avatar_emoji = (actor_profile or {}).get("avatar_emoji")
    # follow_repo._bump_count가 팔로우/팔로잉 카운트만 담은 users/{uid} 문서를
    # 만들 수 있다(app/firestore/follow_repo.py 모듈 docstring) - 그런 문서는
    # get_profiles 기준으로는 "존재"하지만 표시할 정보가 없으므로, display_name/
    # avatar_emoji가 둘 다 없으면 "프로필 없음"과 동일하게 actor 자체를 생략한다.
    actor = (
        None
        if display_name is None and avatar_emoji is None
        else NotificationActorOut(display_name=display_name, avatar_emoji=avatar_emoji)
    )
    return NotificationOut(
        id=notification.id,
        actor_uid=notification.actor_uid,
        actor=actor,
        type=notification.type,
        post_id=notification.post_id,
        created_at=notification.created_at,
        read=notification.read,
    )


@router.get("", response_model=NotificationListOut, response_model_exclude_none=True)
async def list_notifications(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> NotificationListOut:
    """로그인한 사용자가 받은 알림을 최신순 최대 30개와, 전체 미읽음 개수와 함께 반환한다. 익명 401.

    항목마다 actor 프로필(표시 이름/아바타)을 동봉한다 - 프론트가 "OO님이
    회원님을 팔로우해요"류 문구를 그리려고 알림 30건마다 따로 프로필을 조회하는
    N+1을 피하려는 목적이다(user_repo.get_profiles docstring 참고, 중복 actor는
    한 번만 조회한다).
    """
    items, unread_count = notification_repo.list_notifications(db, user.uid)
    actor_profiles = user_repo.get_profiles(db, [n.actor_uid for n in items])
    return NotificationListOut(
        items=[_to_out(n, actor_profiles.get(n.actor_uid)) for n in items],
        unread_count=unread_count,
    )


@router.post("/read-all", status_code=204)
async def mark_all_read(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    """로그인한 사용자가 받은 미읽음 알림을 전부 읽음 처리한다. 익명 401."""
    notification_repo.mark_all_read(db, user.uid)
