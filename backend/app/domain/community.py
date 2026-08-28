"""커뮤니티 게시판(자유/비밀/질문/정보/진로/홍보)의 순수 도메인 모델.

DB/Firestore 클라이언트 의존성이 없다(app/domain/constellation.py, app/domain/post.py와
동일 관례) - pytest만으로 단위 테스트하고 API/리포지토리 계층에서 그대로 재사용한다.

## 게시판은 코드 상수다

# ponytail: 게시판 종류는 유저가 늘리는 게 아니라 배포로만 바뀌는 고정 목록(6개
# 확정)이라 Firestore 컬렉션으로 만들 이유가 없다(YAGNI) - BOARDS 리스트가 정본이고
# GET /api/community/boards는 이 상수를 그대로 반환한다. 유저별 커스텀 게시판 같은
# 요구가 생기면 그때 컬렉션으로 승격할 것.

## 익명 vs 실명 공개

is_anonymous는 글/댓글 작성자가 스스로 고르는 값이다(오르비처럼 익명이 기본, 에타처럼
신뢰를 위해 실명을 깔 수도 있음). 단 secret 게시판(force_anonymous=True)은 실명 공개
옵션 자체를 주지 않는다 - 서버가 요청값과 무관하게 is_anonymous를 True로 강제한다
(app/api/community.py의 책임, 이 모듈은 상수 정의만 담당).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

MAX_TITLE_LEN = 100
MAX_BODY_LEN = 5000
MAX_COMMENT_LEN = 1000


class Board(BaseModel):
    """게시판 하나. Firestore에 저장하지 않는다 - BOARDS 상수로만 존재."""

    id: str
    name: str
    description: str
    force_anonymous: bool = False


BOARDS: list[Board] = [
    Board(
        id="free",
        name="자유",
        description="자유롭게 이야기 나누는 공간이에요.",
        force_anonymous=False,
    ),
    Board(
        id="secret",
        name="비밀",
        description="속마음을 편하게 털어놓는 공간이에요. 항상 익명으로 올라가요.",
        force_anonymous=True,
    ),
    Board(
        id="question",
        name="질문",
        description="궁금한 걸 편하게 물어보는 공간이에요.",
        force_anonymous=False,
    ),
    Board(
        id="info",
        name="정보",
        description="꿀팁과 유용한 정보를 나누는 공간이에요.",
        force_anonymous=False,
    ),
    Board(
        id="career",
        name="진로",
        description="진로 고민을 나누는 공간이에요.",
        force_anonymous=False,
    ),
    Board(
        id="promo",
        name="홍보",
        description="동아리·활동·행사를 홍보하는 공간이에요.",
        force_anonymous=False,
    ),
]

_BOARDS_BY_ID: dict[str, Board] = {board.id: board for board in BOARDS}


def get_board(board_id: str) -> Board | None:
    """board_id에 해당하는 게시판을 반환한다. 없으면 None(라우터가 404로 변환)."""
    return _BOARDS_BY_ID.get(board_id)


class CommunityPost(BaseModel):
    """게시판 글 한 건.

    Firestore 최상위 `community_posts` 컬렉션에 저장한다. author_uid는 익명 글이라도
    항상 기록한다(신고 처리·강제 삭제·악성 유저 추적용) - 노출 여부만 API 응답
    직렬화 단계에서 차단한다.
    """

    id: str
    board_id: str
    author_uid: str
    is_anonymous: bool = True
    # 실명 공개(is_anonymous=False)일 때만 작성 시점의 표시 이름을 스냅샷으로 저장한다.
    # 이후 유저가 표시 이름을 바꿔도 이미 쓴 글의 서명은 바뀌지 않는다(글 작성 시점의
    # 신원을 그대로 보존 - 프로필 실시간 조회로 바꾸면 익명 글과의 처리가 비대칭해짐).
    author_display_name: str | None = None
    title: str = Field(max_length=MAX_TITLE_LEN)
    body: str = Field(max_length=MAX_BODY_LEN)
    like_count: int = 0
    comment_count: int = 0
    created_at: int  # epoch-ms. app/domain/post.py와 동일하게 변환 계층 없이 그대로 쓴다.
    updated_at: int  # epoch-ms


class CommunityComment(BaseModel):
    """게시글에 달리는 댓글 한 건.

    Firestore `community_posts/{post_id}/comments/{comment_id}` 서브컬렉션에 저장한다.
    """

    id: str
    author_uid: str
    is_anonymous: bool = True
    author_display_name: str | None = None
    body: str = Field(max_length=MAX_COMMENT_LEN)
    created_at: int  # epoch-ms
