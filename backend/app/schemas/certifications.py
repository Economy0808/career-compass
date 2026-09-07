"""/api/certifications 요청/응답 스키마.

app/schemas/courses.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.

사용자 제보(user_submitted) 자격증 스키마는 app/schemas/societies.py의
관례를 그대로 재사용한다: URL 검증(_validate_official_url, https만 허용)과
ModerationStatus Literal을 그 모듈에서 import해 쓴다 - 두 크라우드소싱
기능(학회/동아리, 자격증)의 신뢰 규칙이 동일하므로 중복 정의하지 않는다.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.schemas.societies import ModerationStatus, _validate_official_url

_MAX_NAME_LEN = 100
_MAX_URL_LEN = 500


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class CertificationOut(_CamelModel):
    """certifications/{doc} 문서 하나 (검색 결과 항목).

    verified는 저장된 필드가 아니라 app/api/certifications.py가 병합 시점에
    source_type을 보고 계산해 채워 넣는다(큐레이션/공식=True, user_submitted=
    항상 False) - 유저 제보가 모더레이션 승인을 받아도 큐레이션 등급으로
    격상되지 않는다는 하드 요구사항을 스키마 레벨에서도 드러낸다.
    """

    jmcd: str = ""
    name: str
    name_norm: str
    issuer: str = ""
    scope: str
    cert_class: str = ""
    tier: str = ""
    official_url: str = ""
    schedule: dict[str, Any] | None = None
    source_type: str = ""
    verified: bool = True


class CertificationCreateIn(_CamelModel):
    """POST /api/certifications 요청 - 유저가 DB에 없는 자격증을 제보한다.

    tier/scope 등은 큐레이터 전용 필드라 여기 없다(브리핑 지정) - 큐레이터가
    CLI 모더레이션 시 필요하면 직접 채운다. 연락처 필드도 societies와 동일한
    이유로 설계상 두지 않는다.
    """

    name: str = Field(min_length=1, max_length=_MAX_NAME_LEN)
    issuer: str = Field(min_length=1, max_length=_MAX_NAME_LEN)
    official_url: str = Field(max_length=_MAX_URL_LEN)

    @field_validator("official_url")
    @classmethod
    def _check_official_url(cls, v: str) -> str:
        return _validate_official_url(v)


class CertificationSubmitOut(_CamelModel):
    """POST /api/certifications 응답 - 방금 만든 문서 id와 대기 상태만."""

    id: str
    moderation_status: ModerationStatus


class CareerCertRefOut(_CamelModel):
    """career_paths 문서 안의 자격증 참조 항목 - cert_id로 CertificationOut을 조회할 수 있다."""

    name: str
    tier: str = ""
    cert_id: str = ""


class CareerPathOut(_CamelModel):
    """career_paths/{slug} 문서."""

    name: str
    certs: list[CareerCertRefOut] = []
