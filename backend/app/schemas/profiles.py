"""/api/profiles 요청/응답 스키마.

app/schemas/auth_sync.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel
+ populate_by_name=True)를 따른다 - 프론트엔드는 camelCase JSON을 기대한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_MAX_BIO_LEN = 500


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ProfilePatchIn(_CamelModel):
    """본인 프로필 부분 갱신 요청. None인 필드는 건드리지 않는다."""

    display_name: str | None = Field(default=None, max_length=40)
    avatar_emoji: str | None = Field(default=None, max_length=8)
    bio: str | None = Field(default=None, max_length=_MAX_BIO_LEN)


class ProfileOut(_CamelModel):
    """공개 프로필 응답.

    is_following은 요청자가 로그인했고 본인 프로필이 아닐 때만 값이 채워진다
    (그 외에는 None) - 라우터가 response_model_exclude_none=True를 켜므로 그
    경우 키 자체가 응답에서 빠진다.
    """

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None
    bio: str | None = None
    follower_count: int = 0
    following_count: int = 0
    is_following: bool | None = None
