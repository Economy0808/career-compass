"""학회/동아리 크라우드소싱 제출 API (Stage A: 제출/조회 + Stage B: 신고).

app/api/stories.py와 동일한 관례(Firestore 클라이언트 의존성 주입, camelCase
스키마, require_yonsei_verified 쓰기 게이트, rate_limit)를 따른다.

법무 확정 하드 요구사항: 연락처 필드 자체가 스키마에 없고(app/schemas/societies.py),
자유서술 필드는 app/services/pii_guard.py로 서버가 다시 스캔한다. 공식 링크는
https + IP 리터럴/유저정보 금지만 허용한다(스키마의 field_validator).

신고(POST .../report)는 망법 §44조의2 임시조치 구현 - moderation_status를
pending으로 되돌려 즉시 조회 목록에서 뺀다. 승인/거절 모더레이션은 관리자
role/HTTP 엔드포인트 없이 scripts/moderate_societies.py CLI로만 한다(창업자
1인 운영이라 role 기반 인가 시스템을 새로 만들 필요가 없다는 브리핑 지시).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore import society_repo
from app.firestore.client import get_firestore_client
from app.schemas.societies import (
    SocietyCreateIn,
    SocietyOut,
    SocietyReportOut,
    SocietySubmitOut,
)
from app.services.pii_guard import assert_no_pii

_SOCIETY_NOT_FOUND = HTTPException(status_code=404, detail="학회/동아리 제출을 찾을 수 없어요.")

router = APIRouter(prefix="/api/societies", tags=["societies"])


@router.post("", response_model=SocietySubmitOut, status_code=201)
async def submit_society(
    payload: SocietyCreateIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("society-submit", limit=10)),
) -> SocietySubmitOut:
    """학회/동아리 정보를 제보한다. 즉시 노출되지 않고 moderation_status=pending으로 쌓인다.

    자유서술 필드(이름/설명/분야/모집시기) 전부를 pii_guard로 스캔한다 - 연락처
    필드가 스키마에 없는 것만으로는 사용자가 설명란에 직접 전화번호/카톡을 적어
    넣는 것까지 막지 못하기 때문이다.
    """
    assert_no_pii(payload.name, payload.description, payload.field_name, payload.recruit_season)
    result = society_repo.create_society(
        db,
        department_id=payload.department_id,
        name=payload.name,
        kind=payload.kind,
        official_url=payload.official_url,
        recruit_season=payload.recruit_season,
        field=payload.field_name,
        description=payload.description,
        submitter_uid=user.uid,
    )
    return SocietySubmitOut(**result)


@router.get("", response_model=list[SocietyOut])
async def list_societies(
    department_id: str, db: Client = Depends(get_firestore_client)
) -> list[SocietyOut]:
    """department_id의 승인된 학회/동아리만 반환한다. 인증 불요(app/api/community.py의
    list_board_posts와 동일하게 공개 열람 콘텐츠 목록으로 취급)."""
    return [SocietyOut(**item) for item in society_repo.list_approved(db, department_id)]


@router.post("/{department_id}/{society_id}/report", response_model=SocietyReportOut)
async def report_society(
    department_id: str,
    society_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("society-report", limit=10)),
) -> SocietyReportOut:
    """학회/동아리 제출을 신고한다 - 망법 §44조의2 임시조치.

    효과는 moderation_status를 강제로 "pending"으로 되돌리는 것뿐이다(즉시
    삭제하지 않는다) - 승인 목록(GET)에서 즉시 빠지고 창업자의 CLI 재검수를
    기다린다(scripts/moderate_societies.py). 이미 pending인 문서를 다시
    신고해도 에러 없이 200을 돌려준다(idempotent-ish). 신고자 uid는 절대
    응답에 포함하지 않는다.
    """
    found = society_repo.report_society(
        db, department_id=department_id, doc_id=society_id, reporter_uid=user.uid
    )
    if not found:
        raise _SOCIETY_NOT_FOUND
    return SocietyReportOut()
