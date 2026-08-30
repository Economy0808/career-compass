"""/api/notifications 요청/응답 스키마.

app/schemas/posts.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class NotificationOut(_CamelModel):
    """알림 한 건. post_id는 팔로우 알림이면 None(응답에서는 response_model_exclude_none으로 키 자체가 빠짐)."""

    id: str
    actor_uid: str
    type: Literal["follow", "like", "comment"]
    post_id: str | None = None
    created_at: int
    read: bool


class NotificationListOut(_CamelModel):
    """GET /api/notifications 응답. unread_count는 items(최대 30개)로 절단하기 전 전체 미읽음 개수다."""

    items: list[NotificationOut]
    unread_count: int
