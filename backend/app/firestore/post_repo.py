"""Firestore 기반 프로필 사진 게시물(Post) 리포지토리.

## 컬렉션 레이아웃

최상위 `posts` 컬렉션. 문서 id는 서버가 생성한 uuid4를 그대로 쓴다(follow_repo.py의
"관계당 문서 하나"와 달리, 게시물은 owner_id + created_at으로 자연키를 만들 이유가
없어 그냥 무작위 id - constellation_repo.py의 별자리 id 관례와 동일).

다중 사진은 `posts/{id}/images/{index}` 서브컬렉션(문서 id = str(index), 0-base)에
장당 한 문서로 저장한다 - 부모 문서 하나에 여러 장을 몰아넣으면 Firestore 1MiB
문서 한도를 몇 장만으로도 넘길 수 있어서다(app/domain/post.py 모듈 docstring
참고). 좋아요는 `posts/{id}/likes/{uid}`, 댓글은 `posts/{id}/comments/{comment_id}`
서브컬렉션이다 - 레이아웃과 like_count/comment_count 비정규화 캐시 관례는
app/firestore/community_repo.py와 완전히 동일하다(그 모듈 docstring 참고).

## 정렬: 복합 인덱스 없이 파이썬 정렬로 회피

list_by_owner는 owner_id 단일 등호 필터만 쿼리에 걸고(단일 필드 인덱스는
Firestore가 자동 생성해줘서 firestore.indexes.json에 손댈 필요가 없다),
created_at 내림차순 정렬은 결과를 받아온 뒤 파이썬에서 수행한다. constellation_repo.py의
list_published/list_published_by_owner는 등호 필터 + order_by를 쿼리에 함께 걸어
firestore.indexes.json에 복합 인덱스를 추가해뒀지만(그 파일 확인 결과 실제로 그렇게
함), 이 리포지토리는 유저 한 명의 게시물이 최대 수십 건 규모라 서버 정렬 비용이
무시할 만하므로 배포마다 인덱스 빌드를 기다릴 필요가 없는 이 방식을 택한다.
"""

from __future__ import annotations

import uuid
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, Transaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.post import Post, PostComment, PostImage

_COLLECTION = "posts"
_IMAGES_SUBCOLLECTION = "images"
_COMMENTS_SUBCOLLECTION = "comments"
_LIKES_SUBCOLLECTION = "likes"
_LIST_LIMIT = 30
_COMMENT_LIST_LIMIT = 100

__all__ = [
    "CommentNotFoundError",
    "CommentPermissionError",
    "PostNotFoundError",
    "PostPermissionError",
    "PostRepoError",
    "create_comment",
    "create_post",
    "delete_comment",
    "delete_post",
    "get_post",
    "is_liked_by",
    "like_post",
    "liked_post_ids",
    "list_by_owner",
    "list_comments",
    "list_feed",
    "list_post_images",
    "unlike_post",
]


class PostRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class PostNotFoundError(PostRepoError):
    """지정한 id의 게시물 문서가 존재하지 않을 때."""


class PostPermissionError(PostRepoError):
    """호출자의 owner_id가 문서에 저장된 owner_id와 다를 때 (소유자가 아닌 삭제 시도)."""


class CommentNotFoundError(PostRepoError):
    """지정한 id의 댓글 문서가 존재하지 않을 때."""


class CommentPermissionError(PostRepoError):
    """호출자가 댓글의 작성자가 아닐 때."""


def _doc_ref(db: Client, post_id: str) -> Any:
    return db.collection(_COLLECTION).document(post_id)


def _images_collection_ref(db: Client, post_id: str) -> Any:
    return _doc_ref(db, post_id).collection(_IMAGES_SUBCOLLECTION)


def _comments_collection_ref(db: Client, post_id: str) -> Any:
    return _doc_ref(db, post_id).collection(_COMMENTS_SUBCOLLECTION)


def _comment_doc_ref(db: Client, post_id: str, comment_id: str) -> Any:
    return _comments_collection_ref(db, post_id).document(comment_id)


