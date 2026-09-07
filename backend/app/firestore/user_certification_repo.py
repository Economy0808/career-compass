"""Firestore 기반 사용자 제보 자격증(user_certifications) 리포지토리.

app/firestore/society_repo.py와 동일한 패턴(제출=pending 적재, 승인만 공개
조회, 신고=임시조치, CLI 전용 모더레이션 헬퍼)을 따르되 department_id 서브
컬렉션이 필요 없어 평평한(flat) 컬렉션으로 둔다 - certification_repo.py의
`certifications`(큐레이션/공식) 컬렉션과는 별도 경로다. 절대 섞이지 않는다:
큐레이션 자격증은 ETL 스크립트만 쓰고, 이 컬렉션은 일반 유저 제보만 쓴다.

verified=False, source_type="user_submitted"는 어떤 모더레이션 상태에서도
바뀌지 않는다 - 승인(approved)은 "검색 노출을 허용"할 뿐, 큐레이션 등급
("실존·공식" 배지)으로 격상시키지 않는다(하드 요구사항).
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from google.cloud.firestore import SERVER_TIMESTAMP, Client
from google.cloud.firestore_v1.base_query import FieldFilter

_COLLECTION = "user_certifications"


def _collection(db: Client) -> Any:
    return db.collection(_COLLECTION)


def create(
    db: Client, *, name: str, name_norm: str, issuer: str, official_url: str, submitter_uid: str
) -> dict[str, Any]:
    """제보 문서를 moderation_status="pending"으로 만든다. 반환값은 라우터 응답용 최소 정보."""
    doc_id = str(uuid.uuid4())
    data: dict[str, Any] = {
        "name": name,
        "name_norm": name_norm,
        "issuer": issuer,
        "official_url": official_url,
        "source_type": "user_submitted",
        "verified": False,
        "submitter_uid": submitter_uid,
        "submitted_at": SERVER_TIMESTAMP,
        "moderation_status": "pending",
        "reviewed_at": None,
    }
    _collection(db).document(doc_id).set(data)
    return {"id": doc_id, "moderation_status": "pending"}


def list_approved(db: Client) -> list[dict[str, Any]]:
    """moderation_status == "approved" 문서만, CertificationOut 필드 모양으로 반환한다.

    submitter_uid 등 내부 필드는 여기서 걸러낸다(society_repo.list_approved와
    동일한 이유) - GET 응답에 제보자 신원이 노출되면 안 된다.
    """
    docs = _collection(db).where(filter=FieldFilter("moderation_status", "==", "approved")).stream()
    results: list[dict[str, Any]] = []
    for doc in docs:
        data = doc.to_dict() or {}
        results.append(
            {
                "jmcd": "",
                "name": data.get("name"),
                "name_norm": data.get("name_norm"),
                "issuer": data.get("issuer", ""),
                "scope": "",
                "cert_class": "",
                "tier": "",
                "official_url": data.get("official_url", ""),
                "schedule": None,
                "source_type": "user_submitted",
                "verified": False,
            }
        )
    return results


def report(db: Client, *, doc_id: str, reporter_uid: str) -> bool:
    """신고 접수 = 임시조치(망법 §44조의2). moderation_status를 "pending"으로
    되돌려 즉시 list_approved()에서 빠지게 한다. society_repo.report_society와
    동일한 idempotent 동작 - 이미 pending이면 아무 것도 쓰지 않고 True."""
    doc_ref = _collection(db).document(doc_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return False
    data = snapshot.to_dict() or {}
    if data.get("moderation_status") == "pending":
        return True
    doc_ref.update(
        {
            "moderation_status": "pending",
            "reported_by": reporter_uid,
            "reported_at": SERVER_TIMESTAMP,
        }
    )
    return True


def list_pending(db: Client) -> list[dict[str, Any]]:
    """전체 pending 문서 나열 - CLI 모더레이션(scripts/moderate_certifications.py) 전용."""
    docs = _collection(db).where(filter=FieldFilter("moderation_status", "==", "pending"))
    results: list[dict[str, Any]] = []
    for doc in docs.stream():
        data = doc.to_dict() or {}
        results.append(
            {
                "id": doc.id,
                "name": data.get("name"),
                "issuer": data.get("issuer"),
                "official_url": data.get("official_url"),
                "submitter_uid": data.get("submitter_uid"),
                "reported_by": data.get("reported_by"),
            }
        )
    return results


def set_moderation_status(
    db: Client, *, doc_id: str, status: Literal["approved", "rejected"]
) -> bool:
    """CLI 모더레이션 전용 - moderation_status를 확정하고 reviewed_at을 찍는다.
    문서가 없으면 False."""
    doc_ref = _collection(db).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.update({"moderation_status": status, "reviewed_at": SERVER_TIMESTAMP})
    return True
