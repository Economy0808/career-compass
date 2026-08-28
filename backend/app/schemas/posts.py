"""/api/posts 요청/응답 스키마.

app/schemas/profiles.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel +
populate_by_name=True)를 따른다. image_data/caption/images의 형식·길이 제약은
app/domain/post.py의 상수를 그대로 재사용한다 - 이 스키마 계층이 실제 HTTP 422를
만들어내는 지점이고(요청 바디가 라우터에 닿기 전에 여기서 걸러진다), 도메인
계층의 field_validator는 다른 호출부(테스트 등)에도 같은 불변식을 강제하는 이중
방어선이다(constellation.py의 NODE_COLOR_PATTERN과 동일한 이유).

## PostCreateIn의 images/imageData 이중 계약 (역호환)

새 클라는 `images`(1~10장)를 보낸다. 기존 클라(다중 사진 이전)는 `imageData`
단일 필드만 보낸다 - 계속 받아주되 1장짜리 게시물로 취급한다. 최소 하나는
필수이고, 둘 다 오면 `images`가 우선한다(resolved_images() 참고) - 새 클라가
과거 필드를 실수로 함께 보내는 경우를 images 우선으로 조용히 흡수한다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.domain.post import (
    MAX_CAPTION_LEN,
    MAX_IMAGE_DATA_LEN,
    MAX_IMAGES,
    MAX_POST_COMMENT_LEN,
    MIN_IMAGES,
    validate_image_data,
)


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def _check_image_item(v: str) -> str:
    """images 리스트 원소 하나를 검증한다. app/domain/post.py의 형식 검증 + 길이 제한을 그대로 쓴다."""
    validate_image_data(v)
    if len(v) > MAX_IMAGE_DATA_LEN:
        raise ValueError(f"이미지 하나는 최대 {MAX_IMAGE_DATA_LEN}자까지 허용됩니다.")
    return v


class PostCreateIn(_CamelModel):
    """게시물 생성 요청.

    images 또는 imageData 중 최소 하나는 필수다(모듈 docstring 참고).
    """

    image_data: str | None = Field(default=None, max_length=MAX_IMAGE_DATA_LEN)
    images: list[str] | None = Field(default=None, min_length=MIN_IMAGES, max_length=MAX_IMAGES)
    caption: str = Field(default="", max_length=MAX_CAPTION_LEN)

    @field_validator("image_data")
    @classmethod
    def _check_image_data(cls, v: str | None) -> str | None:
        return v if v is None else _check_image_item(v)

    @field_validator("images")
    @classmethod
    def _check_images(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return [_check_image_item(item) for item in v]

    @model_validator(mode="after")
    def _require_at_least_one_image_source(self) -> PostCreateIn:
        if not self.images and self.image_data is None:
            raise ValueError("images 또는 imageData 중 하나는 필수입니다.")
        return self

    def resolved_images(self) -> list[str]:
        """실제로 저장할 이미지 목록. images가 있으면 그것을, 없으면 imageData 1장을 쓴다."""
        if self.images:
            return self.images
        assert self.image_data is not None  # _require_at_least_one_image_source가 보장
        return [self.image_data]


class PostOut(_CamelModel):
    """게시물 응답.

    is_mine은 요청자가 로그인했고 owner_id와 uid가 같을 때만 True - 익명이거나
    다른 유저의 게시물이면 False(app/schemas/profiles.py의 is_following과 달리
    항상 값이 채워진다, None으로 숨기지 않는다). is_liked는 요청자가 로그인했을
    때만 채워진다(그 외엔 None -> response_model_exclude_none으로 응답에서 키 자체가 빠짐,
    app/schemas/community.py의 CommunityPostOut과 동일 관례).
    """

    id: str
    owner_id: str
    image_data: str
    image_count: int
    caption: str
    like_count: int = 0
    comment_count: int = 0
    is_liked: bool | None = None
    created_at: int
    is_mine: bool = False


class PostImageOut(_CamelModel):
    """게시물 상세/캐러셀용 이미지 한 장."""

    index: int
    image_data: str


class PostCommentCreateIn(_CamelModel):
    """게시물 댓글 작성 요청."""

    body: str = Field(min_length=1, max_length=MAX_POST_COMMENT_LEN)


class PostCommentOut(_CamelModel):
    """게시물 댓글 응답. SNS층은 익명이 없으므로 author 필드가 항상 채워진다."""

    id: str
    author_uid: str
    author_display_name: str | None = None
    body: str
    created_at: int


class PostDetailOut(_CamelModel):
    """게시물 단건(공유용) + 댓글 목록 응답."""

    post: PostOut
    comments: list[PostCommentOut]


# --- 피드 (전체 유저 최신 게시물) ---


class PostFeedAuthorOut(_CamelModel):
    """피드 카드의 작성자 표시 정보. users 문서가 없으면 표시 필드가 전부 None.

    app/schemas/constellation.py의 FeedAuthorOut과 동일한 문법이지만, uid도
    함께 내려준다 - 피드 카드가 작성자 프로필로 바로 이동할 수 있어야 한다.
    """

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None


class PostFeedItemOut(_CamelModel):
    post: PostOut
    author: PostFeedAuthorOut
