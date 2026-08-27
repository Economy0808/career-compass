"""Firestore 기반 유저 프로필 리포지토리.

## 컬렉션 레이아웃

`users/{uid}` - 평평한(flat) 컬렉션. 문서 id는 Firebase Auth uid를 그대로 쓴다
(course_repo.py가 학정번호를 문서 id로 쓰는 것과 같은 이유 - 유저별로 자연스럽게
유일하고, Firebase ID 토큰에서 검증된 uid를 그대로 키로 쓸 수 있어 별도 조회가
필요 없다).

## created_at / consent_at "최초 1회만" 의미론

이 모듈이 갱신하는 필드 중 두 개는 "최초 기록을 영구 보존"해야 한다:

- created_at: 프로필 문서가 실제로 처음 생긴 시각. 매 로그인/동기화마다 다시
  쓰면 "가입일"이라는 의미 자체가 사라진다.
- consent_at: PIPA(개인정보보호법)상 동의 "시점"이 법적으로 의미를 가지므로,
  이후 재동의 API를 호출해도 최초 동의 시점을 덮어써서는 안 된다(최초 동의
  시점을 분쟁 시 증빙으로 남겨야 한다).

updated_at은 반대로 호출될 때마다 항상 현재 시각으로 갱신한다 - "마지막으로
동기화된 시각"이라는 의미이므로 최초 고정이 필요 없다.

이 "최초 1회만" 규칙을 지키기 위해 set(merge=True) 한 번으로 끝내지 않고
읽기 -> 병합 계산 -> 쓰기 순서를 따른다. Firestore merge=True는 필드 단위로
덮어쓰므로 "이 필드가 이미 있으면 건드리지 말라"는 조건부 로직을 표현할 수
없기 때문이다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore import Client

_COLLECTION = "users"


def _doc_ref(db: Client, uid: str) -> Any:
    return db.collection(_COLLECTION).document(uid)


def upsert_user_profile(
    db: Client,
    uid: str,
    *,
    display_name: str | None = None,
    avatar_emoji: str | None = None,
    consent_at: datetime | None = None,
) -> dict[str, Any]:
    """유저 프로필을 만들거나 갱신한다. created_at/consent_at은 최초 1회만 기록한다.

    display_name/avatar_emoji는 None이면 건드리지 않는다(호출부가 "이번엔 이
    필드를 바꾸지 않겠다"는 뜻으로 None을 넘길 수 있게). consent_at은 인자로
    받았고 기존 문서에 아직 없을 때만 기록한다(모듈 docstring의 PIPA 동의 시점
    보존 참고) - 이미 동의 시점이 있으면 이후 호출에서 다시 True를 넘겨도 최초
    시점을 그대로 유지한다.

    반환값은 갱신 이후의 문서 전체(dict)다 - 호출부(auth_sync 라우터)가 별도로
    다시 읽지 않고 그대로 응답을 만들 수 있게 한다.
    """
    doc_ref = _doc_ref(db, uid)
    snapshot = doc_ref.get()
    existing = snapshot.to_dict() if snapshot.exists else None
    now = datetime.now(UTC)

    data: dict[str, Any] = dict(existing) if existing is not None else {}
    if display_name is not None:
        data["display_name"] = display_name
    if avatar_emoji is not None:
        data["avatar_emoji"] = avatar_emoji
    if "created_at" not in data or data.get("created_at") is None:
        data["created_at"] = now
    if consent_at is not None and not data.get("consent_at"):
        data["consent_at"] = consent_at
    data["updated_at"] = now

    doc_ref.set(data)
    return data


def get_user_profile(db: Client, uid: str) -> dict[str, Any] | None:
    """uid로 유저 프로필 문서를 조회한다. 없으면 None."""
    snapshot = _doc_ref(db, uid).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()
