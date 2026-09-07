"""자격증 검색 API (prefix /api/certifications).

Phase 3(큐레이션 자격증 Firestore 적재)의 소비자 엔드포인트. 컬렉션이 100건
안팎이라(app/etl/seeds/certifications_curated.json 참고) Firestore 쿼리 대신
list_all()을 프로세스 메모리에 짧게 캐싱해두고 부분일치 필터만 파이썬으로 돈다
- app/api/courses.py의 search_courses(department/college in-memory 필터)와
같은 결의 타협이다.

검색(GET)은 인증을 걸지 않는다 - app/api/societies.py의 list_societies/
community.py의 list_board_posts와 동일하게 "공개 열람 콘텐츠 목록"으로
취급(자격증 마스터는 개인정보가 아니라 공공 데이터라 로그인 게이트가 필요
없다).

## 유저 제보(user_submitted) 자격증 - app/api/societies.py와 동일한 신뢰 체계

DB에 없는 자격증을 유저가 제보하는 기능은 학회/동아리 크라우드소싱과 완전히
같은 패턴(제출 게이트=require_yonsei_verified+rate_limit, PII 재검사, https
전용 URL 검증, moderation_status=pending 적재, 신고=망법 §44조의2 임시조치,
모더레이션은 CLI 전용)이다. 데이터는 별도 컬렉션(app/firestore/
user_certification_repo.py의 user_certifications)에 쌓아 큐레이션 자격증
컬렉션(certifications)과 절대 섞이지 않게 하고, 검색 결과 병합 시점에만
합친다 - 승인(approved)돼도 verified=True로 격상되지 않는다(하드 요구사항).
"""

from __future__ import annotations

import re
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud.firestore import Client

from app.auth.deps import require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore import certification_repo, user_certification_repo
from app.firestore.client import get_firestore_client
from app.schemas.certifications import (
    CareerPathOut,
    CertificationCreateIn,
    CertificationOut,
    CertificationSubmitOut,
)
from app.schemas.societies import SocietyReportOut
from app.services.cert_match import normalize_cert_name
from app.services.pii_guard import assert_no_pii

router = APIRouter(prefix="/api/certifications", tags=["certifications"])

_CAREER_NOT_FOUND = HTTPException(
    status_code=404, detail="해당 진로의 자격증 정보를 찾을 수 없어요."
)
_CERT_NOT_FOUND = HTTPException(status_code=404, detail="자격증 제보를 찾을 수 없어요.")
_DUPLICATE_CERT = HTTPException(status_code=409, detail="이미 등록된 자격증입니다.")
_CANNOT_REPORT_CURATED = HTTPException(
    status_code=400, detail="공식 등재된 자격증은 신고할 수 없어요."
)

# ponytail: 프로세스 로컬 TTL 캐시, 인스턴스 간 무효화 없음(멀티 인스턴스 배포 시
# 최대 _CACHE_TTL_SEC초 낡은 값을 볼 수 있음) - ~100건 규모의 읽기 위주 컬렉션엔
# 충분하다. 컬렉션이 커지거나 즉시 반영이 필요해지면 Firestore 쿼리로 교체할 것.
_CACHE_TTL_SEC = 60.0
_cache: dict[str, Any] = {"certs": None, "at": 0.0}


def _list_all_cached(db: Client) -> list[dict[str, Any]]:
    """큐레이션/공식 자격증 전체 + 승인된 유저 제보 자격증을 합쳐 캐싱한다.

    verified는 저장된 필드가 아니라 여기서 source_type을 보고 계산해 채운다 -
    큐레이션(open_api/curated)은 True, 유저 제보(user_submitted, 승인 여부
    무관)는 항상 False. list_approved()는 이미 moderation_status=="approved"
    문서만 돌려주므로 pending/rejected는 이 병합 결과에 애초에 들어오지 않는다.
    """
    now = time.monotonic()
    if _cache["certs"] is None or now - _cache["at"] > _CACHE_TTL_SEC:
        curated = certification_repo.list_all(db)
        for cert in curated:
            cert["verified"] = True
        _cache["certs"] = curated + user_certification_repo.list_approved(db)
        _cache["at"] = now
    return _cache["certs"]  # type: ignore[no-any-return]


# 3자 미만 + 순수 ASCII인 쿼리("AI" 등)는 원문 그대로 부분일치시키면 "AICPA" 같은
# 다른 자격명 안에 우연히 포함된 문자열까지 잡아버린다("AI" in "AICPA"). 이런
# 경우만 단어 경계(\b) 토큰 매칭으로 좁힌다 - 한글 쿼리는 애초에 짧아도(2자)
# 오탐 빈도가 낮고 정규화(name_norm) substring이 이미 널리 쓰이는 방식이라 그대로
# 둔다.
_SHORT_ASCII_LEN = 3


