"""Firestore 기반 커뮤니티 쪽지(익명 메시지) 리포지토리.

⚠️ app/firestore/note_repo.py는 별자리(constellation) 노트용으로 이미 존재한다 -
이름 충돌을 피하기 위해 이 모듈은 community_note_repo로 명명했다. 서로 완전히
무관한 기능이다.

## 컬렉션 레이아웃

최상위 `community_notes` 컬렉션이 스레드(NoteThread) 문서를 담는다. 메시지는
`community_notes/{thread_id}/messages/{message_id}` 서브컬렉션이다
(community_repo.py가 `community_posts/{id}/comments`를 쓰는 것과 동일 관례).
발신자 라벨 채번용 카운터는 `community_note_counters/{target_id}` 문서 하나에
next_label 정수만 들고 있다 - 대상(글/댓글)마다 독립적으로 1부터 채번한다.

## 스레드 찾기 = (target_id, sender_uid) 동등 필터 둘

Firestore는 등호(==) 필터 여러 개를 조합하는 쿼리에 복합 색인이 필요 없다(복합
색인은 등호+범위/정렬을 섞을 때만 필요) - 그래서 firestore.indexes.json을 건드릴
필요가 없다.

## 댓글 대상 조회는 postId 힌트가 필요하다

댓글 문서는 `community_posts/{post_id}/comments/{comment_id}` 서브컬렉션에 있어
부모 글 id를 모르면 경로를 만들 수 없다(collection_group 쿼리로 우회하는 방법도
있지만 색인 추가가 필요해지고 이 프로젝트에 전례가 없어 과설계다). 그래서
app/schemas/community_notes.py의 NoteStartIn은 targetType=="comment"일 때
postId를 함께 받는다 - 댓글 케밥 메뉴는 어차피 글 상세 화면 안에 있어 프론트가
이미 postId를 들고 있으므로 추가 부담이 없다.

## 익명성 - 이 모듈은 우회 경로를 만들지 않는다

메시지 서브컬렉션에는 uid를 절대 저장하지 않는다(from_role만). 스레드 문서에는
sender_uid/recipient_uid가 그대로 있지만, 이 모듈은 그걸 감추지 않는다 - 응답
직렬화 시점에 감추는 건 app/api/community_notes.py의 책임이다(app/domain/community.py
+ app/api/community.py 쌍과 동일 분업).
"""

from __future__ import annotations

import uuid
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, Transaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.note import FromRole, NoteMessage, NoteThread, TargetType
from app.firestore import community_repo

_COLLECTION = "community_notes"
_COUNTERS_COLLECTION = "community_note_counters"
_MESSAGES_SUBCOLLECTION = "messages"
_POSTS_COLLECTION = "community_posts"
_COMMENTS_SUBCOLLECTION = "comments"
_THREAD_LIST_LIMIT = 30
_MESSAGE_LIST_LIMIT = 50

__all__ = [
    "CommunityNoteRepoError",
    "ThreadBlockedError",
    "ThreadNotFoundError",
    "add_message",
    "block",
    "get_thread",
    "get_thread_context",
    "list_messages",
    "list_threads_for_user",
    "mark_read",
    "resolve_target",
    "start_or_continue",
]


class CommunityNoteRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class ThreadNotFoundError(CommunityNoteRepoError):
    """지정한 id의 쪽지 스레드 문서가 존재하지 않을 때."""


class ThreadBlockedError(CommunityNoteRepoError):
    """받는 사람이 차단한 스레드에 메시지를 보내려 할 때."""


def _threads_collection(db: Client) -> Any:
    return db.collection(_COLLECTION)


def _thread_doc_ref(db: Client, thread_id: str) -> Any:
    return _threads_collection(db).document(thread_id)


def _messages_collection_ref(db: Client, thread_id: str) -> Any:
    return _thread_doc_ref(db, thread_id).collection(_MESSAGES_SUBCOLLECTION)


def _counter_doc_ref(db: Client, target_id: str) -> Any:
    return db.collection(_COUNTERS_COLLECTION).document(target_id)


def _snapshot_to_thread(snapshot: Any) -> NoteThread:
    data = snapshot.to_dict()
    assert data is not None
    return NoteThread.model_validate(data)


def _snapshot_to_message(snapshot: Any) -> NoteMessage:
    data = snapshot.to_dict()
    assert data is not None
    return NoteMessage.model_validate(data)


