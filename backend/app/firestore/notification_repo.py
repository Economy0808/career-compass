"""Firestore 기반 알림함 리포지토리.

## 컬렉션 레이아웃

최상위 `notifications` 컬렉션. 문서 id는 post_repo.py의 관례와 동일하게 서버
uuid4다 - 알림은 (recipient, actor, type, post) 조합이 반복될 수 있어(예: 같은
글에 다시 댓글) 관계 하나당 문서 하나(follow_repo.py 관례)로 만들 자연키가 없다.

## 자기-알림 차단은 create_notification 한 곳에서

본인 행위(자기 글 좋아요/댓글, 자기 자신 팔로우)는 알림을 만들지 않는다 -
create_notification이 recipient_uid == actor_uid면 조용히 None을 반환하고 아무
것도 쓰지 않는다. 호출부(app/api/profiles.py, app/api/posts.py) 3곳 모두 이
함수 하나만 거치므로, 각 호출부에서 따로 자기-행위를 판별할 필요가 없다(follow
쪽은 SelfFollowError로 애초에 이 함수까지 오지 않지만, like/comment 쪽은 이
가드가 유일한 방어선이다).

## 정렬/미읽음 집계: 복합 인덱스 없이 파이썬으로

list_notifications는 recipient_uid 등호 필터 하나만 쿼리에 걸고(단일 필드
인덱스는 자동 생성), 정렬(최신순)과 미읽음 개수 집계 둘 다 파이썬에서 한다 -
post_repo.py list_by_owner와 동일한 판단(유저 한 명의 알림이 아직 수백 건
규모까지는 전체 스캔 비용이 무시할 만함, ponytail: 규모가 커지면 read 필드에
쿼리 필터 + 별도 count 쿼리로 승격할 것). mark_all_read도 동일하게 recipient_uid
단일 필터로 전체를 읽어와 파이썬에서 미읽음만 골라 배치 업데이트한다.
"""

from __future__ import annotations

import uuid

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.notification import Notification, NotificationType

_COLLECTION = "notifications"
_LIST_LIMIT = 30


def _collection_ref(db: Client):
    return db.collection(_COLLECTION)


def create_notification(
    db: Client,
    *,
    recipient_uid: str,
    actor_uid: str,
    type: NotificationType,
    created_at: int,
    post_id: str | None = None,
) -> Notification | None:
    """알림 한 건을 만든다. recipient_uid == actor_uid(본인 행위)면 만들지 않고 None."""
    if recipient_uid == actor_uid:
        return None
    notification = Notification(
        id=str(uuid.uuid4()),
        recipient_uid=recipient_uid,
        actor_uid=actor_uid,
        type=type,
        post_id=post_id,
        created_at=created_at,
    )
    _collection_ref(db).document(notification.id).set(notification.model_dump())
    return notification


def list_notifications(
    db: Client, uid: str, limit: int = _LIST_LIMIT
) -> tuple[list[Notification], int]:
    """uid가 받은 알림을 최신순으로 최대 limit개, 그리고 전체(미절단) 미읽음 개수를 함께 반환한다.

    미읽음 개수는 모듈 docstring대로 목록과 같은 쿼리 결과에서 계산한다(별도
    count 쿼리를 추가로 던지지 않음) - limit로 자르기 전 전체 목록 기준이라, 30건
    보다 알림이 많이 쌓인 유저도 배지 숫자가 실제 미읽음 총량을 정확히 반영한다.
    """
    query = _collection_ref(db).where(filter=FieldFilter("recipient_uid", "==", uid))
    all_notifications = [Notification.model_validate(doc.to_dict()) for doc in query.stream()]
    unread_count = sum(1 for n in all_notifications if not n.read)
    all_notifications.sort(key=lambda n: n.created_at, reverse=True)
    return all_notifications[:limit], unread_count


def mark_all_read(db: Client, uid: str) -> None:
    """uid가 받은 미읽음 알림을 전부 읽음 처리한다. 미읽음이 없으면 아무 쓰기도 하지 않는다."""
    query = _collection_ref(db).where(filter=FieldFilter("recipient_uid", "==", uid))
    batch = db.batch()
    pending = 0
    for doc in query.stream():
        data = doc.to_dict() or {}
        if data.get("read"):
            continue
        batch.update(doc.reference, {"read": True})
        pending += 1
    if pending:
        batch.commit()
