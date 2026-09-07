"""Firestore 기반 국가자격 마스터 리포지토리.

## 컬렉션 레이아웃

`certifications/{jmcd}` - 평평한(flat) 컬렉션. 종목코드(jmcd, 4자리)가
Q-Net 전체에서 유일한 자연키이므로 문서 id로 그대로 쓴다(course_repo.py의
학정번호 관례와 동일) - refresh_certifications.py를 재실행해도 중복이 생기지
않는다(멱등성).

이 모듈은 마스터 자체의 CRUD만 제공한다. LLM 제안 자격증을 name_norm으로
매칭하는 로직(그라운딩)은 별도 작업(bin_suggestion.py)의 관심사이고, 여기서는
조회 함수(get_by_name_norm)만 제공한다.
"""

from __future__ import annotations

from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP, Client
from google.cloud.firestore_v1.base_query import FieldFilter

_COLLECTION = "certifications"
_CAREER_PATH_COLLECTION = "career_paths"

# Firestore 배치 쓰기 최대 오퍼레이션 수 (course_repo.py와 동일한 상한).
_BATCH_LIMIT = 500


def upsert_certifications(db: Client, docs: list[dict[str, Any]]) -> int:
    """certifications 문서를 배치로 upsert하고, 실제로 쓴 문서 수를 반환한다.

    각 doc은 build_certification_docs()가 만든 dict + imported_at(서버
    타임스탬프)을 여기서 채운다 - SERVER_TIMESTAMP 센티널은 네트워크 호출이
    아니라 순수 파이썬 객체이므로 이 함수가 부르는 순간까지도 실제 쓰기는
    일어나지 않는다(batch.commit()에서만 발생).

    문서 id는 기본적으로 jmcd(국가자격 종목코드)다. doc에 "doc_id" 키가 있으면
    그걸 우선 쓰고 저장 필드에서는 뺀다 - 민간/국제 자격처럼 jmcd가 없는 문서를
    scripts/load_curated_certifications.py가 name_norm 슬러그로 적재할 때 쓴다
    (기존 호출부인 refresh_certifications.py는 이 키를 안 넣으므로 동작 그대로).
    """
    collection = db.collection(_COLLECTION)
    written = 0
    for start in range(0, len(docs), _BATCH_LIMIT):
        chunk = docs[start : start + _BATCH_LIMIT]
        batch = db.batch()
        for doc in chunk:
            data = dict(doc)
            data["imported_at"] = SERVER_TIMESTAMP
            doc_id = data.pop("doc_id", None) or data["jmcd"]
            doc_ref = collection.document(doc_id)
            batch.set(doc_ref, data)
        batch.commit()
        written += len(chunk)
    return written


def get_by_jmcd(db: Client, jmcd: str) -> dict[str, Any] | None:
    """종목코드로 단일 자격증 문서를 조회한다. 없으면 None."""
    snapshot = db.collection(_COLLECTION).document(jmcd).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()


def get_by_name_norm(db: Client, name_norm: str) -> dict[str, Any] | None:
    """정규화된 이름으로 자격증 문서를 하나 조회한다(그라운딩 매칭용). 없으면 None."""
    query = (
        db.collection(_COLLECTION).where(filter=FieldFilter("name_norm", "==", name_norm)).limit(1)
    )
    for doc in query.stream():
        return doc.to_dict()
    return None


def list_all(db: Client) -> list[dict[str, Any]]:
    """certifications 전체를 반환한다."""
    return [doc.to_dict() for doc in db.collection(_COLLECTION).stream()]


def upsert_career_paths(db: Client, docs: list[dict[str, Any]]) -> int:
    """career_paths/{slug} 문서를 배치로 upsert한다. 각 doc은 "slug" 키를 문서
    id로 쓰고(load_curated_certifications.py가 normalize_cert_name으로 만듦),
    나머지 키를 그대로 저장한다 - upsert_certifications와 동일한 관례."""
    collection = db.collection(_CAREER_PATH_COLLECTION)
    written = 0
    for start in range(0, len(docs), _BATCH_LIMIT):
        chunk = docs[start : start + _BATCH_LIMIT]
        batch = db.batch()
        for doc in chunk:
            data = {k: v for k, v in doc.items() if k != "slug"}
            data["imported_at"] = SERVER_TIMESTAMP
            batch.set(collection.document(doc["slug"]), data)
        batch.commit()
        written += len(chunk)
    return written


def get_career_path(db: Client, slug: str) -> dict[str, Any] | None:
    """slug(normalize_cert_name(진로명))로 career_paths 문서 하나를 조회한다."""
    snapshot = db.collection(_CAREER_PATH_COLLECTION).document(slug).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()
