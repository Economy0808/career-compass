"""/api/posts 요청/응답 스키마.

app/schemas/profiles.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다. image_data/caption의 형식·길이 제약은
app/domain/post.py의 상수를 그대로 재사용한다 - 이 스키마 계층이 실제 HTTP 422를
만들어내는 지점이고(요청 바디가 라우터에 닿기 전에 여기서 걸러진다), 도메인
계층의 field_validator는 다른 호출부(테스트 등)에도 같은 불변식을 강제하는 이중
방어선이다(constellation.py의 NODE_COLOR_PATTERN과 동일한 이유).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.post import IMAGE_DATA_PATTERN, MAX_CAPTION_LEN, MAX_IMAGE_DATA_LEN


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PostCreateIn(_CamelModel):
    """게시물 생성 요청."""

    image_data: str = Field(pattern=IMAGE_DATA_PATTERN, max_length=MAX_IMAGE_DATA_LEN)
    caption: str = Field(default="", max_length=MAX_CAPTION_LEN)


class PostOut(_CamelModel):
    """게시물 응답."""

    id: str
    owner_id: str
    image_data: str
    caption: str
    created_at: int
