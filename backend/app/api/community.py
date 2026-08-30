"""커뮤니티 게시판(자유/비밀/질문/정보/진로/홍보) API (prefix /api/community).

app/api/profiles.py/app/api/posts.py와 동일한 관례(Firestore 클라이언트 의존성 주입,
camelCase 스키마, get_current_user/optional 사용, response_model_exclude_none=True)를
따른다.

## 익명 직렬화는 여기서 강제한다

app/firestore/community_repo.py는 author_uid/author_display_name을 항상 그대로
저장/반환한다(신고·삭제 처리를 위해 서버는 항상 알아야 하므로). is_anonymous=true인
글/댓글에서 그 필드들을 응답에 절대 노출하지 않는 규칙은 이 모듈의 _to_post_out/
_to_comment_out이 유일하게 강제하는 지점이다 - 두 함수를 거치지 않고 도메인 모델을
직접 반환하는 경로를 만들지 말 것.

## 라우트 선언 순서

구체 경로(/boards, /boards/{board_id}/posts)를 파라미터 경로(/posts/{post_id}류)보다
먼저 선언한다. 실제로는 세그먼트 수가 달라 FastAPI가 헷갈릴 여지는 없지만, 이후 다른
에이전트가 라우트를 추가할 때 헷갈리지 않도록 브리핑 관례를 그대로 따른다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user_optional, require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.domain.community import BOARDS, CommunityComment, CommunityPost, get_board
from app.firestore import community_repo, user_repo
from app.firestore.client import get_firestore_client
from app.schemas.community import (
    BoardOut,
    CommunityCommentCreateIn,
    CommunityCommentOut,
    CommunityPostCreateIn,
    CommunityPostDetailOut,
    CommunityPostOut,
)

router = APIRouter(prefix="/api/community", tags=["community"])

_BOARD_NOT_FOUND = HTTPException(status_code=404, detail="게시판을 찾을 수 없어요.")
_POST_NOT_FOUND = HTTPException(status_code=404, detail="게시글을 찾을 수 없어요.")
_POST_FORBIDDEN = HTTPException(status_code=403, detail="본인 게시글만 삭제할 수 있어요.")
_COMMENT_NOT_FOUND = HTTPException(status_code=404, detail="댓글을 찾을 수 없어요.")
_COMMENT_FORBIDDEN = HTTPException(status_code=403, detail="본인 댓글만 삭제할 수 있어요.")


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _snapshot_display_name(db: Client, uid: str) -> str | None:
    """실명 공개 시 스냅샷으로 저장할 표시 이름을 프로필에서 읽어온다."""
    profile = user_repo.get_user_profile(db, uid)
    return (profile or {}).get("display_name")


def _to_post_out(
    post: CommunityPost, *, requester_uid: str | None, is_liked: bool | None
) -> CommunityPostOut:
    """도메인 CommunityPost를 응답으로 직렬화한다 - 익명 노출 차단이 일어나는 유일한 지점.

    is_anonymous=true면 author_uid/author_display_name을 절대 채우지 않는다. "익명(나)"
    처럼 본인 글임을 프론트가 표시하려면 is_mine 플래그만 보고 판단하게 한다(uid 자체는
    여전히 숨김).
    """
    is_mine = None if requester_uid is None else requester_uid == post.author_uid
    return CommunityPostOut(
        id=post.id,
        board_id=post.board_id,
        is_anonymous=post.is_anonymous,
        author_uid=None if post.is_anonymous else post.author_uid,
        author_display_name=None if post.is_anonymous else post.author_display_name,
        is_mine=is_mine,
        title=post.title,
        body=post.body,
        like_count=post.like_count,
        comment_count=post.comment_count,
        is_liked=is_liked,
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


def _to_comment_out(comment: CommunityComment, *, requester_uid: str | None) -> CommunityCommentOut:
    """도메인 CommunityComment를 응답으로 직렬화한다. 규칙은 _to_post_out과 동일."""
    is_mine = None if requester_uid is None else requester_uid == comment.author_uid
    return CommunityCommentOut(
        id=comment.id,
        is_anonymous=comment.is_anonymous,
        author_uid=None if comment.is_anonymous else comment.author_uid,
        author_display_name=None if comment.is_anonymous else comment.author_display_name,
        is_mine=is_mine,
        body=comment.body,
        created_at=comment.created_at,
    )


@router.get("/boards", response_model=list[BoardOut])
async def list_boards() -> list[BoardOut]:
    """게시판 상수 목록을 반환한다. 인증 불요."""
    return [
        BoardOut(
            id=b.id, name=b.name, description=b.description, forced_anonymous=b.force_anonymous
        )
        for b in BOARDS
    ]


@router.get(
    "/boards/{board_id}/posts",
    response_model=list[CommunityPostOut],
    response_model_exclude_none=True,
)
async def list_board_posts(
    board_id: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[CommunityPostOut]:
    """게시판의 글을 최신순 최대 30건 반환한다 - 열람은 익명 허용.

    isMine/isLiked는 요청자가 로그인했을 때만 채운다.
    """
    if get_board(board_id) is None:
        raise _BOARD_NOT_FOUND
    posts = community_repo.list_posts(db, board_id)
    if user is None:
        return [_to_post_out(p, requester_uid=None, is_liked=None) for p in posts]
    liked_ids = community_repo.liked_post_ids(db, [p.id for p in posts], user.uid)
    return [_to_post_out(p, requester_uid=user.uid, is_liked=p.id in liked_ids) for p in posts]


@router.post(
    "/boards/{board_id}/posts",
    response_model=CommunityPostOut,
    response_model_exclude_none=True,
    status_code=201,
)
async def create_board_post(
    board_id: str,
    payload: CommunityPostCreateIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("community-post-create", limit=10)),
) -> CommunityPostOut:
    """게시글을 작성한다. secret 게시판이면 is_anonymous 요청값을 무시하고 True로 강제한다."""
    board = get_board(board_id)
    if board is None:
        raise _BOARD_NOT_FOUND
    is_anonymous = True if board.force_anonymous else payload.is_anonymous
    author_display_name = None if is_anonymous else _snapshot_display_name(db, user.uid)
    created_at = _now_ms()
    post = community_repo.create_post(
        db,
        board_id=board_id,
        author_uid=user.uid,
        is_anonymous=is_anonymous,
        author_display_name=author_display_name,
        title=payload.title,
        body=payload.body,
        created_at=created_at,
    )
    return _to_post_out(post, requester_uid=user.uid, is_liked=False)


@router.get(
    "/posts/{post_id}", response_model=CommunityPostDetailOut, response_model_exclude_none=True
)
async def get_post_detail(
    post_id: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> CommunityPostDetailOut:
    """게시글 상세 + 댓글 목록(최대 100건, 작성순)을 반환한다 - 열람은 익명 허용."""
    post = community_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    is_liked = None if user is None else community_repo.is_liked_by(db, post_id, user.uid)
    requester_uid = None if user is None else user.uid
    comments = community_repo.list_comments(db, post_id)
    return CommunityPostDetailOut(
        post=_to_post_out(post, requester_uid=requester_uid, is_liked=is_liked),
        comments=[_to_comment_out(c, requester_uid=requester_uid) for c in comments],
    )


@router.post(
    "/posts/{post_id}/comments",
    response_model=CommunityCommentOut,
    response_model_exclude_none=True,
    status_code=201,
)
async def create_comment(
    post_id: str,
    payload: CommunityCommentCreateIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("community-comment-create", limit=20)),
) -> CommunityCommentOut:
    """댓글을 작성한다. 부모 게시글이 secret 게시판 소속이면 실명 공개 요청도 무시하고 익명 강제.

    부모 게시글의 board_id를 알아야 강제 익명 여부를 판단할 수 있어 get_post를 먼저
    호출한다(community_repo.create_comment도 트랜잭션 안에서 다시 존재를 확인하지만,
    거긴 board_id를 모르는 순수 데이터 계층이라 이 판단을 할 수 없다).
    """
    post = community_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    board = get_board(post.board_id)
    is_anonymous = True if (board is not None and board.force_anonymous) else payload.is_anonymous
    author_display_name = None if is_anonymous else _snapshot_display_name(db, user.uid)
    comment = community_repo.create_comment(
        db,
        post_id,
        author_uid=user.uid,
        is_anonymous=is_anonymous,
        author_display_name=author_display_name,
        body=payload.body,
        created_at=_now_ms(),
    )
    return _to_comment_out(comment, requester_uid=user.uid)


@router.delete("/posts/{post_id}/comments/{comment_id}", status_code=204)
async def delete_comment(
    post_id: str,
    comment_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> None:
    """본인 댓글을 삭제한다. 없으면 404, 작성자가 아니면 403."""
    try:
        community_repo.delete_comment(db, post_id, comment_id, user.uid)
    except community_repo.CommentNotFoundError as e:
        raise _COMMENT_NOT_FOUND from e
    except community_repo.CommentPermissionError as e:
        raise _COMMENT_FORBIDDEN from e


@router.delete("/posts/{post_id}", status_code=204)
async def delete_post(
    post_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> None:
    """본인 게시글을 삭제한다. 없으면 404, 작성자가 아니면 403."""
    try:
        community_repo.delete_post(db, post_id, user.uid)
    except community_repo.PostNotFoundError as e:
        raise _POST_NOT_FOUND from e
    except community_repo.PostPermissionError as e:
        raise _POST_FORBIDDEN from e


@router.post(
    "/posts/{post_id}/like", response_model=CommunityPostOut, response_model_exclude_none=True
)
async def like_post(
    post_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> CommunityPostOut:
    """게시글에 좋아요를 남긴다. 응답은 갱신된 게시글(follow_user가 갱신된 프로필을
    돌려주는 것과 동일한 관례)."""
    try:
        community_repo.like_post(db, post_id, user.uid)
    except community_repo.PostNotFoundError as e:
        raise _POST_NOT_FOUND from e
    post = community_repo.get_post(db, post_id)
    if post is None:
        # like_post 성공 직후라 정상 경로에선 없을 수 없지만, assert는 python -O에서
        # 사라져 None이 그대로 흘러간다(검수 지적) - unlike와 같은 404로 처리.
        raise _POST_NOT_FOUND
    return _to_post_out(post, requester_uid=user.uid, is_liked=True)


@router.delete(
    "/posts/{post_id}/like", response_model=CommunityPostOut, response_model_exclude_none=True
)
async def unlike_post(
    post_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> CommunityPostOut:
    """게시글 좋아요를 취소한다. 응답은 갱신된 게시글."""
    community_repo.unlike_post(db, post_id, user.uid)
    post = community_repo.get_post(db, post_id)
    if post is None:
        raise _POST_NOT_FOUND
    return _to_post_out(post, requester_uid=user.uid, is_liked=False)
