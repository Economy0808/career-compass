"""Firestore 기반 프로필 사진 게시물(Post) 리포지토리.

## 컬렉션 레이아웃

최상위 `posts` 컬렉션. 문서 id는 서버가 생성한 uuid4를 그대로 쓴다(follow_repo.py의
"관계당 문서 하나"와 달리, 게시물은 owner_id + created_at으로 자연키를 만들 이유가
없어 그냥 무작위 id - constellation_repo.py의 별자리 id 관례와 동일).

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

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.post import Post

_COLLECTION = "posts"
_LIST_LIMIT = 30


class PostRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class PostNotFoundError(PostRepoError):
    """지정한 id의 게시물 문서가 존재하지 않을 때."""


class PostPermissionError(PostRepoError):
    """호출자의 owner_id가 문서에 저장된 owner_id와 다를 때 (소유자가 아닌 삭제 시도)."""


def _doc_ref(db: Client, post_id: str) -> Any:
    return db.collection(_COLLECTION).document(post_id)


def create_post(db: Client, *, owner_id: str, image_data: str, caption: str, created_at: int) -> Post:
    """새 게시물을 만든다. id는 여기서 서버 uuid4로 생성한다(클라이언트가 넘기지 않음)."""
    post = Post(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        image_data=image_data,
        caption=caption,
        created_at=created_at,
    )
    _doc_ref(db, post.id).set(post.model_dump())
    return post


def list_by_owner(db: Client, owner_id: str) -> list[Post]:
    """owner_id의 게시물을 최신순(created_at 내림차순)으로 최대 30건 반환한다.

    쿼리는 owner_id 등호 필터만 걸고, 정렬/절단은 모듈 docstring에서 설명한
    이유로 파이썬에서 한다.
    """
    query = db.collection(_COLLECTION).where(filter=FieldFilter("owner_id", "==", owner_id))
    posts = [Post.model_validate(doc.to_dict()) for doc in query.stream()]
    posts.sort(key=lambda p: p.created_at, reverse=True)
    return posts[:_LIST_LIMIT]


def delete_post(db: Client, post_id: str, owner_id: str) -> None:
    """게시물을 삭제한다. 없으면 PostNotFoundError, 소유자가 아니면 PostPermissionError."""
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
