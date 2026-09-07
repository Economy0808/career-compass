"""자격증 검색 API (prefix /api/certifications).

Phase 3(큐레이션 자격증 Firestore 적재)의 소비자 엔드포인트. 컬렉션이 100건
안팎이라(app/etl/seeds/certifications_curated.json 참고) Firestore 쿼리 대신
list_all()을 프로세스 메모리에 짧게 캐싱해두고 부분일치 필터만 파이썬으로 돈다
- app/api/courses.py의 search_courses(department/college in-memory 필터)와
같은 결의 타협이다.

인증은 걸지 않는다 - app/api/societies.py의 list_societies/community.py의
list_board_posts와 동일하게 "공개 열람 콘텐츠 목록"으로 취급(자격증 마스터는
개인정보가 아니라 공공 데이터라 로그인 게이트가 필요 없다).
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud.firestore import Client

from app.firestore import certification_repo
from app.firestore.client import get_firestore_client
from app.schemas.certifications import CareerPathOut, CertificationOut
from app.services.cert_match import normalize_cert_name

router = APIRouter(prefix="/api/certifications", tags=["certifications"])

_CAREER_NOT_FOUND = HTTPException(
    status_code=404, detail="해당 진로의 자격증 정보를 찾을 수 없어요."
)

# ponytail: 프로세스 로컬 TTL 캐시, 인스턴스 간 무효화 없음(멀티 인스턴스 배포 시
# 최대 _CACHE_TTL_SEC초 낡은 값을 볼 수 있음) - ~100건 규모의 읽기 위주 컬렉션엔
# 충분하다. 컬렉션이 커지거나 즉시 반영이 필요해지면 Firestore 쿼리로 교체할 것.
_CACHE_TTL_SEC = 60.0
_cache: dict[str, Any] = {"certs": None, "at": 0.0}


def _list_all_cached(db: Client) -> list[dict[str, Any]]:
    now = time.monotonic()
    if _cache["certs"] is None or now - _cache["at"] > _CACHE_TTL_SEC:
        _cache["certs"] = certification_repo.list_all(db)
        _cache["at"] = now
    return _cache["certs"]  # type: ignore[no-any-return]


def filter_certifications(
    certs: list[dict[str, Any]], q: str = "", scope: str | None = None
) -> list[dict[str, Any]]:
    """이름 부분일치(q) + scope 필터. 순수 함수 - Firestore/FastAPI 의존성 없음.

    q는 normalize_cert_name으로 정규화해 저장된 name_norm과 대조한다 - 공백/
    문장부호/대소문자 차이를 무시하기 위함(app/services/cert_match.py 재사용).
    """
    results = certs
    if scope:
        results = [c for c in results if c.get("scope") == scope]
    if q:
        q_norm = normalize_cert_name(q)
        results = [c for c in results if q_norm in c.get("name_norm", "")]
    return results


@router.get("", response_model=list[CertificationOut])
async def search_certifications(
    q: str = Query(default=""),
    scope: str | None = Query(default=None),
    db: Client = Depends(get_firestore_client),
) -> list[dict[str, Any]]:
    """q/scope로 자격증을 검색한다. 둘 다 비면 전체 목록을 반환한다."""
    return filter_certifications(_list_all_cached(db), q=q, scope=scope)


@router.get("/by-career", response_model=CareerPathOut)
async def get_certifications_by_career(
    career: str = Query(...),
    db: Client = Depends(get_firestore_client),
) -> dict[str, Any]:
    """진로명으로 career_paths 문서를 조회한다(자격증 name/tier/cert_id 리스트)."""
    doc = certification_repo.get_career_path(db, normalize_cert_name(career))
    if doc is None:
        raise _CAREER_NOT_FOUND
    return doc
