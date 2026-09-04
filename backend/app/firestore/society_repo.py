"""Firestore 기반 학회/동아리 크라우드소싱 제출 리포지토리 (Stage A + B).

## 컬렉션 레이아웃

`academic_societies/{department_id}/societies/{doc_id}` - 학과별 서브컬렉션.
문서 id는 story_repo.py와 동일하게 서버 생성 uuid4를 쓴다(department_id는
사용자 입력이라 그대로 문서 id로 쓰면 충돌/문자 제약 문제가 생긴다).

## Stage A 범위

"제출을 pending으로 쌓기"와 "승인된 문서만 조회하기" 두 가지.
submitter_uid는 이 모듈이 쓰기만 하고, list_approved()는 절대 돌려주지 않는다
(GET 응답에 제보자 신원이 노출되면 안 된다는 하드 요구사항).

## Stage B 범위 (신고 + 모더레이션)

report_society()는 망법 §44조의2 임시조치 - moderation_status를 pending으로
되돌려 즉시 list_approved()에서 빠지게 한다. list_pending()/set_moderation_status()는
CLI 전용(scripts/moderate_societies.py) - 창업자 1인 운영이라 별도 관리자
role/HTTP 엔드포인트를 두지 않는다(브리핑 지시).
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from google.cloud.firestore import SERVER_TIMESTAMP, Client
from google.cloud.firestore_v1.base_query import FieldFilter

_ROOT_COLLECTION = "academic_societies"
_SUBCOLLECTION = "societies"


def _collection(db: Client, department_id: str) -> Any:
    return db.collection(_ROOT_COLLECTION).document(department_id).collection(_SUBCOLLECTION)


def create_society(
    db: Client,
    *,
    department_id: str,
    name: str,
    kind: str,
    official_url: str,
    recruit_season: str | None,
    field: str | None,
    description: str | None,
    submitter_uid: str,
) -> dict[str, Any]:
    """제출 문서를 moderation_status="pending"으로 만든다. 반환값은 라우터 응답용 최소 정보."""
    doc_id = str(uuid.uuid4())
    data: dict[str, Any] = {
        "name": name,
        "kind": kind,
        "official_url": official_url,
        "recruit_season": recruit_season,
        "field": field,
        "description": description,
        "source_type": "crowdsource",
        "submitter_uid": submitter_uid,
        "submitted_at": SERVER_TIMESTAMP,
        "moderation_status": "pending",
        "reviewed_at": None,
    }
    _collection(db, department_id).document(doc_id).set(data)
    return {"id": doc_id, "moderation_status": "pending"}


def list_approved(db: Client, department_id: str) -> list[dict[str, Any]]:
    """department_id 아래 moderation_status == "approved" 문서만 반환한다.

    submitter_uid/moderation_status/제출 시각 등 내부 필드는 여기서 걸러내고
    공개해도 되는 필드만 dict로 다시 구성한다 - Firestore 원본 dict를 그대로
    돌려주면 나중에 내부 필드가 추가될 때마다 이 함수를 잊고 그대로 새어나갈
    위험이 있다.
    """
    docs = (
        _collection(db, department_id)
        .where(filter=FieldFilter("moderation_status", "==", "approved"))
        .stream()
    )
    results: list[dict[str, Any]] = []
    for doc in docs:
        data = doc.to_dict() or {}
        results.append(
            {
                "id": doc.id,
                "name": data.get("name"),
                "kind": data.get("kind"),
                "official_url": data.get("official_url"),
                "recruit_season": data.get("recruit_season"),
                "field": data.get("field"),
                "description": data.get("description"),
            }
        )
    return results


def report_society(db: Client, *, department_id: str, doc_id: str, reporter_uid: str) -> bool:
    """신고 접수 = 임시조치. moderation_status를 "pending"으로 되돌려 즉시
    list_approved()에서 빠지게 한다(재검수 대기 상태로 노출 차단).

    이미 pending이면 아무 것도 쓰지 않고 성공 처리한다(재신고 idempotent-ish).
    문서가 없으면 False를 돌려줘 라우터가 404로 응답하게 한다. 신고자 신원은
    reported_by에 기록하지만 이 모듈의 다른 어떤 함수도(list_approved 등) 그
    필드를 GET 응답으로 돌려주지 않는다 - CLI 모더레이션(list_pending)에서만 본다.
    """
    doc_ref = _collection(db, department_id).document(doc_id)
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
    """전체 학과의 pending 문서를 collection_group 쿼리로 나열한다 - CLI 모더레이션
    (scripts/moderate_societies.py) 전용. submitter_uid/reported_by를 포함하지만
    이 함수는 HTTP 라우터에서 절대 쓰지 않는다(founder 전용 CLI 경로만 호출)."""
    docs = db.collection_group(_SUBCOLLECTION).where(
        filter=FieldFilter("moderation_status", "==", "pending")
    )
    results: list[dict[str, Any]] = []
    for doc in docs.stream():
        data = doc.to_dict() or {}
        parent_doc = doc.reference.parent.parent
        results.append(
            {
                "department_id": parent_doc.id if parent_doc is not None else "?",
                "id": doc.id,
                "name": data.get("name"),
                "kind": data.get("kind"),
                "official_url": data.get("official_url"),
                "submitter_uid": data.get("submitter_uid"),
                "reported_by": data.get("reported_by"),
            }
        )
    return results


def set_moderation_status(
    db: Client, *, department_id: str, doc_id: str, status: Literal["approved", "rejected"]
) -> bool:
    """CLI 모더레이션 전용 - moderation_status를 확정하고 reviewed_at을 찍는다.
    문서가 없으면 False."""
    doc_ref = _collection(db, department_id).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.update({"moderation_status": status, "reviewed_at": SERVER_TIMESTAMP})
    return True
