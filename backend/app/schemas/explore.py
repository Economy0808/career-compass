"""/api/explore 요청/응답 스키마.

app/schemas/profiles.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ExploreUserOut(_CamelModel):
    """탐색 카드 하나(추천 목록/검색 결과 공통).

    common_tags는 요청자가 로그인했을 때만 채워진다(그 외엔 None ->
    response_model_exclude_none으로 응답에서 키 자체가 빠짐 - app/schemas/posts.py의
    is_liked와 동일 관례).
    """

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None
    bio: str | None = None
    interest_tags: list[str] = Field(default_factory=list)
    common_tags: list[str] | None = None
