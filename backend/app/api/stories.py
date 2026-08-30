"""스토리(Story) API - 인스타식 24시간 만료 (prefix /api/stories).

app/api/posts.py와 동일한 관례(Firestore 클라이언트 의존성 주입, camelCase 스키마,
get_current_user/optional)를 따른다. 이미지 검증은 app/domain/post.py의 검증
로직을 app/domain/story.py가 그대로 재사용한다(posts와 동일 제약).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.domain.story import Story
from app.firestore import follow_repo, story_repo, user_repo
from app.firestore.client import get_firestore_client
from app.firestore.story_repo import StoryNotFoundError, StoryPermissionError
from app.schemas.stories import StoryCreateIn, StoryOut, StoryRingItemOut

router = APIRouter(prefix="/api/stories", tags=["stories"])

_STORY_NOT_FOUND = HTTPException(status_code=404, detail="스토리를 찾을 수 없어요.")
_STORY_FORBIDDEN = HTTPException(status_code=403, detail="본인 스토리만 삭제할 수 있어요.")

# follow_repo.list_following_ids 기본 상한(100)보다 브리핑이 지정한 50으로 좁혀
# 링 렌더링 시 유저별 존재 쿼리 개수를 억제한다.
_RING_FOLLOWING_LIMIT = 50


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _to_out(story: Story) -> StoryOut:
    return StoryOut(
        id=story.id,
        owner_id=story.owner_id,
        image_data=story.image_data,
        created_at=story.created_at,
        expires_at=story.expires_at,
    )


@router.post("", response_model=StoryOut, status_code=201)
async def create_story(
    payload: StoryCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("story-create", limit=10)),
) -> StoryOut:
    """본인 스토리를 올린다. 24시간 뒤 조회 시점 필터로 만료(삭제 크론 없음)."""
    story = story_repo.create_story(
        db, owner_id=user.uid, image_data=payload.image_data, created_at=_now_ms()
    )
    return _to_out(story)


@router.get("/ring", response_model=list[StoryRingItemOut])
async def get_story_ring(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[StoryRingItemOut]:
    """본인 + 팔로우 중인 유저(최대 50명) 중 활성 스토리가 있는 유저 목록.

    존재 확인은 유저별 limit(1) 쿼리 하나로 수행한다(브리핑 지정 - 쿼리 비용 억제).
    """
    # ponytail: hasUnseen은 limit(1)로 뽑은 그 유저의 활성 스토리 "하나"만 기준으로
    # 판단한다 - 그 유저가 활성 스토리를 여러 개 가지고 있고 그 중 하나만 봤어도
    # hasUnseen이 False로 잡힐 수 있다. 스토리 뷰어가 "안 본 것부터" 정확히 골라야
    # 하게 되면 스토리별 열람 체크로 승격할 것.
    now_ms = _now_ms()
    candidate_uids = [
        user.uid,
        *follow_repo.list_following_ids(db, user.uid, limit=_RING_FOLLOWING_LIMIT),
    ]

    items: list[StoryRingItemOut] = []
    for uid in candidate_uids:
        story = story_repo.get_one_active(db, uid, now_ms)
        if story is None:
            continue
        profile = user_repo.get_user_profile(db, uid) or {}
        items.append(
            StoryRingItemOut(
                uid=uid,
                display_name=profile.get("display_name"),
                avatar_emoji=profile.get("avatar_emoji"),
                has_unseen=not story_repo.has_viewed(db, story.id, user.uid),
            )
        )
    return items


@router.get("/user/{uid}", response_model=list[StoryOut])
async def list_user_stories(
    uid: str,
    _user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[StoryOut]:
    """uid의 활성 스토리를 시간순(오래된 것부터)으로 반환한다 - 로그인한 사람이면 누구나(익명 401).

    옵션1 일관성: 게시물(app/api/posts.py)과 동일하게 열람은 로그인 여부만 본다.
    팔로우 체크는 넣지 않는다 - 링 구성(GET /ring)이 이미 팔로우 기준이라 여기
    또 넣으면 정책이 중복·불일치할 여지만 생긴다.
    """
    stories = story_repo.list_active_by_owner(db, uid, _now_ms())
    return [_to_out(s) for s in stories]


@router.post("/{story_id}/view", status_code=200)
async def view_story(
    story_id: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> dict[str, bool]:
    """스토리 열람을 기록한다. 익명 요청은 기록할 신원이 없으므로 no-op 200."""
    if user is not None:
        story_repo.record_view(db, story_id, user.uid)
    return {"ok": True}


@router.delete("/{story_id}", status_code=204)
async def delete_story(
    story_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    """본인 스토리를 삭제한다. 없으면 404, 소유자가 아니면 403."""
    try:
        story_repo.delete_story(db, story_id, user.uid)
    except StoryNotFoundError as e:
        raise _STORY_NOT_FOUND from e
    except StoryPermissionError as e:
        raise _STORY_FORBIDDEN from e
