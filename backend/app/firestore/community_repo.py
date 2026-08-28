"""Firestore 기반 커뮤니티 게시판(게시글/댓글/좋아요) 리포지토리.

## 컬렉션 레이아웃

최상위 `community_posts` 컬렉션. 문서 id는 서버가 생성한 uuid4(app/firestore/post_repo.py와
동일 관례 - owner_id + created_at으로 자연키를 만들 이유가 없다). 댓글은
`community_posts/{post_id}/comments/{comment_id}` 서브컬렉션, 좋아요는
`community_posts/{post_id}/likes/{uid}` 서브컬렉션이다 - 좋아요는 문서 존재 여부
자체가 "눌렀는가"의 답이라 uid를 그대로 문서 id로 쓴다(follow_repo.py가
`{follower}_{followee}` 합성 id를 쓰는 것과 같은 이유이되, 여기는 부모 스코프가
이미 post_id라 uid 하나로 충분히 유일하다).

## like_count / comment_count 비정규화 캐시

note_repo.py의 note_count, follow_repo.py의 follower_count/following_count와 동일한
설계다: 서브컬렉션 문서 생성/삭제를 부모 게시글 문서의 카운트 증감과 하나의 Firestore
트랜잭션으로 묶어 정합성을 유지하고, 0 밑으로 내려가지 않도록 max(0, ...) 바닥을 둔다.

## 이 모듈은 익명 처리를 하지 않는다

is_anonymous가 True인 글/댓글이라도 author_uid/author_display_name은 항상 그대로
저장하고 그대로 반환한다 - "누구에게 무엇을 감출지" 판단은 app/api/community.py의
직렬화 함수(_to_post_out/_to_comment_out)가 전담한다. 비밀 게시판의 강제 익명 여부
결정도 라우터가 BOARDS 상수를 보고 정해서 넘긴 is_anonymous 값을 이 모듈은 그대로
신뢰할 뿐이다(이 모듈은 board_id의 의미를 모른다).
"""

from __future__ import annotations

import uuid
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, Transaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.community import CommunityComment, CommunityPost

_COLLECTION = "community_posts"
_COMMENTS_SUBCOLLECTION = "comments"
_LIKES_SUBCOLLECTION = "likes"
_POST_LIST_LIMIT = 30
_COMMENT_LIST_LIMIT = 100

__all__ = [
    "CommentNotFoundError",
    "CommentPermissionError",
    "CommunityRepoError",
    "PostNotFoundError",
    "PostPermissionError",
    "create_comment",
    "create_post",
    "delete_comment",
    "delete_post",
    "get_post",
    "is_liked_by",
    "like_post",
    "liked_post_ids",
    "list_comments",
    "list_posts",
    "unlike_post",
]


class CommunityRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class PostNotFoundError(CommunityRepoError):
    """지정한 id의 게시글 문서가 존재하지 않을 때."""


class PostPermissionError(CommunityRepoError):
    """호출자가 게시글의 작성자가 아닐 때(본인 게시글이 아닌데 삭제 시도)."""


class CommentNotFoundError(CommunityRepoError):
    """지정한 id의 댓글 문서가 존재하지 않을 때."""


class CommentPermissionError(CommunityRepoError):
    """호출자가 댓글의 작성자가 아닐 때."""


def _post_doc_ref(db: Client, post_id: str) -> Any:
    return db.collection(_COLLECTION).document(post_id)


def _comments_collection_ref(db: Client, post_id: str) -> Any:
    return _post_doc_ref(db, post_id).collection(_COMMENTS_SUBCOLLECTION)


def _comment_doc_ref(db: Client, post_id: str, comment_id: str) -> Any:
    return _comments_collection_ref(db, post_id).document(comment_id)


def _likes_collection_ref(db: Client, post_id: str) -> Any:
    return _post_doc_ref(db, post_id).collection(_LIKES_SUBCOLLECTION)


def _snapshot_to_post(snapshot: Any) -> CommunityPost:
    data = snapshot.to_dict()
    assert data is not None  # 호출부가 snapshot.exists를 이미 확인했다는 전제
    return CommunityPost.model_validate(data)


def _snapshot_to_comment(snapshot: Any) -> CommunityComment:
    data = snapshot.to_dict()
    assert data is not None
    return CommunityComment.model_validate(data)


