"""/api/consents 요청/응답 스키마.

app/schemas/profiles.py의 _CamelModel 관례(alias_generator=to_camel +
populate_by_name=True)를 그대로 따른다 - 프론트엔드는 camelCase JSON을 기대한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_MAX_VERSION_LEN = 40


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class OverseasConsentIn(_CamelModel):
    """개인정보 국외이전 동의 기록 요청 - 유저가 실제로 읽고 동의한 문구의 판본."""

    version: str = Field(min_length=1, max_length=_MAX_VERSION_LEN)


class OverseasConsentStatusOut(_CamelModel):
    """국외이전 동의 상태 응답.

    consented는 "저장된 판본 == 현재 판본"일 때만 True다 - 과거 판본에 동의한
    적이 있어도 문구가 개정됐으면(currentVersion 변경) False로 되돌아간다.
    """

    consented: bool
    current_version: str
