"""/api/dm 요청/응답 스키마.

app/schemas/posts.py/app/schemas/explore.py와 동일한 `_CamelModel` 관례
(alias_generator=to_camel + populate_by_name=True)를 따른다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.dm import MAX_DM_BODY_LEN, MIN_DM_BODY_LEN


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DmMessageCreateIn(_CamelModel):
    """DM 발신 요청."""

    body: str = Field(min_length=MIN_DM_BODY_LEN, max_length=MAX_DM_BODY_LEN)


class DmMessageOut(_CamelModel):
    """DM 메시지 한 건."""

    id: str
    sender_uid: str
    body: str
    created_at: int


class DmPeerOut(_CamelModel):
    """대화 상대의 표시 정보. 프로필이 없으면 표시 필드가 전부 None."""

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None


class DmPartnerOut(_CamelModel):
    """새 대화를 시작할 수 있는 상대 한 명(내 팔로잉 또는 팔로워).

    hasThread는 이미 이 상대와 대화방이 있는지 여부다 - 프론트가 "새 대화
    시작"과 "기존 대화 이어가기"를 구분해 보여줄 수 있게 한다.
    """

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None
    has_thread: bool = False


class DmThreadOut(_CamelModel):
    """대화방 목록 카드 하나."""

    id: str
    peer: DmPeerOut
    last_message_at: int
    last_message_preview: str
    unread: int = 0


class DmThreadListOut(_CamelModel):
    """GET /api/dm 응답. unread_total은 전체 대화방 안읽음 합계(배지 숫자용)."""

    items: list[DmThreadOut]
    unread_total: int