def _likes_collection_ref(db: Client, post_id: str) -> Any:
    return _doc_ref(db, post_id).collection(_LIKES_SUBCOLLECTION)


def _snapshot_to_post(snapshot: Any) -> Post:
    data = snapshot.to_dict()
    assert data is not None  # 호출부가 snapshot.exists를 이미 확인했다는 전제
    return Post.model_validate(data)


def _snapshot_to_comment(snapshot: Any) -> PostComment:
    data = snapshot.to_dict()
    assert data is not None
    return PostComment.model_validate(data)


def create_post(
    db: Client, *, owner_id: str, images: list[str], caption: str, created_at: int
) -> Post:
    """새 게시물을 만든다. id는 여기서 서버 uuid4로 생성한다(클라이언트가 넘기지 않음).

    images[0]을 부모 문서의 썸네일(image_data)로 저장하고, 전체 장을
    posts/{id}/images/{index} 서브컬렉션에 한 번의 배치 쓰기로 기록한다.
    images는 최대 MAX_IMAGES(10)장이라 부모 문서 1개 + 서브컬렉션 최대 10개 = 11개
    오퍼레이션으로 Firestore 배치 한도(500)에 한참 못 미친다 - constellation_repo.py의
    500단위 청크 분할이 여기선 필요 없다.
    """
    post = Post(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        image_data=images[0],
        image_count=len(images),
        caption=caption,
        created_at=created_at,
    )
    batch = db.batch()
    batch.set(_doc_ref(db, post.id), post.model_dump())
    images_collection = _images_collection_ref(db, post.id)
    for index, image_data in enumerate(images):
        post_image = PostImage(index=index, image_data=image_data)
        batch.set(images_collection.document(str(index)), post_image.model_dump())
    batch.commit()
    return post


def list_post_images(db: Client, post_id: str) -> list[PostImage]:
    """post_id의 전체 이미지를 순서대로(index 오름차순) 반환한다.

    Storage 이관 전 임시 구조로 여기 있는 게시물이 만들어지기 전(다중 사진 기능
    이전)의 기존 글은 서브컬렉션이 비어 있다 - 빈 리스트를 그대로 돌려주고,
    부모 image_data로 폴백하는 건 호출부(app/api/posts.py)의 역할이다(이 함수는
    "서브컬렉션에 실제로 뭐가 있는가"만 답한다).
    """
    query = _images_collection_ref(db, post_id).order_by("index", direction=gcf.Query.ASCENDING)
    return [PostImage.model_validate(doc.to_dict()) for doc in query.stream()]


def get_post(db: Client, post_id: str) -> Post | None:
    """게시물 하나를 조회한다. 없으면 None."""
    snapshot = _doc_ref(db, post_id).get()
    if not snapshot.exists:
        return None
    return _snapshot_to_post(snapshot)


def list_by_owner(db: Client, owner_id: str) -> list[Post]:
    """owner_id의 게시물을 최신순(created_at 내림차순)으로 최대 30건 반환한다.

    쿼리는 owner_id 등호 필터만 걸고, 정렬/절단은 모듈 docstring에서 설명한
    이유로 파이썬에서 한다.
    """
    query = db.collection(_COLLECTION).where(filter=FieldFilter("owner_id", "==", owner_id))
    posts = [Post.model_validate(doc.to_dict()) for doc in query.stream()]
    posts.sort(key=lambda p: p.created_at, reverse=True)
    return posts[:_LIST_LIMIT]


