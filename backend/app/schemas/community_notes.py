"""/api/community/notes 요청/응답 스키마.

app/schemas/community.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 각 스키마 모듈이 로컬로 복제해 쓰는 기존 관행을 그대로
따른다(모듈 간 private 클래스를 import하지 않기 위함).

## 익명 직렬화 규칙 (핵심 - 실제 강제 지점은 app/api/community_notes.py)

NoteThreadOut/NoteMessageOut 어디에도 senderUid/recipientUid/표시명/아바타 필드가
없다 - 아예 필드 자체를 정의하지 않는다(app/schemas/community.py의 author_uid처럼
"있지만 조건부로 비운다" 방식조차 쓰지 않는다, 상대 식별 정보는 여기선 존재해서는
안 되는 개념이기 때문). senderLabel/role만으로 화면을 구성한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.note import MAX_NOTE_BODY_LEN, FromRole, TargetType


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class NoteStartIn(_CamelModel):
    """쪽지 시작/이어쓰기 요청.

    postId는 targetType=="comment"일 때만 필수다(댓글이 속한 글 id - 서브컬렉션
    경로를 만들려면 반드시 필요하다. app/firestore/community_note_repo.py 모듈
    docstring 참고). targetType=="post"면 무시하고 targetId를 글 id로 쓴다.
    """

    target_type: TargetType
    target_id: str
    post_id: str | None = None
    body: str = Field(min_length=1, max_length=MAX_NOTE_BODY_LEN)


class NoteReplyIn(_CamelModel):
    """스레드 답장 요청."""

    body: str = Field(min_length=1, max_length=MAX_NOTE_BODY_LEN)


class NoteThreadOut(_CamelModel):
    """쪽지 스레드 요약. 상대의 uid/표시명/아바타는 어떤 필드에도 없다.

    role은 요청자 본인이 이 스레드에서 sender인지 recipient인지를 나타낸다.
    senderLabel은 role=="recipient"일 때만 채워진다 - 발신자 본인에게는 "몇 번째
    발신자인지"가 무의미하므로.
    """

    id: str
    role: FromRole
    target_type: TargetType
    post_title: str
    comment_excerpt: str | None = None
    sender_label: int | None = None
    unread: bool
    blocked: bool
    created_at: int
    last_message_at: int


class NoteInboxOut(_CamelModel):
    """내 쪽지함 - 받은 스레드 + 보낸 스레드를 합쳐 최신순으로."""

    threads: list[NoteThreadOut]
    unread_count: int


class NoteMessageOut(_CamelModel):
    """쪽지 메시지 응답. from_role 대신 mine 하나로만 구분해 역할 자체도 노출하지 않는다."""

    id: str
    mine: bool
    body: str
    created_at: int


class NoteThreadMessagesOut(_CamelModel):
    """스레드 상세 + 메시지 목록 응답."""

    thread: NoteThreadOut
    messages: list[NoteMessageOut]
