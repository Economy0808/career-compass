"""Firestore 기반 팔로우 그래프 리포지토리.

## 컬렉션 레이아웃

최상위 `follows` 컬렉션. 문서 id는 `{follower_uid}_{followee_uid}` - 관계
하나당 문서 하나이므로 "이미 팔로우 중인가"를 별도 쿼리 없이 문서 id로 바로
확인할 수 있다. 문서 필드는 {follower_id, followee_id, created_at}.

follower_count/following_count는 users/{uid} 문서에 비정규화해 둔 캐시다
(note_repo.py의 note_count와 동일한 이유 - 매 조회마다 follows 컬렉션을 세는
대신 캐시를 읽는다). follow()/unfollow()가 관계 문서 생성/삭제와 양쪽 유저의
카운트 증감을 하나의 Firestore 트랜잭션으로 묶어, 캐시가 관계 문서와 항상
일치하게 한다.

## 존재하지 않는 followee_uid

# ponytail: follow()는 followee_uid가 실제 Firebase Auth 유저인지 검증하지
# 않는다(Admin SDK 왕복이 추가로 필요해 이 스코프에서는 생략). 존재하지 않는
# uid를 팔로우하면 users/{그 uid} 문서가 카운트 필드만 가진 채로 새로 생긴다 -
# 실제로는 uid가 항상 인증된 라우터 호출에서 나오므로 위험은 낮다. 남용 신호가
# 보이면 라우터에서 followee 프로필 존재 여부를 먼저 확인하도록 승격할 것.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, DocumentSnapshot, Transaction

_FOLLOWS_COLLECTION = "follows"
_USERS_COLLECTION = "users"


class FollowError(Exception):
    """팔로우 그래프 관련 에러의 베이스."""


class SelfFollowError(FollowError):
    """자기 자신을 팔로우하려 할 때."""


def _follow_doc_id(follower_uid: str, followee_uid: str) -> str:
    return f"{follower_uid}_{followee_uid}"


def _follow_doc_ref(db: Client, follower_uid: str, followee_uid: str) -> Any:
    return db.collection(_FOLLOWS_COLLECTION).document(_follow_doc_id(follower_uid, followee_uid))


def _user_doc_ref(db: Client, uid: str) -> Any:
    return db.collection(_USERS_COLLECTION).document(uid)


def _bump_count(
    transaction: Transaction,
    user_ref: Any,
    snapshot: DocumentSnapshot,
    field: str,
    delta: int,
) -> None:
    """users/{uid}.{field}를 delta만큼 바꾸되 0 밑으로 내려가지 않게 한다(바닥 규칙).

    유저 문서가 아직 없으면(auth/sync를 한 번도 안 부른 유저가 팔로우당하는
    경우) 카운트 필드만 담아 merge=True로 새로 만든다 - 기존 필드(있다면)는
    건드리지 않는다.
    """
    existing = snapshot.to_dict() if snapshot.exists else None
    current = (existing or {}).get(field, 0)
    new_value = max(0, current + delta)
    if snapshot.exists:
        transaction.update(user_ref, {field: new_value})
    else:
        transaction.set(user_ref, {field: new_value}, merge=True)


def follow(db: Client, follower_uid: str, followee_uid: str) -> None:
    """follower_uid가 followee_uid를 팔로우한다.

    이미 팔로우 중이면 no-op(관계 문서/카운트 변화 없음) - 프론트가 팔로우
    버튼을 중복 클릭해도 카운트가 두 번 오르지 않는다. 자기 자신을 팔로우하려
    하면 SelfFollowError.
    """
    if follower_uid == followee_uid:
        raise SelfFollowError(f"{follower_uid}는 자기 자신을 팔로우할 수 없습니다.")

    follow_ref = _follow_doc_ref(db, follower_uid, followee_uid)
    follower_ref = _user_doc_ref(db, follower_uid)
    followee_ref = _user_doc_ref(db, followee_uid)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        follow_snapshot = follow_ref.get(transaction=transaction)
        if follow_snapshot.exists:
            return
        # 모든 읽기가 끝난 뒤에야 쓴다 (Firestore 트랜잭션 규칙: 읽기가 쓰기보다 먼저).
        follower_snapshot = follower_ref.get(transaction=transaction)
        followee_snapshot = followee_ref.get(transaction=transaction)
        transaction.set(
            follow_ref,
            {
                "follower_id": follower_uid,
                "followee_id": followee_uid,
                "created_at": datetime.now(UTC),
            },
        )
        _bump_count(transaction, follower_ref, follower_snapshot, "following_count", 1)
        _bump_count(transaction, followee_ref, followee_snapshot, "follower_count", 1)

    _run(transaction)


def unfollow(db: Client, follower_uid: str, followee_uid: str) -> None:
    """팔로우 관계를 끊는다. 애초에 팔로우한 적이 없으면 no-op."""
    follow_ref = _follow_doc_ref(db, follower_uid, followee_uid)
    follower_ref = _user_doc_ref(db, follower_uid)
    followee_ref = _user_doc_ref(db, followee_uid)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        follow_snapshot = follow_ref.get(transaction=transaction)
        if not follow_snapshot.exists:
            return
        follower_snapshot = follower_ref.get(transaction=transaction)
        followee_snapshot = followee_ref.get(transaction=transaction)
        transaction.delete(follow_ref)
        _bump_count(transaction, follower_ref, follower_snapshot, "following_count", -1)
        _bump_count(transaction, followee_ref, followee_snapshot, "follower_count", -1)

    _run(transaction)


def is_following(db: Client, follower_uid: str, followee_uid: str) -> bool:
    """follower_uid가 followee_uid를 팔로우하고 있는지 확인한다."""
    return _follow_doc_ref(db, follower_uid, followee_uid).get().exists


def list_following_ids(db: Client, uid: str, limit: int = 100) -> list[str]:
    """uid가 팔로우하는 유저들의 uid 목록을 반환한다(정렬 순서 보장 없음)."""
    query = db.collection(_FOLLOWS_COLLECTION).where("follower_id", "==", uid).limit(limit)
    return [doc.to_dict()["followee_id"] for doc in query.stream()]


def can_view(db: Client, viewer_uid: str | None, owner_uid: str) -> bool:
    """팔로우 그래프에서 파생되는 열람 권한 - 게시물/스토리 공용.

    익명(viewer_uid=None)은 항상 False. 본인 소유물이거나, 소유자를 팔로우
    중이면 True.
    """
    return viewer_uid is not None and (
        viewer_uid == owner_uid or is_following(db, viewer_uid, owner_uid)
    )
