"""사용자 비공개 확장 프로필(user_private/{uid}) 리포지토리.

## 왜 users/{uid}와 분리하는가

users/{uid}는 로그인한 전 유저가 read할 수 있는 소셜 프로필 문서다(그 컬렉션의
firestore.rules 규칙 참고). 학과·학년·복수전공·진로 자유서술처럼 가입 온보딩에서
수집하는 민감한 확장 정보를 거기 넣으면 전 유저에게 그대로 새어나간다 - 그래서
소유자 본인만 read할 수 있는 별도 컬렉션에 둔다(보안 세션이 확정한 3목적지
아키텍처. app/api/profiles.py의 POST /onboarding 참고).

학번 원문은 이 문서에도 저장하지 않는다 - HMAC 해시만 student_verification_repo가
클라 read조차 불가능한 별도 컬렉션(student_verifications)에 둔다.

## 쓰기는 서버(Admin SDK) 전용

firestore.rules는 이 컬렉션을 `allow write: if false`로 잠근다 - 클라이언트
SDK 직접 쓰기 경로가 없고, 이 모듈(Admin SDK, 규칙 우회)만 쓴다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore import Client

_COLLECTION = "user_private"


def _doc_ref(db: Client, uid: str) -> Any:
    return db.collection(_COLLECTION).document(uid)


def set_private_profile(
    db: Client,
    uid: str,
    *,
    department: str,
    grade: int,
    double_major: str | None,
    career_text: str | None,
    consents: dict[str, bool],
) -> dict[str, Any]:
    """온보딩에서 수집한 확장 프로필을 저장한다(merge).

    consents는 {"service": bool, "overseas": bool, "marketing": bool} 형태를
    기대한다. 각 항목마다 `consent_{key}_at` 타임스탬프를 두되, app/firestore/
    user_repo.py의 consent_at "최초 1회만" 관례를 그대로 따른다 - 이미 동의
    시점이 기록돼 있으면 이후 호출(재온보딩·재제출)이 True를 다시 넘겨도 최초
    시점을 덮어쓰지 않는다. False인 항목은 애초에 타임스탬프를 기록하지 않는다
    (동의하지 않은 "시점"은 PIPA상 의미가 없는 값이다).
    """
    doc_ref = _doc_ref(db, uid)
    snapshot = doc_ref.get()
    data = dict(snapshot.to_dict()) if snapshot.exists else {}
    now = datetime.now(UTC)

    data["department"] = department
    data["grade"] = grade
    data["double_major"] = double_major
    data["career_text"] = career_text

    for key, agreed in consents.items():
        ts_key = f"consent_{key}_at"
        if agreed and not data.get(ts_key):
            data[ts_key] = now

    data["updated_at"] = now
    doc_ref.set(data)
    return data


def get_private_profile(db: Client, uid: str) -> dict[str, Any] | None:
    """uid의 비공개 확장 프로필을 조회한다. 없으면 None."""
    snapshot = _doc_ref(db, uid).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()
