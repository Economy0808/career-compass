"""프로필 사진 게시물(Post)의 순수 도메인 모델.

인스타그램식 "사진 한 장 + 짧은 글" 게시물이다. Cloud Storage는 Blaze 결제
보류 상태라 아직 못 쓴다(브리핑 참고) - 그래서 이미지를 파일로 업로드하는
대신 data URL(base64)로 인코딩해 Firestore 문서 필드에 직접 저장하는 임시
구조를 쓴다. Firestore 문서 1MiB 한도 안에 들어와야 하므로 image_data 길이를
빡빡하게 제한한다.

# ponytail: Storage 이관 전까지의 임시 구조. Blaze 결제가 열리면 image_data를
# Storage URL로 바꾸고 이 base64 검증/길이 제한을 걷어낼 것.
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


class Post(BaseModel):
    """프로필에 올리는 사진 게시물 한 건."""

    id: str
    owner_id: str  # Firebase Auth UID
    image_data: str = Field(max_length=MAX_IMAGE_DATA_LEN)
    caption: str = Field(default="", max_length=MAX_CAPTION_LEN)
    created_at: int  # epoch-ms. 와이어 포맷과 도메인 표현이 동일해 변환 계층이 필요 없다.

    @field_validator("image_data")
    @classmethod
    def _check_image_data(cls, v: str) -> str:
        if not _IMAGE_DATA_RE.match(v):
            raise ValueError(
                "image_data는 data:image/(jpeg|png|webp);base64,... 형식이어야 합니다."
            )
        return v
