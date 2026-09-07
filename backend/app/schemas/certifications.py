"""/api/certifications 요청/응답 스키마.

app/schemas/courses.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class CertificationOut(_CamelModel):
    """certifications/{doc} 문서 하나 (검색 결과 항목)."""

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


class CareerCertRefOut(_CamelModel):
    """career_paths 문서 안의 자격증 참조 항목 - cert_id로 CertificationOut을 조회할 수 있다."""

    name: str
    tier: str = ""
    cert_id: str = ""


class CareerPathOut(_CamelModel):
    """career_paths/{slug} 문서."""

    name: str
    certs: list[CareerCertRefOut] = []
