"""커뮤니티 쪽지(익명 메시지) API (prefix /api/community/notes).

app/api/community.py와 동일한 관례(Firestore 클라이언트 의존성 주입, camelCase
스키마, response_model_exclude_none=True)를 따른다.

## 익명 직렬화는 여기서 강제한다 (이 기능의 핵심 안전장치)

app/firestore/community_note_repo.py는 sender_uid/recipient_uid를 스레드 문서에
그대로 저장/반환한다(라우팅·차단·소유권 검증을 위해 서버는 항상 알아야 하므로).
그 uid들, 표시 이름, 아바타 중 어느 것도 응답 필드에 담지 않는 규칙은 이 모듈의
_to_thread_out/_to_message_out이 유일하게 강제하는 지점이다 - app/api/community.py의
_to_post_out/_to_comment_out과 완전히 같은 분업 구조다. 메시지 서브컬렉션 자체에는
애초에 uid가 없다(from_role만) - 이 함수를 거치지 않고 도메인 모델을 직접 반환하는
경로를 만들지 말 것.

sender_label(그 대상 안에서 몇 번째 발신자인지)은 받는 사람 시점에서만 의미가
있으므로 role=="recipient"일 때만 채운다 - uid를 역산할 수 있는 값이 아니라
단순 순번이라도, 굳이 발신자 본인 화면에까지 노출할 이유가 없다.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.domain.note import FromRole, NoteMessage, NoteThread
from app.firestore import community_note_repo, notification_repo
from app.firestore.client import get_firestore_client
from app.schemas.community_notes import (
    NoteInboxOut,
    NoteMessageOut,
    NoteReplyIn,
    NoteStartIn,
    NoteThreadMessagesOut,
    NoteThreadOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/community/notes", tags=["community-notes"])

_THREAD_NOT_FOUND = HTTPException(status_code=404, detail="쪽지 대화를 찾을 수 없어요.")
_FORBIDDEN = HTTPException(status_code=403, detail="이 쪽지 대화에 접근할 권한이 없어요.")
_SELF_NOTE = HTTPException(status_code=400, detail="자기 자신에게는 쪽지를 보낼 수 없어요.")
_TARGET_NOT_FOUND = HTTPException(status_code=404, detail="쪽지를 보낼 대상을 찾을 수 없어요.")
_MISSING_POST_ID = HTTPException(
    status_code=400, detail="댓글에 쪽지를 보내려면 postId가 필요해요."
)
_BLOCKED = HTTPException(status_code=403, detail="상대가 이 대화를 차단했어요.")
_BLOCK_NOT_ALLOWED = HTTPException(status_code=403, detail="받는 사람만 대화를 차단할 수 있어요.")
_UNBLOCK_NOT_ALLOWED = HTTPException(status_code=403, detail="받는 사람만 차단을 해제할 수 있어요.")


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _role_of(thread: NoteThread, uid: str) -> FromRole | None:
    if uid == thread.sender_uid:
        return "sender"
    if uid == thread.recipient_uid:
        return "recipient"
    return None


def _to_thread_out(db: Client, thread: NoteThread, *, role: FromRole) -> NoteThreadOut:
    """스레드를 응답으로 직렬화한다 - 익명 노출 차단이 일어나는 유일한 지점.

    sender_uid/recipient_uid는 절대 필드에 담기지 않는다(스키마 자체에 그런
    필드가 없다). unread/senderLabel은 role에 따라 의미가 달라 여기서 골라 채운다.
    """
    post_title, comment_excerpt = community_note_repo.get_thread_context(db, thread)
    unread = thread.unread_for_recipient if role == "recipient" else thread.unread_for_sender
    return NoteThreadOut(
        id=thread.id,
        role=role,
        target_type=thread.target_type,
        post_title=post_title,
        comment_excerpt=comment_excerpt,
        sender_label=thread.sender_label if role == "recipient" else None,
        unread=unread,
        blocked=thread.blocked,
        created_at=thread.created_at,
        last_message_at=thread.last_message_at,
    )


def _to_message_out(message: NoteMessage, *, role: FromRole) -> NoteMessageOut:
    """메시지를 응답으로 직렬화한다. from_role 대신 mine 하나로만 구분해 노출한다."""
    return NoteMessageOut(
        id=message.id,
        mine=message.from_role == role,
        body=message.body,
        created_at=message.created_at,
    )


def _notify(db: Client, *, recipient_uid: str, actor_uid: str) -> None:
    """쪽지 알림 생성 훅 - 실패해도 쪽지 전송 자체는 막지 않는다(app/api/posts.py의 _notify 관례).

    type="note" 알림의 actor는 app/api/notifications.py가 응답 직렬화 단계에서
    이미 전부 잘라내므로(메인 스레드 작업 완료분), 여기서 actor_uid를 저장해도
    익명성이 깨지지 않는다.
    """
    try:
        notification_repo.create_notification(
            db,
            recipient_uid=recipient_uid,
            actor_uid=actor_uid,
            type="note",
            created_at=_now_ms(),
        )
    except Exception:
        logger.warning("쪽지 알림 생성 실패: recipient=%s", recipient_uid, exc_info=True)


@router.post("", response_model=NoteThreadOut, response_model_exclude_none=True, status_code=201)
async def start_or_continue_note(
    payload: NoteStartIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteThreadOut:
    """대상(글/댓글) 작성자에게 쪽지를 시작하거나, 이미 보낸 적 있으면 기존 스레드에 이어붙인다.

    자기 자신이 작성한 대상이면 400, 차단된 기존 스레드면 403.
    """
    if payload.target_type == "comment" and payload.post_id is None:
        raise _MISSING_POST_ID
    resolved = community_note_repo.resolve_target(
        db, payload.target_type, payload.target_id, payload.post_id
    )
    if resolved is None:
        raise _TARGET_NOT_FOUND
    recipient_uid, post_id = resolved
    if recipient_uid == user.uid:
        raise _SELF_NOTE
    try:
        thread = community_note_repo.start_or_continue(
            db,
            target_type=payload.target_type,
            target_id=payload.target_id,
            post_id=post_id,
            recipient_uid=recipient_uid,
            sender_uid=user.uid,
            body=payload.body,
            created_at=_now_ms(),
        )
    except community_note_repo.ThreadBlockedError as e:
        raise _BLOCKED from e
    _notify(db, recipient_uid=recipient_uid, actor_uid=user.uid)
    return _to_thread_out(db, thread, role="sender")


@router.get("", response_model=NoteInboxOut, response_model_exclude_none=True)
async def list_my_notes(
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteInboxOut:
    """내가 받은 쪽지 스레드 + 보낸 쪽지 스레드를 합쳐 최신순 최대 30건, 총 안읽음 개수와 함께 반환한다."""
    threads_with_role = community_note_repo.list_threads_for_user(db, user.uid)
    unread_count = sum(
        1
        for thread, role in threads_with_role
        if (thread.unread_for_recipient if role == "recipient" else thread.unread_for_sender)
    )
    return NoteInboxOut(
        threads=[_to_thread_out(db, thread, role=role) for thread, role in threads_with_role],
        unread_count=unread_count,
    )


@router.get(
    "/{thread_id}/messages",
    response_model=NoteThreadMessagesOut,
    response_model_exclude_none=True,
)
async def get_thread_messages(
    thread_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteThreadMessagesOut:
    """스레드의 메시지를 최신순 최대 50건 반환하고, 내 안읽음을 리셋한다.

    참가자(발신자 또는 수신자)가 아니면 403.
    """
    thread = community_note_repo.get_thread(db, thread_id)
    if thread is None:
        raise _THREAD_NOT_FOUND
    role = _role_of(thread, user.uid)
    if role is None:
        raise _FORBIDDEN
    community_note_repo.mark_read(db, thread_id, role)
    messages = community_note_repo.list_messages(db, thread_id)
    return NoteThreadMessagesOut(
        thread=_to_thread_out(db, thread, role=role),
        messages=[_to_message_out(m, role=role) for m in messages],
    )


@router.post(
    "/{thread_id}/messages",
    response_model=NoteMessageOut,
    response_model_exclude_none=True,
    status_code=201,
)
async def reply_to_thread(
    thread_id: str,
    payload: NoteReplyIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteMessageOut:
    """스레드에 답장한다. 참가자가 아니면 403, 차단됐으면 403."""
    thread = community_note_repo.get_thread(db, thread_id)
    if thread is None:
        raise _THREAD_NOT_FOUND
    role = _role_of(thread, user.uid)
    if role is None:
        raise _FORBIDDEN
    try:
        message = community_note_repo.add_message(
            db, thread_id, from_role=role, body=payload.body, created_at=_now_ms()
        )
    except community_note_repo.ThreadBlockedError as e:
        raise _BLOCKED from e
    other_uid = thread.recipient_uid if role == "sender" else thread.sender_uid
    _notify(db, recipient_uid=other_uid, actor_uid=user.uid)
    return _to_message_out(message, role=role)


@router.post("/{thread_id}/block", response_model=NoteThreadOut, response_model_exclude_none=True)
async def block_thread(
    thread_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteThreadOut:
    """받는 사람만 스레드를 차단할 수 있다(익명 괴롭힘 방지). 이후 그 스레드로는 메시지를 보낼 수 없다."""
    thread = community_note_repo.get_thread(db, thread_id)
    if thread is None:
        raise _THREAD_NOT_FOUND
    if user.uid != thread.recipient_uid:
        raise _BLOCK_NOT_ALLOWED
    thread = community_note_repo.block(db, thread_id)
    return _to_thread_out(db, thread, role="recipient")


@router.post("/{thread_id}/unblock", response_model=NoteThreadOut, response_model_exclude_none=True)
async def unblock_thread(
    thread_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> NoteThreadOut:
    """받는 사람만 차단을 해제할 수 있다(block과 동일한 권한 규칙).

    이미 차단되지 않은 스레드에 호출해도 에러 없이 통과한다(멱등) - repo의
    unblock이 현재 상태를 확인하지 않고 그냥 덮어쓰므로 자연히 그렇게 되고,
    실수로 두 번 눌러도 사용자에게 에러를 보여줄 이유가 없다는 판단이다.
    """
    thread = community_note_repo.get_thread(db, thread_id)
    if thread is None:
        raise _THREAD_NOT_FOUND
    if user.uid != thread.recipient_uid:
        raise _UNBLOCK_NOT_ALLOWED
    thread = community_note_repo.unblock(db, thread_id)
    return _to_thread_out(db, thread, role="recipient")
