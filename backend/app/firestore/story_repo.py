"""Firestore 기반 스토리(Story) 리포지토리 - 인스타식 24시간 만료.

## 컬렉션 레이아웃

최상위 `stories` 컬렉션(post_repo.py와 동일하게 서버 생성 uuid4를 문서 id로
쓴다). 열람 기록은 `stories/{story_id}/views/{viewer_uid}` 서브컬렉션 문서
"존재 여부"만으로 판단한다 - 문서 내용은 비워둔다(존재 자체가 "봤다"는 사실).

## 만료 처리: 쿼리 시점 필터만, 삭제 크론 없음

브리핑 지정대로 만료된 스토리를 지우는 배치/크론은 두지 않는다. 모든 조회
함수가 `expires_at > now_ms` 필터로 활성 스토리만 골라내고, 만료 문서는
컬렉션에 그대로 쌓인다.
# ponytail: 방치된 만료 스토리(+그 views 서브컬렉션)는 영구히 쌓인다. 물량이
# 문제되면 Firestore TTL 정책(expires_at 필드 지정) 또는 배치 삭제로 정리할 것.

## 복합 인덱스가 필요 없는 이유

owner_id 등호 필터 + expires_at 범위 필터는 서로 다른 필드에 걸리지만, Firestore는
"등호 필터들 + 다른 한 필드의 단일 범위 필터" 조합을 자동 단일 필드 인덱스만으로
처리한다 - 복합 인덱스가 필요한 경우는 (a) 범위 필터가 여러 필드에 걸리거나
(b) 그 범위 필터가 걸린 필드가 아닌 다른 필드로 order_by를 걸 때뿐이다. 이
모듈은 어떤 쿼리에도 order_by를 걸지 않고(시간순 정렬은 post_repo.py와 동일하게
결과를 받아온 뒤 파이썬에서 수행), 범위 필터도 owner_id/expires_at 두 필드
중 expires_at 하나뿐이라 firestore.indexes.json에 손댈 필요가 없다.
"""

from __future__ import annotations

import uuid
from typing import Any

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.story import STORY_TTL_MS, Story

_COLLECTION = "stories"
_VIEWS_SUBCOLLECTION = "views"
_RING_EXISTENCE_LIMIT = 1  # 유저별 활성 스토리 "존재 여부"만 필요 - 내용은 안 본다.


class StoryRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class StoryNotFoundError(StoryRepoError):
    """지정한 id의 스토리 문서가 존재하지 않을 때."""


class StoryPermissionError(StoryRepoError):
    """호출자의 owner_id가 문서에 저장된 owner_id와 다를 때(소유자가 아닌 삭제 시도)."""


def _doc_ref(db: Client, story_id: str) -> Any:
    return db.collection(_COLLECTION).document(story_id)


def _active_query(db: Client, owner_id: str, now_ms: int) -> Any:
    return (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("owner_id", "==", owner_id))
        .where(filter=FieldFilter("expires_at", ">", now_ms))
    )


def create_story(db: Client, *, owner_id: str, image_data: str, created_at: int) -> Story:
    """새 스토리를 만든다. id는 서버 uuid4, expires_at은 created_at + 24h로 계산한다."""
    story = Story(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        image_data=image_data,
        created_at=created_at,
        expires_at=created_at + STORY_TTL_MS,
    )
    _doc_ref(db, story.id).set(story.model_dump())
    return story


def list_active_by_owner(db: Client, owner_id: str, now_ms: int) -> list[Story]:
    """owner_id의 활성(만료 전) 스토리를 시간순(오래된 것부터)으로 반환한다."""
    stories = [
        Story.model_validate(doc.to_dict()) for doc in _active_query(db, owner_id, now_ms).stream()
    ]
    stories.sort(key=lambda s: s.created_at)
    return stories


def get_one_active(db: Client, owner_id: str, now_ms: int) -> Story | None:
    """owner_id의 활성 스토리 중 하나를 limit(1)로 가져온다.

    "이 유저가 활성 스토리를 가지고 있는가"(스토리 링)만 확인하면 되는 호출부용 -
    어느 스토리가 뽑히는지 정렬 순서는 보장하지 않는다.
    """
    docs = list(_active_query(db, owner_id, now_ms).limit(_RING_EXISTENCE_LIMIT).stream())
    if not docs:
        return None
    data = docs[0].to_dict()
    assert data is not None
    return Story.model_validate(data)


def record_view(db: Client, story_id: str, viewer_uid: str) -> None:
    """열람 기록. 문서 내용은 비워둔다 - 존재 자체가 "봤다"는 뜻이다."""
    _doc_ref(db, story_id).collection(_VIEWS_SUBCOLLECTION).document(viewer_uid).set({})


def has_viewed(db: Client, story_id: str, viewer_uid: str) -> bool:
    """viewer_uid가 story_id를 열람한 기록이 있는지 확인한다."""
    return _doc_ref(db, story_id).collection(_VIEWS_SUBCOLLECTION).document(viewer_uid).get().exists


def delete_story(db: Client, story_id: str, owner_id: str) -> None:
    """스토리를 삭제한다. 없으면 StoryNotFoundError, 소유자가 아니면 StoryPermissionError."""
    doc_ref = _doc_ref(db, story_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        raise StoryNotFoundError(story_id)
    data = snapshot.to_dict()
    assert data is not None
    story = Story.model_validate(data)
    if story.owner_id != owner_id:
        raise StoryPermissionError(f"{owner_id}는 스토리 {story_id}의 소유자가 아닙니다.")
    doc_ref.delete()
