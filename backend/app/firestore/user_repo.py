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

## follower_count / following_count

이 모듈이 직접 쓰지는 않는 비정규화 캐시 필드다 - follow_repo.py가 팔로우/
언팔로우 트랜잭션 안에서 증감시킨다(note_repo.py의 note_count 캐시와 동일한
설계). 필드가 아예 없는 문서(한 번도 팔로우/팔로우당한 적 없는 유저)에서는
`profile.get("follower_count", 0)`처럼 기본값 0으로 읽어야 한다 - get_user_profile은
있는 그대로의 dict만 돌려주고 누락 필드를 채워주지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore import Client

_COLLECTION = "users"


def _doc_ref(db: Client, uid: str) -> Any:
    return db.collection(_COLLECTION).document(uid)


def _read_existing(db: Client, uid: str) -> tuple[Any, dict[str, Any]]:
    """문서 참조와, 이미 있는 필드를 담은 dict(없으면 빈 dict)를 함께 돌려준다.

    upsert_user_profile/update_profile 둘 다 "읽기 -> 병합 계산 -> 쓰기" 순서를
    따르므로(모듈 docstring 참고) 그 첫 단계를 공유한다.
    """
    doc_ref = _doc_ref(db, uid)
    snapshot = doc_ref.get()
    existing = snapshot.to_dict() if snapshot.exists else None
    return doc_ref, (dict(existing) if existing is not None else {})


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
    doc_ref, data = _read_existing(db, uid)
    now = datetime.now(UTC)

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


def update_profile(
    db: Client,
    uid: str,
    *,
    display_name: str | None = None,
    avatar_emoji: str | None = None,
    bio: str | None = None,
) -> dict[str, Any]:
    """본인 프로필 표시 필드(이름/아바타/소개)만 부분 갱신한다.

    None인 인자는 건드리지 않는다 - upsert_user_profile과 동일한 관례. PIPA
    동의 시점(consent_at)은 이 함수의 관심사가 아니다(그건 auth_sync 경로의
    몫). 문서가 아직 없으면(auth/sync를 한 번도 안 부른 유저가 먼저 프로필을
    수정하는 경우) created_at을 지금 시각으로 새로 잡아 만든다 - "최초 1회만"
    의미론을 upsert_user_profile과 동일하게 유지한다.
    """
    doc_ref, data = _read_existing(db, uid)
    now = datetime.now(UTC)

    if display_name is not None:
        data["display_name"] = display_name
    if avatar_emoji is not None:
        data["avatar_emoji"] = avatar_emoji
    if bio is not None:
        data["bio"] = bio
    if "created_at" not in data or data.get("created_at") is None:
        data["created_at"] = now
    data["updated_at"] = now

    doc_ref.set(data)
    return data


def get_user_profile(db: Client, uid: str) -> dict[str, Any] | None:
    """uid로 유저 프로필 문서를 조회한다. 없으면 None."""
    snapshot = _doc_ref(db, uid).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()


def set_interest_tags(db: Client, uid: str, interest_tags: list[str]) -> dict[str, Any]:
    """유저의 관심사 태그(interest_tags) 캐시를 갈아끼운다.

    별자리 발행 상태가 바뀔 때(app/api/constellation.py의 publish 핸들러)
    호출되는 비정규화 필드다. 발행 트랜잭션 밖에서 별도로 계산·갱신하므로
    계산 시점과 이 쓰기 사이에는 느슨한 일관성만 보장된다(동시에 다른 별자리를
    발행/취소해도 이번 쓰기 직후에는 반영되지 않을 수 있음 - 다음 발행 때 다시
    계산되며 자연 수렴한다, 과설계 금지).
    """
    doc_ref, data = _read_existing(db, uid)
    now = datetime.now(UTC)
    data["interest_tags"] = interest_tags
    if "created_at" not in data or data.get("created_at") is None:
        data["created_at"] = now
    data["updated_at"] = now
    doc_ref.set(data)
    return data


def get_profiles(db: Client, uids: list[str]) -> dict[str, dict[str, Any]]:
    """uids 중 실제로 존재하는 프로필만 {uid: 문서 dict}로 배치 조회한다.

    app/firestore/post_repo.py의 liked_post_ids와 동일한 이유로 db.get_all()을
    쓴다 - 목록 화면(app/api/notifications.py의 알림 목록)에서 항목마다 프로필을
    개별 조회하는 N+1 대신, 중복 제거한 고유 uid 집합만 한 번에 가져온다(같은
    actor가 여러 알림에 반복 등장해도 조회는 한 번뿐).
    """
    unique_uids = list(dict.fromkeys(uids))
    if not unique_uids:
        return {}
    refs = [_doc_ref(db, uid) for uid in unique_uids]
    return {snap.id: (snap.to_dict() or {}) for snap in db.get_all(refs) if snap.exists}


def list_users_with_interest_tags(db: Client) -> list[tuple[str, dict[str, Any]]]:
    """interest_tags가 비어있지 않은 유저 전체를 (uid, 문서 dict)로 반환한다.

    유저 규모가 아직 작은 프로토타입 단계라 컬렉션 전체를 스캔해 파이썬에서
    필터링한다(app/firestore/post_repo.py list_by_owner와 동일한 판단 - 규모가
    커지면 where(interest_tags, "!=", [])류 쿼리 필터로 승격할 것, ponytail).
    정렬/절단/본인 제외는 요청자 컨텍스트가 필요해 API 계층(app/api/explore.py)
    책임으로 남겨둔다.
    """
    return [
        (doc.id, data)
        for doc in db.collection(_COLLECTION).stream()
        if (data := doc.to_dict() or {}).get("interest_tags")
    ]


def list_all_users(db: Client, limit: int = 500) -> list[tuple[str, dict[str, Any]]]:
    """유저 전체를 최대 limit명까지 (uid, 문서 dict)로 반환한다.

    Firestore는 부분일치(substring) 검색을 지원하지 않으므로, @닉네임/키워드
    검색(app/api/explore.py의 search_explore_users)이 후보 집합을 통째로 가져와
    파이썬에서 필터링하는 용도다. 관심사 태그가 없는 유저도(닉네임/소개만
    일치하는 경우) 후보에 포함해야 하므로 list_users_with_interest_tags를 재사용할
    수 없다.

    # ponytail: 유저 수백 명 규모까지는 이 상한(500) 안에서 전체 스캔이 감당된다.
    # 그 이상으로 유저가 늘면 Algolia/Typesense 같은 검색 인덱스를 도입할 것.
    """
    return [
        (doc.id, doc.to_dict() or {}) for doc in db.collection(_COLLECTION).limit(limit).stream()
    ]
