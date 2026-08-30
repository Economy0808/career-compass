"""/api/courses 요청/응답 스키마.

app/schemas/explore.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CourseSearchItem(_CamelModel):
    """검색 결과 과목 하나. 프론트가 캔버스 노드의 label(name)·code·level에 그대로
    매핑한다.

    campus는 현재 원천 데이터(대학요람 TXT)에 과목별 컬럼이 없어 항상 None이고,
    response_model_exclude_none 관례로 응답에서 키 자체가 빠진다(2026-08-30 결정 -
    사용자가 나중에 course_catalog 문서에 값을 직접 적재하면, 이 필드 선언
    덕분에 프론트/API 계약 변경 없이 그대로 나타난다).
    """

    code: str
    name: str
    department: str | None = None
    college: str | None = None
    level: int | None = None
    credits: float | None = None
    kind: str | None = None
    campus: str | None = None


class CourseTaxonomyOut(_CamelModel):
    """필터 드롭다운용 단과대/학과 목록 (course_repo.list_taxonomy 그대로 노출)."""

    departments: list[str]
    colleges: list[str]
