"""커뮤니티 쪽지(익명 메시지)의 순수 도메인 모델.

DB/Firestore 클라이언트 의존성이 없다(app/domain/community.py와 동일 관례).

## 스레드 = 대상(글/댓글) 하나 + 발신자 하나

한 대상(post 또는 comment)에 여러 사람이 쪽지를 보내면 대상마다, 발신자마다 별개의
NoteThread가 생긴다. 같은 사람이 쓴 다른 글에 대한 쪽지는 절대 같은 스레드로 묶이지
않는다(사용자 확정 설계) - app/firestore/community_note_repo.py가 (target_id,
sender_uid) 쌍으로 스레드를 찾는 이유가 바로 이 불변식 때문이다.

## 익명성은 이 모델이 아니라 API 직렬화가 지킨다

NoteThread는 sender_uid/recipient_uid를 그대로 담는다(라우팅·차단·소유권 검증에
서버가 반드시 알아야 하므로 - app/domain/community.py의 author_uid와 동일한 이유).
이 필드들을 언제 누구에게 숨길지는 app/api/community_notes.py의 직렬화 함수가
전담한다. sender_label은 "그 대상 안에서 몇 번째로 쪽지를 보낸 사람인가"를 나타내는
정수 하나뿐이라 uid를 역산할 수 없다 - 받는 사람 화면에서 발신자를 구분하는 용도로만
쓰인다(발신자 자신에게는 의미가 없으므로 API 직렬화 단계에서 recipient 시점에만 노출).

## 메시지에는 uid를 아예 넣지 않는다

NoteMessage.from_role은 "sender" 아니면 "recipient"라는 역할만 담고 실제 uid는
저장하지 않는다. 응답 직렬화 실수로 uid가 새어나갈 여지를 모델 구조 자체에서
없애기 위한 선택이다 - uid는 오직 NoteThread 문서에만 있고, 그 문서는 API 계층이
절대 그대로 직렬화하지 않는다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_NOTE_BODY_LEN = 1000

TargetType = Literal["post", "comment"]
FromRole = Literal["sender", "recipient"]


class NoteThread(BaseModel):
    """쪽지 대화 한 건.

    Firestore 최상위 `community_notes` 컬렉션에 저장한다.
    """

    id: str
    target_type: TargetType
    target_id: str
    # 댓글 대상이어도 그 댓글이 속한 글의 id를 함께 들고 있다 - 쪽지함 목록에서
    # "어느 글의 댓글인지" 맥락을 보여주려면 매번 댓글->부모글 역추적을 할 수
    # 없으므로(서브컬렉션 경로에 post_id가 필요) 스레드 생성 시점에 비정규화해 둔다.
    post_id: str
    recipient_uid: str
    sender_uid: str
    sender_label: int
    created_at: int  # epoch-ms
    last_message_at: int  # epoch-ms
    unread_for_recipient: bool = False
    unread_for_sender: bool = False
    blocked: bool = False


class NoteMessage(BaseModel):
    """쪽지 대화에 달리는 메시지 한 건.

    Firestore `community_notes/{thread_id}/messages/{message_id}` 서브컬렉션에 저장한다.
    """

    id: str
    from_role: FromRole
    body: str = Field(max_length=MAX_NOTE_BODY_LEN)
    created_at: int  # epoch-ms
