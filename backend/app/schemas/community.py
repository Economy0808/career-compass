"""/api/community 요청/응답 스키마.

app/schemas/profiles.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다. 게시판은 상수 목록(app/domain/community.py의 BOARDS)이라
생성/수정 스키마가 없다 - BoardOut은 그 상수를 그대로 직렬화할 응답 형태만 정의한다.

## 익명 직렬화 규칙 (핵심 - 실제 강제 지점은 app/api/community.py)

CommunityPostOut/CommunityCommentOut의 author_uid/author_display_name/is_mine/is_liked는
전부 옵션 필드이고, 라우터가 response_model_exclude_none=True로 등록하므로 None이면
응답 JSON에서 키 자체가 빠진다. 이 스키마 자체는 "익명이면 채우지 말아야 한다"는 규칙을
강제하지 않는다 - 그건 app/api/community.py의 _to_post_out/_to_comment_out이 전담한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.domain.community import MAX_BODY_LEN, MAX_COMMENT_LEN, MAX_TITLE_LEN


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class BoardOut(_CamelModel):
    """게시판 상수 응답.

    와이어 필드명은 `forcedAnonymous`다(프론트 세션 합의 - 비밀 게시판의 실명 체크박스
    제거 판정에 이 정확한 이름을 쓴다). 도메인 모델(app/domain/community.py)의 내부
    필드명은 force_anonymous 그대로 두고, 여기서만 forced_anonymous로 이름을 맞춰
    to_camel이 정확히 forcedAnonymous로 변환하게 한다.
    """

    id: str
    name: str
    description: str
    forced_anonymous: bool


class CommunityPostCreateIn(_CamelModel):
    """게시글 작성 요청. is_anonymous는 secret 게시판이면 서버가 True로 강제한다."""

    is_anonymous: bool = True
    title: str = Field(min_length=1, max_length=MAX_TITLE_LEN)
    body: str = Field(min_length=1, max_length=MAX_BODY_LEN)


class CommunityPostOut(_CamelModel):
    """게시글 응답.

    author_uid/author_display_name은 is_anonymous=false일 때만 채워진다.
    is_mine/is_liked는 요청자가 로그인했을 때만 채워진다(그 외에는 None -> 응답에서 키 생략).
    """

    id: str
    board_id: str
    is_anonymous: bool
    author_uid: str | None = None
    author_display_name: str | None = None
    is_mine: bool | None = None
    title: str
    body: str
    like_count: int = 0
    comment_count: int = 0
    is_liked: bool | None = None
    created_at: int
    updated_at: int


class CommunityCommentCreateIn(_CamelModel):
    """댓글 작성 요청. 부모 게시글이 secret 게시판 소속이면 서버가 True로 강제한다."""

    is_anonymous: bool = True
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LEN)


class CommunityCommentOut(_CamelModel):
    """댓글 응답. author_uid/author_display_name 노출 규칙은 CommunityPostOut과 동일."""

    id: str
    is_anonymous: bool
    author_uid: str | None = None
    author_display_name: str | None = None
    is_mine: bool | None = None
    body: str
    created_at: int


class CommunityPostDetailOut(_CamelModel):
    """게시글 상세 + 댓글 목록 응답."""

    post: CommunityPostOut
    comments: list[CommunityCommentOut]
