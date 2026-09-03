"""학번 HMAC 해시 저장소(student_verifications/{uid}) - 원문은 저장하지 않는다.

## 왜 원문 대신 HMAC인가

학번은 평문으로 어디에도 상시 저장하지 않는다(PIPA 최소수집 원칙, 보안 세션
브리핑 확정). 그런데 "같은 학번으로 중복 가입했는가"는 확인해야 하므로,
결정적(deterministic)인 해시 하나만 저장해 동일 입력이 항상 동일 출력을 내게
한다 - 원문 없이도 동등성 비교(dedup)가 가능하다.

평범한 SHA256이 아니라 HMAC-SHA256(key=secret_key, msg=학번)을 쓰는 이유: 학번은
10자리 숫자라 전수 대입(brute force)이 쉽다. 키 없는 해시라면 공격자가 10^10개
학번을 미리 다 해시해 둔 레인보우테이블로 이 컬렉션(설령 유출되더라도)의 해시를
즉시 원문으로 되돌릴 수 있다. 키(secret_key)가 없으면 사전 계산이 불가능해진다.

메시지에 컨텍스트 문자열("student-id-v1")을 섞는 이유: 나중에 다른 필드도 같은
secret_key로 HMAC할 일이 생기면, 컨텍스트가 없을 때 두 필드가 우연히 같은 값에
대해 같은 해시를 낼 수 있다(예: 학번과 전화번호 뒷자리가 같은 값). 컨텍스트로
용도를 분리해 두면 필드 간 해시가 서로 교차하지 않는다.

## SECRET_KEY 로테이션 시 주의

secret_key를 회전하면 기존에 저장된 해시와 새로 계산되는 해시가 달라져 dedup이
깨진다(기존 유저와 같은 학번으로 재가입을 시도해도 걸리지 않는다) - 로테이션
시에는 student_verifications 컬렉션 전체를 새 키로 재해시하는 백필이 필요하다.
지금은 config.secret_key(Secret Manager 관리)를 그대로 재사용하지만, 나중에
secret_key 회전 주기와 이 해시의 안정성 요구가 어긋나면 전용 페퍼(별도 시크릿)로
승격할 여지를 남겨둔다(과설계 방지 - 지금은 필요 없다).
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

_COLLECTION = "student_verifications"
_HMAC_CONTEXT = "student-id-v1"


def _hash_student_id(secret_key: str, student_id: str) -> str:
    """HMAC-SHA256(key=secret_key, msg=컨텍스트:학번)의 16진 다이제스트.

    같은 (secret_key, student_id) 조합은 항상 같은 문자열을 낸다(결정적) -
    dedup 조회(find_uid_by_student_id_hash)가 이 성질에 의존한다.
    """
    message = f"{_HMAC_CONTEXT}:{student_id}".encode()
    return hmac.new(secret_key.encode(), message, hashlib.sha256).hexdigest()


def store_student_id_hash(db: Client, uid: str, student_id: str, *, secret_key: str) -> str:
    """uid의 학번 해시를 저장한다(merge하지 않고 문서 전체를 갈아끼운다 - 이
    컬렉션엔 이 두 필드뿐이라 read -> merge 왕복이 불필요하다).

    verified는 이미 있던 값을 유지하거나(재검증 상태를 온보딩 재제출이 지우지
    않게), 처음이면 False로 시작한다(학생증 대조로 이 값을 True로 바꾸는
    플로우는 이번 범위 밖 - 자리만 마련해 둔다).

    반환값은 계산된 해시다 - 호출부가 dedup 조회 없이 그대로 로그/응답에 쓸 수
    있게 한다(현재 호출부는 쓰지 않지만, find_uid_by_student_id_hash와 짝을
    맞추는 관례).
    """
    doc_ref = db.collection(_COLLECTION).document(uid)
    snapshot = doc_ref.get()
    existing = snapshot.to_dict() if snapshot.exists else None
    student_id_hmac = _hash_student_id(secret_key, student_id)
    doc_ref.set(
        {
            "student_id_hmac": student_id_hmac,
            "verified": bool((existing or {}).get("verified", False)),
        }
    )
    return student_id_hmac


def find_uid_by_student_id_hash(db: Client, student_id_hmac: str) -> str | None:
    """같은 학번 해시를 가진 uid를 찾는다(중복가입 dedup 조회). 없으면 None.

    해시가 유니크하다는 스키마 제약이 없으므로(Firestore는 유니크 제약을 걸 수
    없다) 여러 건이 매치될 가능성을 이론상 배제할 수 없지만, 이 조회의 목적은
    "이미 등록된 사람이 있는가"이므로 하나만 찾으면 충분하다(limit(1)).
    """
    query: Any = (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("student_id_hmac", "==", student_id_hmac))
        .limit(1)
    )
    docs = list(query.stream())
    return docs[0].id if docs else None
