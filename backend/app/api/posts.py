"""프로필 사진 게시물(Post) API - 인스타식 사진+짧은 글 (prefix /api/posts).

app/api/profiles.py와 동일한 관례(Firestore 클라이언트 의존성 주입, camelCase
스키마, get_current_user/optional 사용)를 따른다. 이미지는 Cloud Storage 대신
data URL(base64)로 Firestore 문서에 직접 저장하는 임시 구조다(app/domain/post.py
docstring 참고) - Storage 이관 전까지 게시물당 이미지 하나, 문서 크기 제한 有.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.domain.post import Post
from app.firestore import post_repo
from app.firestore.client import get_firestore_client
from app.firestore.post_repo import PostNotFoundError, PostPermissionError
from app.schemas.posts import PostCreateIn, PostOut

router = APIRouter(prefix="/api/posts", tags=["posts"])

_POST_NOT_FOUND = HTTPException(status_code=404, detail="게시물을 찾을 수 없어요.")
_POST_FORBIDDEN = HTTPException(status_code=403, detail="본인 게시물만 삭제할 수 있어요.")


def _to_out(post: Post, *, viewer_uid: str | None) -> PostOut:
    return PostOut(
        id=post.id,
        owner_id=post.owner_id,
        image_data=post.image_data,
        caption=post.caption,
        created_at=post.created_at,
        is_mine=viewer_uid is not None and viewer_uid == post.owner_id,
    )


@router.post("", response_model=PostOut, status_code=201)
async def create_post(
    payload: PostCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("post-create", limit=10)),
) -> PostOut:
    """본인 프로필에 사진 게시물을 올린다."""
    created_at = int(datetime.now(UTC).timestamp() * 1000)
    post = post_repo.create_post(
        db,
        owner_id=user.uid,
        image_data=payload.image_data,
        caption=payload.caption,
        created_at=created_at,
    )
    return _to_out(post, viewer_uid=user.uid)


@router.get("/user/{uid}", response_model=list[PostOut])
async def list_user_posts(
    uid: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[PostOut]:
    """uid의 게시물 목록을 최신순으로 반환한다 - 익명 열람 허용. isMine으로 본인 판별."""
    posts = post_repo.list_by_owner(db, uid)
    viewer_uid = user.uid if user is not None else None
    return [_to_out(p, viewer_uid=viewer_uid) for p in posts]


@router.delete("/{post_id}", status_code=204)
async def delete_post(
    post_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    """본인 게시물을 삭제한다. 없으면 404, 소유자가 아니면 403."""
    try:
        post_repo.delete_post(db, post_id, user.uid)
    except PostNotFoundError as e:
        raise _POST_NOT_FOUND from e
    except PostPermissionError as e:
        raise _POST_FORBIDDEN from e
