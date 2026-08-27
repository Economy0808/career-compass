"""POST /api/auth/sync 요청/응답 스키마.

app/schemas/constellation.py의 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 그대로 따른다 - 프론트엔드는 camelCase JSON을 기대하고
파이썬 쪽 필드명은 snake_case로 유지한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AuthSyncIn(_CamelModel):
    """동기화 요청 본문. 전부 선택 - 로그인 직후 프로필 갱신 없이 순수 조회로도 쓸 수 있다."""

    display_name: str | None = Field(default=None, max_length=40)
    avatar_emoji: str | None = Field(default=None, max_length=8)
    consent: bool | None = None


class AuthSyncOut(_CamelModel):
    """동기화 응답. yonsei_verified는 토큰 claim + 자동부여 + 라이브 조회를 합친 최종 판정값이다."""

    uid: str
    email: str | None
    email_verified: bool
    yonsei_verified: bool
    display_name: str | None
    avatar_emoji: str | None