def resolve_target(
    db: Client, target_type: TargetType, target_id: str, post_id_hint: str | None
) -> tuple[str, str] | None:
    """쪽지를 보낼 대상(글/댓글)의 (작성자 uid, 소속 글 id)를 반환한다. 없으면 None.

    community_repo는 읽기 전용으로만 쓴다(수정 금지 - 브리핑) - 댓글 조회는
    community_repo에 그 함수가 없으므로 이 모듈 안에서 직접 Firestore를 읽는다.
    """
    if target_type == "post":
        post = community_repo.get_post(db, target_id)
        if post is None:
            return None
        return post.author_uid, post.id
    if post_id_hint is None:
        return None
    snapshot = (
        db.collection(_POSTS_COLLECTION)
        .document(post_id_hint)
        .collection(_COMMENTS_SUBCOLLECTION)
        .document(target_id)
        .get()
    )
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    author_uid = data.get("author_uid")
    if not author_uid:
        return None
    return author_uid, post_id_hint


def get_thread_context(db: Client, thread: NoteThread) -> tuple[str, str | None]:
    """스레드 목록에 보여줄 (글 제목, 댓글 발췌) - 상대 식별 정보는 전혀 담지 않는다.

    댓글 대상이 아니면 댓글 발췌는 None. 원본 글/댓글이 이미 삭제됐으면 안내
    문구로 대체한다(조회 실패로 500을 내지 않기 위함).
    """
    post = community_repo.get_post(db, thread.post_id)
    post_title = post.title if post is not None else "(삭제된 글)"
    if thread.target_type == "post":
        return post_title, None
    snapshot = (
        db.collection(_POSTS_COLLECTION)
        .document(thread.post_id)
        .collection(_COMMENTS_SUBCOLLECTION)
        .document(thread.target_id)
        .get()
    )
    if not snapshot.exists:
        return post_title, "(삭제된 댓글)"
    body = (snapshot.to_dict() or {}).get("body", "")
    return post_title, body[:40]


