"""/api/stories 요청/응답 스키마.

app/schemas/posts.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따르고, image_data 제약도 그 모듈처럼
app/domain/post.py의 상수를 그대로 재사용한다(스토리 이미지 = 게시물 이미지와
동일 규칙).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.post import IMAGE_DATA_PATTERN, MAX_IMAGE_DATA_LEN


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StoryCreateIn(_CamelModel):
    """스토리 생성 요청."""

    image_data: str = Field(pattern=IMAGE_DATA_PATTERN, max_length=MAX_IMAGE_DATA_LEN)


class StoryOut(_CamelModel):
    """스토리 응답."""

    id: str
    owner_id: str
    image_data: str
    created_at: int
    expires_at: int


class StoryRingItemOut(_CamelModel):
    """GET /api/stories/ring 항목 - 활성 스토리가 있는 유저 한 명."""

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None
    has_unseen: bool
