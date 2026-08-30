"""프로필 사진 게시물(Post) API - 인스타식 사진+짧은 글+좋아요·댓글 (prefix /api/posts).

app/api/profiles.py/app/api/community.py와 동일한 관례(Firestore 클라이언트 의존성
주입, camelCase 스키마, get_current_user/optional 사용, response_model_exclude_none=True)를
따른다. 이미지는 Cloud Storage 대신 data URL(base64)로 Firestore 문서(부모 + images
서브컬렉션)에 직접 저장하는 임시 구조다(app/domain/post.py docstring 참고).

## SNS층은 익명이 없다

커뮤니티 게시판(app/api/community.py)과 달리 게시물/댓글은 항상 실명(작성자 uid +
표시 이름 스냅샷)으로 공개된다 - 그래서 여기엔 _to_post_out 같은 익명 차단
직렬화 지점이 없다.

## 라우트 선언 순서

GET "/{post_id}"(단건, P3)는 두 세그먼트짜리 구체 경로(/user/{uid}, /{post_id}/images,
/{post_id}/like, /{post_id}/comments)와 세그먼트 수 자체가 달라 실제로는 충돌하지
않지만, community.py의 관례(구체 경로를 파라미터 경로보다 먼저 선언)를 그대로
따라 헷갈리지 않게 배치한다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.api.explore import list_uids_with_shared_interest
from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.domain.post import Post, PostComment, PostImage
from app.firestore import follow_repo, post_repo, user_repo
from app.firestore.client import get_firestore_client
from app.firestore.post_repo import (
    CommentNotFoundError,
    CommentPermissionError,
    PostNotFoundError,
    PostPermissionError,
)
from app.schemas.posts import (
    PostCommentCreateIn,
    PostCommentOut,
    PostCreateIn,
    PostDetailOut,
    PostFeedAuthorOut,
    PostFeedItemOut,
    PostFeedOut,
    PostImageOut,
    PostOut,
)

router = APIRouter(prefix="/api/posts", tags=["posts"])

_POST_NOT_FOUND = HTTPException(status_code=404, detail="게시물을 찾을 수 없어요.")
_POST_FORBIDDEN = HTTPException(status_code=403, detail="본인 게시물만 삭제할 수 있어요.")
_COMMENT_NOT_FOUND = HTTPException(status_code=404, detail="댓글을 찾을 수 없어요.")
_COMMENT_FORBIDDEN = HTTPException(status_code=403, detail="본인 댓글만 삭제할 수 있어요.")

# 피드 콜드스타트 분기(팔로잉 0명일 때)에서 관심사 겹침 유저를 몇 명까지 끌어올지 -
# list_following_ids 기본 상한(100)과 별개로, 피드 자체가 최대 30건이라 그 이상은
# 낭비다(follow_repo.list_following_ids 호출에도 동일 상한을 준다).
_FEED_CANDIDATE_LIMIT = 30


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _to_out(post: Post, *, viewer_uid: str | None, is_liked: bool | None) -> PostOut:
    return PostOut(
        id=post.id,
        owner_id=post.owner_id,
        image_data=post.image_data,
        image_count=post.image_count,
        caption=post.caption,
        like_count=post.like_count,
        comment_count=post.comment_count,
        is_liked=is_liked,
        created_at=post.created_at,
        is_mine=viewer_uid is not None and viewer_uid == post.owner_id,
    )


def _to_comment_out(comment: PostComment) -> PostCommentOut:
    return PostCommentOut(
        id=comment.id,
        author_uid=comment.author_uid,
        author_display_name=comment.author_display_name,
        body=comment.body,
        created_at=comment.created_at,
    )


def _to_image_out(image: PostImage) -> PostImageOut:
    return PostImageOut(index=image.index, image_data=image.image_data)


def _snapshot_display_name(db: Client, uid: str) -> str | None:
    """댓글 작성 시점의 표시 이름을 프로필에서 읽어와 스냅샷으로 저장할 값으로 쓴다.

    app/api/community.py의 동명 헬퍼와 동일하다.
    """
    profile = user_repo.get_user_profile(db, uid)
    return (profile or {}).get("display_name")


@router.post("", response_model=PostOut, response_model_exclude_none=True, status_code=201)
async def create_post(
    payload: PostCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("post-create", limit=10)),
) -> PostOut:
    """본인 프로필에 사진 게시물을 올린다. 1~10장(images) 또는 imageData 1장(역호환)."""
    created_at = _now_ms()
    post = post_repo.create_post(
        db,
        owner_id=user.uid,
        images=payload.resolved_images(),
        caption=payload.caption,
        created_at=created_at,
    )
    return _to_out(post, viewer_uid=user.uid, is_liked=False)


@router.get("/feed", response_model=PostFeedOut, response_model_exclude_none=True)
async def get_feed(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> PostFeedOut:
    """소셜 피드(최신순, 최대 30개) - 로그인 필수(익명 401), 팔로우가 "누가 뜨는지"의 기준.

    ROUTE ORDER: 반드시 GET /user/{uid}·GET /{post_id}보다 먼저 선언해야 한다 -
    그렇지 않으면 FastAPI가 "feed"를 uid/post_id 경로 파라미터로 매칭한다
    (app/api/constellation.py의 옛 GET /feed와 동일한 함정 - 그쪽은 B5에서 삭제됨).

    콜드스타트 분기(사용자 원문): "처음에는 누구나 팔로워가 없으니까 아무것도
    안뜰거 아니야. 그거 방지하려고 (콜드스타트에는) 같은 관심사의 사람들의
    게시물도 띄워보자. 나중에는 팔로워 위주로." - 팔로잉이 1명 이상이면 그
    사람들 + 본인 글만("following"). 팔로잉이 0명이면 본인 interest_tags와
    겹치는 유저 글로 보충한다("interest"). 그마저 없으면(관심사 태그도 없는
    완전 신규) 전체 최신 글로 폴백한다("latest") - 로그인 게이트가 있어 익명
    노출 문제는 없다. source는 프론트가 피드 상단에 분기 안내를 보여줄 수 있게
    응답에 그대로 실어 보낸다.

    항목마다 작성자 프로필을 추가 조회한다(N+1) - limit 30 상한이 있어 허용되는
    수준이다.
    """
    following_ids = follow_repo.list_following_ids(db, user.uid, limit=_FEED_CANDIDATE_LIMIT)
    if following_ids:
        source: Literal["following", "interest", "latest"] = "following"
        posts = post_repo.list_feed_for(db, [user.uid, *following_ids])
    else:
        profile = user_repo.get_user_profile(db, user.uid)
        requester_tags = set((profile or {}).get("interest_tags") or [])
        interest_uids = list_uids_with_shared_interest(
            db, user.uid, requester_tags, limit=_FEED_CANDIDATE_LIMIT
        )
        if interest_uids:
            source = "interest"
            posts = post_repo.list_feed_for(db, [user.uid, *interest_uids])
        else:
            source = "latest"
            posts = post_repo.list_feed_for(db, None)

    liked_ids = post_repo.liked_post_ids(db, [p.id for p in posts], user.uid)
    items = []
    for post in posts:
        author_profile = user_repo.get_user_profile(db, post.owner_id)
        author = PostFeedAuthorOut(
            uid=post.owner_id,
            display_name=author_profile.get("display_name") if author_profile else None,
            avatar_emoji=author_profile.get("avatar_emoji") if author_profile else None,
        )
        items.append(
            PostFeedItemOut(
                post=_to_out(post, viewer_uid=user.uid, is_liked=post.id in liked_ids),
                author=author,
            )
        )
    return PostFeedOut(source=source, posts=items)


@router.get("/user/{uid}", response_model=list[PostOut], response_model_exclude_none=True)
async def list_user_posts(
    uid: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[PostOut]:
    """uid의 게시물 목록을 최신순으로 반환한다 - 로그인한 사람이면 누구나 열람 가능(익명 401).
    isMine/isLiked로 본인/좋아요 여부 판별.

    옵션1 확정: 게시물 열람은 로그인 여부만 본다 - 팔로우는 차단 장치가 아니라
    피드 구성 기준(GET /feed)일 뿐이다.

    목록은 부모 문서(썸네일 image_data)만 읽는다 - images 서브컬렉션은 조인하지
    않는다(비용, 모듈 docstring 참고). 전체 이미지가 필요하면 GET .../images를
    따로 부른다.
    """
    posts = post_repo.list_by_owner(db, uid)
    liked_ids = post_repo.liked_post_ids(db, [p.id for p in posts], user.uid)
    return [_to_out(p, viewer_uid=user.uid, is_liked=p.id in liked_ids) for p in posts]


@router.get("/{post_id}/images", response_model=list[PostImageOut])
async def list_post_images(
    post_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[PostImageOut]:
    """게시물의 전체 이미지를 순서대로 반환한다 - 상세/캐러셀용, 로그인한 사람이면 누구나(익명 401).

    다중 사진 기능 이전에 만들어진 게시물은 images 서브컬렉션이 비어 있다 - 그 경우
    부모 문서의 image_data(썸네일 겸 유일한 사진)를 index 0 한 장으로 폴백한다.
    """
    post = post_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    images = post_repo.list_post_images(db, post_id)
    if not images:
        return [PostImageOut(index=0, image_data=post.image_data)]
    return [_to_image_out(img) for img in images]


@router.post("/{post_id}/like", response_model=PostOut, response_model_exclude_none=True)
async def like_post(
    post_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> PostOut:
    """게시물에 좋아요를 남긴다. 응답은 갱신된 게시물(community.py의 like_post와 동일 관례)."""
    try:
        post_repo.like_post(db, post_id, user.uid)
    except PostNotFoundError as e:
        raise _POST_NOT_FOUND from e
    post = post_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    return _to_out(post, viewer_uid=user.uid, is_liked=True)


@router.delete("/{post_id}/like", response_model=PostOut, response_model_exclude_none=True)
async def unlike_post(
    post_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> PostOut:
    """게시물 좋아요를 취소한다. 응답은 갱신된 게시물."""
    post_repo.unlike_post(db, post_id, user.uid)
    post = post_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    return _to_out(post, viewer_uid=user.uid, is_liked=False)


@router.post(
    "/{post_id}/comments",
    response_model=PostCommentOut,
    status_code=201,
)
async def create_comment(
    post_id: str,
    payload: PostCommentCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("post-comment-create", limit=20)),
) -> PostCommentOut:
    """게시물에 댓글을 남긴다. 실명 고정(익명 옵션 없음) - 작성 시점 표시 이름을 스냅샷으로 저장."""
    try:
        comment = post_repo.create_comment(
            db,
            post_id,
            author_uid=user.uid,
            author_display_name=_snapshot_display_name(db, user.uid),
            body=payload.body,
            created_at=_now_ms(),
        )
    except PostNotFoundError as e:
        raise _POST_NOT_FOUND from e
    return _to_comment_out(comment)


@router.delete("/{post_id}/comments/{comment_id}", status_code=204)
async def delete_comment(
    post_id: str,
    comment_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    """본인 댓글을 삭제한다. 없으면 404, 작성자가 아니면 403."""
    try:
        post_repo.delete_comment(db, post_id, comment_id, user.uid)
    except CommentNotFoundError as e:
        raise _COMMENT_NOT_FOUND from e
    except CommentPermissionError as e:
        raise _COMMENT_FORBIDDEN from e


@router.get("/{post_id}", response_model=PostDetailOut, response_model_exclude_none=True)
async def get_post_detail(
    post_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> PostDetailOut:
    """게시물 단건(공유용, 퍼머링크) + 댓글 목록을 반환한다 - 로그인한 사람이면 누구나(익명 401).

    게시물이 없으면 404.
    """
    post = post_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    is_liked = post_repo.is_liked_by(db, post_id, user.uid)
    comments = post_repo.list_comments(db, post_id)
    return PostDetailOut(
        post=_to_out(post, viewer_uid=user.uid, is_liked=is_liked),
        comments=[_to_comment_out(c) for c in comments],
    )


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