def _next_label(db: Client, target_id: str) -> int:
    """target_id 범위 안에서 다음 발신자 라벨(1부터)을 원자적으로 채번한다."""
    ref = _counter_doc_ref(db, target_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> int:
        snapshot = ref.get(transaction=transaction)
        current = (snapshot.to_dict() or {}).get("next_label", 1) if snapshot.exists else 1
        transaction.set(ref, {"next_label": current + 1})
        return current

    return _run(transaction)


def get_thread(db: Client, thread_id: str) -> NoteThread | None:
    """스레드 하나를 조회한다. 없으면 None."""
    snapshot = _thread_doc_ref(db, thread_id).get()
    if not snapshot.exists:
        return None
    return _snapshot_to_thread(snapshot)


def _find_thread_by_sender(db: Client, target_id: str, sender_uid: str) -> NoteThread | None:
    query = (
        _threads_collection(db)
        .where(filter=FieldFilter("target_id", "==", target_id))
        .where(filter=FieldFilter("sender_uid", "==", sender_uid))
        .limit(1)
    )
    docs = list(query.stream())
    return _snapshot_to_thread(docs[0]) if docs else None


def add_message(
    db: Client, thread_id: str, *, from_role: FromRole, body: str, created_at: int
) -> NoteMessage:
    """스레드에 메시지를 추가하고 상대방 안읽음 플래그를 세운다.

    스레드가 없으면 ThreadNotFoundError, 차단된 스레드면 ThreadBlockedError.
    읽기(차단 여부 확인)와 쓰기(메시지 생성 + 스레드 갱신)를 하나의 트랜잭션으로
    묶어, "차단 확인 직후 차단됨" 같은 경합을 없앤다(community_repo.create_comment와
    동일한 트랜잭션 관용구).
    """
    thread_ref = _thread_doc_ref(db, thread_id)
    message = NoteMessage(
        id=str(uuid.uuid4()), from_role=from_role, body=body, created_at=created_at
    )
    message_ref = _messages_collection_ref(db, thread_id).document(message.id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        snapshot = thread_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise ThreadNotFoundError(thread_id)
        thread = _snapshot_to_thread(snapshot)
        if thread.blocked:
            raise ThreadBlockedError(thread_id)
        updates: dict[str, Any] = {"last_message_at": created_at}
        if from_role == "sender":
            updates["unread_for_recipient"] = True
            updates["unread_for_sender"] = False
        else:
            updates["unread_for_sender"] = True
            updates["unread_for_recipient"] = False
        # 모든 읽기가 끝난 뒤에야 쓴다 (Firestore 트랜잭션 규칙).
        transaction.set(message_ref, message.model_dump())
        transaction.update(thread_ref, updates)

    _run(transaction)
    return message


def start_or_continue(
    db: Client,
    *,
    target_type: TargetType,
    target_id: str,
    post_id: str,
    recipient_uid: str,
    sender_uid: str,
    body: str,
    created_at: int,
) -> NoteThread:
    """대상에 처음 쪽지를 보내면 새 스레드를, 이미 보낸 적 있으면 기존 스레드를 이어쓴다.

    같은 (target_id, sender_uid) 조합이면 무조건 같은 스레드로 묶인다 - 같은
    사람이 쓴 다른 글의 스레드와는 절대 연결되지 않는다(target_id가 다르므로).
    차단된 기존 스레드면 add_message가 ThreadBlockedError를 던진다.

    # ponytail: "동시에 두 번 클릭"으로 스레드가 중복 생성될 수 있는 짧은 race가
    # 있다(조회와 생성이 하나의 트랜잭션이 아님) - community_repo.create_post와
    # 동일한 수준의 보증이고, 사용자 승인 시나리오도 순차 호출만 검증한다.
    # 문제가 되면 조회+생성을 트랜잭션으로 묶을 것.
    """
    existing = _find_thread_by_sender(db, target_id, sender_uid)
    if existing is not None:
        thread_id = existing.id
    else:
        label = _next_label(db, target_id)
        thread = NoteThread(
            id=str(uuid.uuid4()),
            target_type=target_type,
            target_id=target_id,
            post_id=post_id,
            recipient_uid=recipient_uid,
            sender_uid=sender_uid,
            sender_label=label,
            created_at=created_at,
            last_message_at=created_at,
        )
        _thread_doc_ref(db, thread.id).set(thread.model_dump())
        thread_id = thread.id
    add_message(db, thread_id, from_role="sender", body=body, created_at=created_at)
    thread = get_thread(db, thread_id)
    assert thread is not None  # 방금 만들었거나 확인한 스레드라 존재가 보장됨
    return thread


def list_messages(
    db: Client, thread_id: str, limit: int = _MESSAGE_LIST_LIMIT
) -> list[NoteMessage]:
    """스레드의 메시지를 최신순(created_at 내림차순)으로 최대 limit개 반환한다."""
    query = (
        _messages_collection_ref(db, thread_id)
        .order_by("created_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [_snapshot_to_message(doc) for doc in query.stream()]


def mark_read(db: Client, thread_id: str, role: FromRole) -> None:
    """role 시점의 안읽음 플래그를 끈다. 스레드가 없으면 조용히 무시한다."""
    field = "unread_for_sender" if role == "sender" else "unread_for_recipient"
    ref = _thread_doc_ref(db, thread_id)
    if ref.get().exists:
        ref.update({field: False})


def block(db: Client, thread_id: str) -> NoteThread:
    """스레드를 차단 상태로 바꾼다. 호출 전 recipient 권한 확인은 API 계층 책임."""
    ref = _thread_doc_ref(db, thread_id)
    ref.update({"blocked": True})
    thread = get_thread(db, thread_id)
    assert thread is not None
    return thread


def list_threads_for_user(
    db: Client, uid: str, limit: int = _THREAD_LIST_LIMIT
) -> list[tuple[NoteThread, FromRole]]:
    """uid가 받은 스레드 + 보낸 스레드를 함께, 최신 메시지순으로 최대 limit개 반환한다.

    두 개의 단일 등호 필터 쿼리로 나눠 던지고 파이썬에서 병합·정렬한다
    (notification_repo.list_notifications와 동일한 판단 - 규모가 커지면 재검토).
    """
    recipient_query = _threads_collection(db).where(filter=FieldFilter("recipient_uid", "==", uid))
    sender_query = _threads_collection(db).where(filter=FieldFilter("sender_uid", "==", uid))
    combined: list[tuple[NoteThread, FromRole]] = [
        (_snapshot_to_thread(doc), "recipient") for doc in recipient_query.stream()
    ] + [(_snapshot_to_thread(doc), "sender") for doc in sender_query.stream()]
    combined.sort(key=lambda pair: pair[0].last_message_at, reverse=True)
    return combined[:limit]
