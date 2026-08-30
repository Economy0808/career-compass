"""Firestore 기반 DM(다이렉트 메시지) 리포지토리.

## 컬렉션 레이아웃

최상위 `dm_threads` 컬렉션. 문서 id는 참가자 두 uid를 사전순 정렬해 이어붙인
값이다(app/domain/dm.py 모듈 docstring 참고) - follow_repo.py의 "관계당 문서
하나" 관례와 비슷하지만, 방향이 있는 팔로우와 달리 DM은 방향이 없으므로 정렬이
꼭 필요하다(정렬하지 않으면 같은 두 사람 사이에 시작하는 쪽에 따라 다른 방이
생긴다). 메시지는 `dm_threads/{thread_id}/messages/{message_id}` 서브컬렉션이다
(app/firestore/post_repo.py가 posts/{id}/comments를 쓰는 것과 동일한 관례).

## 목록 정렬: array-contains + order_by는 복합 인덱스가 필요하다

list_threads_for는 participant_uids array-contains 필터와 last_message_at
내림차순 정렬을 한 쿼리에 함께 건다. post_repo.py/notification_repo.py가 택한
"등호 필터만 쿼리, 정렬은 파이썬" 방식과 달리 여기서는 쿼리에 정렬을 그대로
맡긴다 - array-contains 결과는 (등호 필터와 달리) 한 유저의 전체 문서 수가 아니라
"그 유저가 참가한 대화방 수"로 이미 작다는 보장이 없어 안전하게 서버 쿼리로
상한(limit)까지 건다. 이 조합(array-contains + 다른 필드 order_by)은 실제
Firestore에서 복합 인덱스가 필요하므로 firestore.indexes.json에 추가했다
(에뮬레이터는 인덱스 없이도 통과하는 경우가 있어 실제로는 프로덕션에서만
드러나는 함정 - 2026-08-30 에뮬레이터 실측으로 쿼리 자체는 인덱스 없이도 통과함을
확인했지만, 프로덕션 배포 시 깨지지 않도록 인덱스는 그대로 선언해 둔다).
"""

from __future__ import annotations

import uuid
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, Transaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.dm import DM_PREVIEW_LEN, DmMessage, DmThread

_THREADS_COLLECTION = "dm_threads"
_MESSAGES_SUBCOLLECTION = "messages"
_THREAD_LIST_LIMIT = 30
_MESSAGE_LIST_LIMIT = 50

__all__ = [
    "get_thread",
    "list_messages",
    "list_threads_for",
    "mark_read",
    "send_message",
    "thread_id_for",
]


def thread_id_for(uid_a: str, uid_b: str) -> str:
    """두 uid로 항상 같은 대화방 id를 만든다 - 사전순 정렬해 이어붙인다.

    누가 먼저 말을 걸었는지와 무관하게 같은 쌍이 같은 문서로 수렴해야 하므로
    (app/domain/dm.py 모듈 docstring) 인자 순서에 의존하지 않는다.
    """
    a, b = sorted((uid_a, uid_b))
    return f"{a}_{b}"


def _thread_doc_ref(db: Client, thread_id: str) -> Any:
    return db.collection(_THREADS_COLLECTION).document(thread_id)


def _messages_collection_ref(db: Client, thread_id: str) -> Any:
    return _thread_doc_ref(db, thread_id).collection(_MESSAGES_SUBCOLLECTION)


def _snapshot_to_thread(snapshot: Any) -> DmThread:
    data = snapshot.to_dict()
    assert data is not None  # 호출부가 snapshot.exists를 이미 확인했다는 전제
    return DmThread.model_validate(data)


def get_thread(db: Client, thread_id: str) -> DmThread | None:
    """대화방 하나를 조회한다. 없으면 None."""
    snapshot = _thread_doc_ref(db, thread_id).get()
    if not snapshot.exists:
        return None
    return _snapshot_to_thread(snapshot)


def list_threads_for(db: Client, uid: str, limit: int = _THREAD_LIST_LIMIT) -> list[DmThread]:
    """uid가 참가 중인 대화방을 최근 메시지순(last_message_at 내림차순)으로 최대 limit개 반환한다."""
    query = (
        db.collection(_THREADS_COLLECTION)
        .where(filter=FieldFilter("participant_uids", "array_contains", uid))
        .order_by("last_message_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [_snapshot_to_thread(doc) for doc in query.stream()]


def send_message(
    db: Client, *, sender_uid: str, peer_uid: str, body: str, created_at: int
) -> DmMessage:
    """sender_uid가 peer_uid에게 메시지를 보낸다. 방이 없으면 새로 만들고, 있으면 이어붙인다.

    자격 검사(팔로잉/팔로워 여부)와 자기 자신 전송 차단은 호출부(app/api/dm.py)의
    책임이다 - 이 함수는 "메시지를 저장하고 대화방 상태를 갱신한다"는 저장소
    책임만 진다(follow_repo.follow가 SelfFollowError를 직접 던지는 것과 달리,
    여기서는 API 계층에서 이미 걸러진 뒤 호출된다는 전제).
    """
    thread_id = thread_id_for(sender_uid, peer_uid)
    thread_ref = _thread_doc_ref(db, thread_id)
    message = DmMessage(
        id=str(uuid.uuid4()), sender_uid=sender_uid, body=body, created_at=created_at
    )
    message_ref = _messages_collection_ref(db, thread_id).document(message.id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        thread_snapshot = thread_ref.get(transaction=transaction)
        # 모든 읽기가 끝난 뒤에야 쓴다 (Firestore 트랜잭션 규칙: 읽기가 쓰기보다 먼저).
        preview = body[:DM_PREVIEW_LEN]
        if thread_snapshot.exists:
            thread = _snapshot_to_thread(thread_snapshot)
            unread = dict(thread.unread)
            unread[peer_uid] = unread.get(peer_uid, 0) + 1
            transaction.update(
                thread_ref,
                {
                    "last_message_at": created_at,
                    "last_message_preview": preview,
                    "unread": unread,
                },
            )
        else:
            new_thread = DmThread(
                id=thread_id,
                participant_uids=sorted((sender_uid, peer_uid)),
                last_message_at=created_at,
                last_message_preview=preview,
                unread={peer_uid: 1, sender_uid: 0},
            )
            transaction.set(thread_ref, new_thread.model_dump())
        transaction.set(message_ref, message.model_dump())

    _run(transaction)
    return message


def list_messages(db: Client, thread_id: str, limit: int = _MESSAGE_LIST_LIMIT) -> list[DmMessage]:
    """대화방의 메시지를 최신순(created_at 내림차순)으로 최대 limit개 반환한다."""
    query = (
        _messages_collection_ref(db, thread_id)
        .order_by("created_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [DmMessage.model_validate(doc.to_dict()) for doc in query.stream()]


def mark_read(db: Client, thread_id: str, uid: str) -> None:
    """uid의 안읽음 수를 0으로 리셋한다. 대화방이 없으면 아무 것도 하지 않는다."""
    thread_ref = _thread_doc_ref(db, thread_id)
    snapshot = thread_ref.get()
    if not snapshot.exists:
        return
    thread = _snapshot_to_thread(snapshot)
    if thread.unread_for(uid) == 0:
        return
    unread = dict(thread.unread)
    unread[uid] = 0
    thread_ref.update({"unread": unread})