def _matches_short_ascii_query(q_stripped: str, name: str) -> bool:
    """짧은 ASCII 쿼리를 name에 대해 단어 경계 매칭한다(부분일치 아님)."""
    return re.search(rf"\b{re.escape(q_stripped.lower())}\b", name.lower()) is not None


def filter_certifications(
    certs: list[dict[str, Any]], q: str = "", scope: str | None = None
) -> list[dict[str, Any]]:
    """이름/진로(search_terms) 부분일치(q) + scope 필터. 순수 함수 - Firestore/FastAPI 의존성 없음.

    q는 normalize_cert_name으로 정규화해 저장된 name_norm과 대조한다 - 공백/
    문장부호/대소문자 차이를 무시하기 위함(app/services/cert_match.py 재사용).
    name_norm에 없어도 search_terms(로더가 career_cert_map에서 역인덱싱해 붙인
    진로명 목록 - app/scripts/load_curated_certifications.py 참고)에 걸리면
    매치로 친다 - "증권" 검색이 자격명이 아니라 그 자격이 속한 진로명으로
    걸리게 하기 위함. 유저 제보 자격증(user_submitted)은 search_terms가 없어
    이름으로만 매치된다.

    짧은(3자 미만) 순수 ASCII 쿼리는 예외로, 부분일치 대신 name에 대한 단어
    경계 매칭만 쓴다(위 _matches_short_ascii_query 참고) - "AI"가 "AICPA"를
    잘못 맞히는 문제를 막는다.
    """
    results = certs
    if scope:
        results = [c for c in results if c.get("scope") == scope]
    if q:
        q_stripped = q.strip()
        if q_stripped.isascii() and len(q_stripped) < _SHORT_ASCII_LEN:
            results = [
                c for c in results if _matches_short_ascii_query(q_stripped, c.get("name", ""))
            ]
        else:
            q_norm = normalize_cert_name(q)
            results = [
                c
                for c in results
                if q_norm in c.get("name_norm", "")
                or any(q_norm in normalize_cert_name(term) for term in c.get("search_terms") or [])
            ]
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


@router.post("", response_model=CertificationSubmitOut, status_code=201)
async def submit_certification(
    payload: CertificationCreateIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("cert-submit", limit=10)),
) -> CertificationSubmitOut:
    """DB에 없는 자격증을 제보한다. 즉시 노출되지 않고 moderation_status=pending으로 쌓인다.

    name/issuer 둘 다 pii_guard로 스캔한다(app/api/societies.py의
    submit_society와 동일한 이유). name_norm이 이미 큐레이션/공식 자격증과
    겹치면(대소문자·공백·문장부호 무시) 409로 거부해 중복 제보가 기존 검증된
    항목을 그림자처럼 덮어쓰지 못하게 한다.
    """
    assert_no_pii(payload.name, payload.issuer)
    name_norm = normalize_cert_name(payload.name)
    if certification_repo.get_by_name_norm(db, name_norm) is not None:
        raise _DUPLICATE_CERT
    result = user_certification_repo.create(
        db,
        name=payload.name,
        name_norm=name_norm,
        issuer=payload.issuer,
        official_url=payload.official_url,
        submitter_uid=user.uid,
    )
    return CertificationSubmitOut(**result)


@router.post("/{cert_id}/report", response_model=SocietyReportOut)
async def report_certification(
    cert_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("cert-report", limit=10)),
) -> SocietyReportOut:
    """유저 제보 자격증을 신고한다 - 망법 §44조의2 임시조치(app/api/societies.py의
    report_society와 동일한 효과: moderation_status를 강제로 pending으로 되돌릴 뿐,
    즉시 삭제하지 않는다).

    cert_id가 큐레이션/공식 자격증(certifications 컬렉션) 문서를 가리키면
    애초에 신고 대상이 아니므로 400으로 거부한다 - 신뢰 등급이 다른 두 컬렉션을
    같은 엔드포인트로 받다 보니 여기서 먼저 구분해야 한다. 신고자 uid는 절대
    응답에 포함하지 않는다.
    """
    if certification_repo.get_by_jmcd(db, cert_id) is not None:
        raise _CANNOT_REPORT_CURATED
    found = user_certification_repo.report(db, doc_id=cert_id, reporter_uid=user.uid)
    if not found:
        raise _CERT_NOT_FOUND
    return SocietyReportOut()