def list_feed(db: Client, limit: int = _LIST_LIMIT) -> list[Post]:
    """전체 유저의 최신 게시물을 최대 limit건 반환한다(소셜 피드용, 익명 열람 허용).

    소유자 필터가 없는 전체 컬렉션 조회라 list_by_owner와 달리 파이썬 정렬로
    회피할 필요가 없다 - order_by + limit만 걸린 단일 필드 쿼리는 Firestore가
    created_at 단일 필드 인덱스를 자동 생성해준다(firestore.indexes.json에
    손댈 필요 없음, constellation_repo.list_published와 동일한 판단이지만 그쪽은
    등호 필터가 하나 더 있어 복합 인덱스가 필요했던 것과 다르다).
    """
    query = (
        db.collection(_COLLECTION)
        .order_by("created_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [Post.model_validate(doc.to_dict()) for doc in query.stream()]


def delete_post(db: Client, post_id: str, owner_id: str) -> None:
    """게시물을 삭제한다. 없으면 PostNotFoundError, 소유자가 아니면 PostPermissionError.

    # ponytail: 이미지/좋아요/댓글 서브컬렉션은 함께 지우지 않는다 - 부모 문서가
    # 없어지면 그 서브컬렉션에 도달할 경로(post_id로 조회)도 사라지므로 비용만
    # 남는 고아 데이터다(community_repo.delete_post와 동일한 판단). 정리가
    # 필요해지면 Cloud Function onDelete 트리거나 배치 스크립트로 승격할 것.
    """
    doc_ref = _doc_ref(db, post_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        raise PostNotFoundError(post_id)
    data = snapshot.to_dict()
    assert data is not None
    post = Post.model_validate(data)
    if post.owner_id != owner_id:
        raise PostPermissionError(f"{owner_id}는 게시물 {post_id}의 소유자가 아닙니다.")
    doc_ref.delete()


def is_liked_by(db: Client, post_id: str, uid: str) -> bool:
    """uid가 post_id에 좋아요를 눌렀는지 확인한다."""
    return _likes_collection_ref(db, post_id).document(uid).get().exists


def liked_post_ids(db: Client, post_ids: list[str], uid: str) -> set[str]:
    """post_ids 중 uid가 좋아요를 누른 것들의 id 집합을 배치 조회 한 번으로 반환한다.

    community_repo.liked_post_ids와 완전히 동일한 이유·구현(Client.get_all()로
    목록 화면의 N+1 왕복을 피한다).
    """
    if not post_ids:
        return set()
    refs = [_likes_collection_ref(db, pid).document(uid) for pid in post_ids]
    return {snap.reference.parent.parent.id for snap in db.get_all(refs) if snap.exists}


def like_post(db: Client, post_id: str, uid: str) -> None:
    """post_id에 좋아요를 남긴다. 게시물이 없으면 PostNotFoundError.

    이미 눌렀으면 no-op(관계 문서/카운트 변화 없음) - community_repo.like_post와
    동일한 중복 클릭 방지 관례.
    """
    like_ref = _likes_collection_ref(db, post_id).document(uid)
    post_ref = _doc_ref(db, post_id)
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
    post_ref = _doc_ref(db, post_id)
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


def create_comment(
    db: Client,
    post_id: str,
    *,
    author_uid: str,
    author_display_name: str | None,
    body: str,
    created_at: int,
) -> PostComment:
    """댓글을 만들고 부모 게시물의 comment_count를 원자적으로 1 증가시킨다.

    부모 게시물이 없으면 PostNotFoundError.
    """
    post_ref = _doc_ref(db, post_id)
    comment = PostComment(
        id=str(uuid.uuid4()),
        author_uid=author_uid,
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


def list_comments(db: Client, post_id: str, limit: int = _COMMENT_LIST_LIMIT) -> list[PostComment]:
    """게시물의 댓글을 작성순(오래된 순)으로 최대 limit개 반환한다."""
    query = (
        _comments_collection_ref(db, post_id)
        .order_by("created_at", direction=gcf.Query.ASCENDING)
        .limit(limit)
    )
    return [_snapshot_to_comment(doc) for doc in query.stream()]


def delete_comment(db: Client, post_id: str, comment_id: str, owner_id: str) -> None:
    """댓글을 삭제하고 부모 게시물의 comment_count를 1 감소(바닥 0)시킨다.

    댓글이 없으면 CommentNotFoundError, 작성자가 아니면 CommentPermissionError.
    부모 게시물이 이미 삭제된 뒤라면(delete_post 이후 남은 고아 댓글) 카운트 보정
    없이 댓글 문서만 지운다(community_repo.delete_comment와 동일한 관용구).
    """
    comment_ref = _comment_doc_ref(db, post_id, comment_id)
    post_ref = _doc_ref(db, post_id)
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
