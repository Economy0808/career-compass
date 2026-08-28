"""프로필 사진 게시물(Post)의 순수 도메인 모델.

인스타그램식 "사진 여러 장 + 짧은 글 + 좋아요·댓글" 게시물이다. Cloud Storage는
Blaze 결제 보류 상태라 아직 못 쓴다(브리핑 참고) - 그래서 이미지를 파일로
업로드하는 대신 data URL(base64)로 인코딩해 Firestore 문서 필드에 직접 저장하는
임시 구조를 쓴다. Firestore 문서 1MiB 한도 안에 들어와야 하므로 image_data 길이를
빡빡하게 제한한다.

# ponytail: Storage 이관 전까지의 임시 구조. Blaze 결제가 열리면 image_data를
# Storage URL로 바꾸고 이 base64 검증/길이 제한을 걷어낼 것.

## 다중 사진 (Firestore 1MiB 문서 한도 대응)

Post(부모 posts/{id} 문서)에는 첫 장을 image_data 필드에 썸네일 용도로 그대로
유지한다(역호환 - 기존 단일 이미지 글도 image_count=1로 자연스럽게 인식된다).
전체 이미지는 app/firestore/post_repo.py가 posts/{id}/images/{index} 서브컬렉션에
PostImage 문서로 따로 저장한다 - 장당 문서라 이미지 한 장마다 1MiB 개별 한도를
받는다(부모 문서 하나에 여러 장을 몰아넣으면 3~4장만 돼도 1MiB를 넘길 수 있다).
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

# data:image/{jpeg|png|webp};base64,{...} 형식만 허용한다. 프론트가 <canvas>/
# FileReader로 만드는 표준 data URL 형식이고, 그 외 MIME 타입(svg 등 XSS 벡터가
# 될 수 있는 것 포함)은 거부한다.
IMAGE_DATA_PATTERN = r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$"
_IMAGE_DATA_RE = re.compile(IMAGE_DATA_PATTERN)

# Firestore 문서 1MiB(1,048,576바이트) 한도 안에 다른 필드(caption 등)와 함께
# 여유 있게 들어오도록 950,000자로 제한한다(브리핑 지정값).
MAX_IMAGE_DATA_LEN = 950_000
MAX_CAPTION_LEN = 500
MAX_POST_COMMENT_LEN = 500

# 게시물 한 건에 올릴 수 있는 사진 장수 (1~10장, 브리핑 지정값).
MIN_IMAGES = 1
MAX_IMAGES = 10


def validate_image_data(v: str) -> str:
    """data URL 형식 검증 - app/domain/story.py도 그대로 재사용한다(브리핑 지정:
    스토리 이미지는 posts와 동일 제약·검증을 재사용)."""
    if not _IMAGE_DATA_RE.match(v):
        raise ValueError("image_data는 data:image/(jpeg|png|webp);base64,... 형식이어야 합니다.")
    return v


class Post(BaseModel):
    """프로필에 올리는 사진 게시물 한 건 (부모 문서).

    image_data는 첫 장(index 0) 썸네일이다 - 목록 화면은 이 필드만 읽고 전체
    이미지 서브컬렉션은 조인하지 않는다(비용 문제, app/firestore/post_repo.py
    참고). image_count가 1이면 서브컬렉션 없이 이 필드 하나가 사실상 전부인
    기존(역호환) 게시물일 수 있다 - 조회 쪽(API)에서 그 경우를 인식해 폴백한다.
    """

    id: str
    owner_id: str  # Firebase Auth UID
    image_data: str = Field(max_length=MAX_IMAGE_DATA_LEN)
    image_count: int = Field(default=1, ge=MIN_IMAGES, le=MAX_IMAGES)
    caption: str = Field(default="", max_length=MAX_CAPTION_LEN)
    like_count: int = Field(default=0, ge=0)
    comment_count: int = Field(default=0, ge=0)
    created_at: int  # epoch-ms. 와이어 포맷과 도메인 표현이 동일해 변환 계층이 필요 없다.

    @field_validator("image_data")
    @classmethod
    def _check_image_data(cls, v: str) -> str:
        return validate_image_data(v)


class PostImage(BaseModel):
    """posts/{id}/images/{index} 서브컬렉션 문서 한 장.

    index는 0-base 순서다. 문서 id도 str(index)로 그대로 쓴다(app/firestore/post_repo.py) -
    순서가 곧 정렬 키라 별도 created_at을 둘 이유가 없다.
    """

    index: int = Field(ge=0)
    image_data: str = Field(max_length=MAX_IMAGE_DATA_LEN)

    @field_validator("image_data")
    @classmethod
    def _check_image_data(cls, v: str) -> str:
        return validate_image_data(v)


class PostComment(BaseModel):
    """게시물에 달리는 댓글 한 건.

    Firestore posts/{id}/comments/{comment_id} 서브컬렉션에 저장한다. SNS층
    (프로필/게시물)은 커뮤니티 게시판과 달리 익명 옵션이 없으므로(브리핑:
    "SNS층은 익명 없음") author_uid/author_display_name을 항상 그대로 노출한다 -
    app/api/community.py의 _to_comment_out 같은 익명 차단 직렬화 지점이 필요 없다.
    """

    id: str
    author_uid: str
    author_display_name: str | None = None
    body: str = Field(max_length=MAX_POST_COMMENT_LEN)
    created_at: int  # epoch-ms
