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

from fastapi import APIRouter, Depends
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.domain.notification import Notification
from app.firestore import notification_repo
from app.firestore.client import get_firestore_client
from app.schemas.notifications import NotificationListOut, NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _to_out(notification: Notification) -> NotificationOut:
    return NotificationOut(
        id=notification.id,
        actor_uid=notification.actor_uid,
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
    """로그인한 사용자가 받은 알림을 최신순 최대 30개와, 전체 미읽음 개수와 함께 반환한다. 익명 401."""
    items, unread_count = notification_repo.list_notifications(db, user.uid)
    return NotificationListOut(items=[_to_out(n) for n in items], unread_count=unread_count)


@router.post("/read-all", status_code=204)
async def mark_all_read(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    """로그인한 사용자가 받은 미읽음 알림을 전부 읽음 처리한다. 익명 401."""
    notification_repo.mark_all_read(db, user.uid)