def create_post(
    db: Client,
    *,
    board_id: str,
    author_uid: str,
    is_anonymous: bool,
    author_display_name: str | None,
    title: str,
    body: str,
    created_at: int,
) -> CommunityPost:
    """새 게시글을 만든다. id는 여기서 서버 uuid4로 생성한다(클라이언트가 넘기지 않음)."""
    post = CommunityPost(
        id=str(uuid.uuid4()),
        board_id=board_id,
        author_uid=author_uid,
        is_anonymous=is_anonymous,
        author_display_name=author_display_name,
        title=title,
        body=body,
        created_at=created_at,
        updated_at=created_at,
    )
    _post_doc_ref(db, post.id).set(post.model_dump())
    return post


def list_posts(db: Client, board_id: str, limit: int = _POST_LIST_LIMIT) -> list[CommunityPost]:
    """게시판의 게시글을 최신순(created_at 내림차순)으로 최대 limit개 반환한다.

    board_id 등호 필터 + created_at 정렬을 쿼리에 함께 거는 복합 쿼리라
    firestore.indexes.json에 (board_id ASC, created_at DESC) 복합 인덱스가
    필요하다(constellation_repo.list_published와 동일한 이유로 추가해둠).
    """
    query = (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("board_id", "==", board_id))
        .order_by("created_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [_snapshot_to_post(doc) for doc in query.stream()]


def get_post(db: Client, post_id: str) -> CommunityPost | None:
    """게시글 하나를 조회한다. 없으면 None."""
    snapshot = _post_doc_ref(db, post_id).get()
    if not snapshot.exists:
        return None
    return _snapshot_to_post(snapshot)


def delete_post(db: Client, post_id: str, owner_id: str) -> None:
    """게시글을 삭제한다. 없으면 PostNotFoundError, 작성자가 아니면 PostPermissionError.

    # ponytail: 댓글/좋아요 서브컬렉션은 함께 지우지 않는다 - 게시글 문서 자체가
    # 없어지면 그 서브컬렉션에 도달할 경로(post_id로 조회)도 사라지므로 비용만
    # 남는 고아 데이터다. 정리가 필요해지면 Cloud Function onDelete 트리거나
    # 배치 스크립트로 승격할 것.
    """
    doc_ref = _post_doc_ref(db, post_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        raise PostNotFoundError(post_id)
    post = _snapshot_to_post(snapshot)
    if post.author_uid != owner_id:
        raise PostPermissionError(f"{owner_id}는 게시글 {post_id}의 작성자가 아닙니다.")
    doc_ref.delete()


def create_comment(
    db: Client,
    post_id: str,
    *,
    author_uid: str,
    is_anonymous: bool,
    author_display_name: str | None,
    body: str,
    created_at: int,
) -> CommunityComment:
    """댓글을 만들고 부모 게시글의 comment_count를 원자적으로 1 증가시킨다.

    부모 게시글이 없으면 PostNotFoundError.
    """
    post_ref = _post_doc_ref(db, post_id)
    comment = CommunityComment(
        id=str(uuid.uuid4()),
        author_uid=author_uid,
        is_anonymous=is_anonymous,
        author_display_name=author_display_name,
        body=body,
        created_at=created_at,
    )
    comment_ref = _comment_doc_ref(db, post_id, comment.id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        post_snapshot = post_ref.get(transaction=transaction)
        if not post_snapshot.exists:
            raise PostNotFoundError(post_id)
        post = _snapshot_to_post(post_snapshot)
        # 모든 읽기가 끝난 뒤에야 쓴다 (Firestore 트랜잭션 규칙: 읽기가 쓰기보다 먼저).
        transaction.set(comment_ref, comment.model_dump())
        transaction.update(post_ref, {"comment_count": post.comment_count + 1})

    _run(transaction)
    return comment


def list_comments(
    db: Client, post_id: str, limit: int = _COMMENT_LIST_LIMIT
) -> list[CommunityComment]:
    """게시글의 댓글을 작성순(오래된 순)으로 최대 limit개 반환한다."""
    query = (
        _comments_collection_ref(db, post_id)
        .order_by("created_at", direction=gcf.Query.ASCENDING)
        .limit(limit)
    )
    return [_snapshot_to_comment(doc) for doc in query.stream()]


def delete_comment(db: Client, post_id: str, comment_id: str, owner_id: str) -> None:
    """댓글을 삭제하고 부모 게시글의 comment_count를 1 감소(바닥 0)시킨다.

    댓글이 없으면 CommentNotFoundError, 작성자가 아니면 CommentPermissionError.
    부모 게시글이 이미 삭제된 뒤라면(delete_post 이후 남은 고아 댓글) 카운트 보정
    없이 댓글 문서만 지운다(note_repo.delete_note와 동일한 관용구).
    """
    comment_ref = _comment_doc_ref(db, post_id, comment_id)
    post_ref = _post_doc_ref(db, post_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        comment_snapshot = comment_ref.get(transaction=transaction)
        if not comment_snapshot.exists:
            raise CommentNotFoundError(comment_id)
        comment = _snapshot_to_comment(comment_snapshot)
        if comment.author_uid != owner_id:
            raise CommentPermissionError(f"{owner_id}는 댓글 {comment_id}의 작성자가 아닙니다.")
        post_snapshot = post_ref.get(transaction=transaction)
        # 모든 읽기가 끝난 뒤에야 쓴다.
        transaction.delete(comment_ref)
        if not post_snapshot.exists:
            return
        post = _snapshot_to_post(post_snapshot)
        new_count = max(0, post.comment_count - 1)
        transaction.update(post_ref, {"comment_count": new_count})

    _run(transaction)


def is_liked_by(db: Client, post_id: str, uid: str) -> bool:
    """uid가 post_id에 좋아요를 눌렀는지 확인한다."""
    return _likes_collection_ref(db, post_id).document(uid).get().exists


def liked_post_ids(db: Client, post_ids: list[str], uid: str) -> set[str]:
    """post_ids 중 uid가 좋아요를 누른 것들의 id 집합을 배치 조회 한 번으로 반환한다.

    목록 화면(최대 30건)에서 게시글마다 좋아요 여부를 따로 조회하면 최대 30번
    왕복이 생기므로, google-cloud-firestore가 이미 제공하는 Client.get_all()로
    한 번에 묶는다(새 의존성 없이 기존 SDK 기능 재사용).
    """
    if not post_ids:
        return set()
    refs = [_likes_collection_ref(db, pid).document(uid) for pid in post_ids]
    # get_all()은 입력 순서를 보장하지 않으므로 각 스냅샷의 문서 경로에서
    # 부모 게시글 id를 직접 뽑아낸다(likes 서브컬렉션 -> 그 부모인 게시글 문서).
    return {snap.reference.parent.parent.id for snap in db.get_all(refs) if snap.exists}


def like_post(db: Client, post_id: str, uid: str) -> None:
    """post_id에 좋아요를 남긴다. 게시글이 없으면 PostNotFoundError.

    이미 눌렀으면 no-op(관계 문서/카운트 변화 없음) - follow_repo.follow와 동일한
    중복 클릭 방지 관례.
    """
    like_ref = _likes_collection_ref(db, post_id).document(uid)
    post_ref = _post_doc_ref(db, post_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        like_snapshot = like_ref.get(transaction=transaction)
        if like_snapshot.exists:
            return
        post_snapshot = post_ref.get(transaction=transaction)
        if not post_snapshot.exists:
            raise PostNotFoundError(post_id)
        post = _snapshot_to_post(post_snapshot)
        transaction.set(like_ref, {"uid": uid})
        transaction.update(post_ref, {"like_count": post.like_count + 1})

    _run(transaction)


def unlike_post(db: Client, post_id: str, uid: str) -> None:
    """post_id에 대한 좋아요를 취소한다. 애초에 안 눌렀으면 no-op."""
    like_ref = _likes_collection_ref(db, post_id).document(uid)
    post_ref = _post_doc_ref(db, post_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        like_snapshot = like_ref.get(transaction=transaction)
        if not like_snapshot.exists:
            return
        post_snapshot = post_ref.get(transaction=transaction)
        transaction.delete(like_ref)
        if not post_snapshot.exists:
            return
        post = _snapshot_to_post(post_snapshot)
        new_count = max(0, post.like_count - 1)
        transaction.update(post_ref, {"like_count": new_count})

    _run(transaction)
