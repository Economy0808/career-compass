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


class NotificationActorOut(_CamelModel):
    """알림을 발생시킨 사용자(actor)의 표시 정보. app/schemas/posts.py의 PostFeedAuthorOut과
    동일한 문법이지만, actor_uid가 NotificationOut에 이미 따로 있으므로 uid는 중복해
    싣지 않는다(프로필 링크 이동은 그 필드로 한다)."""

    display_name: str | None = None
    avatar_emoji: str | None = None


class NotificationOut(_CamelModel):
    """알림 한 건. post_id는 팔로우 알림이면 None, actor는 프로필 문서가 아예 없으면
    None이다 - 둘 다 response_model_exclude_none으로 응답에서 키 자체가 빠진다.

    actor를 매번 개별 조회하지 않고 목록 전체의 고유 actor_uid를 한 번에 배치
    조회(user_repo.get_profiles)해 채운다 - 항목마다 프로필을 조회하면(N+1) 같은
    actor가 여러 알림에 반복 등장할 때(예: 좋아요 여러 번) 낭비다.
    """

    id: str
    actor_uid: str
    actor: NotificationActorOut | None = None
    type: Literal["follow", "like", "comment"]
    post_id: str | None = None
    created_at: int
    read: bool


class NotificationListOut(_CamelModel):
    """GET /api/notifications 응답. unread_count는 items(최대 30개)로 절단하기 전 전체 미읽음 개수다."""

    items: list[NotificationOut]
    unread_count: int
