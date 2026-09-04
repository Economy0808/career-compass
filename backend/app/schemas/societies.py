"""/api/societies 요청/응답 스키마 - 학회/동아리 크라우드소싱 제출 (Stage A).

app/schemas/stories.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.

하드 요구사항(법무 확정, 완화 금지): 담당자 연락처/전화/이메일/SNS 필드는
설계상 아예 두지 않는다 - 아래 SocietyCreateIn에 그런 필드가 없는 것 자체가
그 요구사항의 구현이다. 자유서술 필드에 사용자가 직접 적어 넣는 연락처는
app/services/pii_guard.py가 라우터에서 별도로 걸러낸다(스키마 검증 범위 밖).

`field`는 파이썬 내장 함수명과 겹쳐 속성명으로 못 쓰므로 `field_name`으로
선언하고 alias="field"로 와이어 키만 맞춘다(브리핑 지정).
"""

from __future__ import annotations

import ipaddress
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

_MAX_NAME_LEN = 100
_MAX_DEPARTMENT_ID_LEN = 40
_MAX_URL_LEN = 500
_MAX_SEASON_LEN = 200
_MAX_FIELD_LEN = 200
_MAX_DESCRIPTION_LEN = 2000

_URL_DETAIL = "유효한 https 공식 링크만 허용됩니다."
_DEPARTMENT_ID_DETAIL = "department_id 형식이 올바르지 않습니다."

SocietyKind = Literal["학회", "동아리"]
ModerationStatus = Literal["pending", "approved", "rejected"]


def _validate_official_url(v: str) -> str:
    """https만 허용, IP 리터럴 호스트 금지, userinfo(user:pass@) 금지."""
    parsed = urlparse(v)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(_URL_DETAIL)
    if "@" in parsed.netloc:  # userinfo 포함 (user:pass@host)
        raise ValueError(_URL_DETAIL)
    hostname = parsed.hostname or ""
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return v  # 호스트가 IP 리터럴이 아님 - 정상.
    raise ValueError(_URL_DETAIL)  # 호스트가 IPv4/IPv6 리터럴 - 거부.


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SocietyCreateIn(_CamelModel):
    """학회/동아리 제보 요청. department_id는 Firestore 서브컬렉션 경로 세그먼트로
    그대로 쓰이므로 "/"를 포함할 수 없다."""

    department_id: str = Field(min_length=1, max_length=_MAX_DEPARTMENT_ID_LEN)
    name: str = Field(min_length=1, max_length=_MAX_NAME_LEN)
    kind: SocietyKind
    official_url: str = Field(max_length=_MAX_URL_LEN)
    recruit_season: str | None = Field(default=None, max_length=_MAX_SEASON_LEN)
    field_name: str | None = Field(default=None, alias="field", max_length=_MAX_FIELD_LEN)
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LEN)

    @field_validator("department_id")
    @classmethod
    def _check_department_id(cls, v: str) -> str:
        if "/" in v or v in {".", ".."}:
            raise ValueError(_DEPARTMENT_ID_DETAIL)
        return v

    @field_validator("official_url")
    @classmethod
    def _check_official_url(cls, v: str) -> str:
        return _validate_official_url(v)


class SocietySubmitOut(_CamelModel):
    """POST /api/societies 응답 - 방금 만든 문서 id와 대기 상태만."""

    id: str
    moderation_status: ModerationStatus


class SocietyOut(_CamelModel):
    """GET /api/societies 응답 항목 - 승인된 제출만, submitter_uid는 절대 포함하지 않는다."""

    id: str
    name: str
    kind: SocietyKind
    official_url: str
    recruit_season: str | None = None
    field_name: str | None = Field(default=None, alias="field")
    description: str | None = None
