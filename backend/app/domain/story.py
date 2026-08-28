"""스토리(Story)의 순수 도메인 모델 - 인스타식 24시간 만료.

이미지 제약(형식/길이)은 app/domain/post.py의 Post와 완전히 동일하다 - 별도로
다시 정의하지 않고 그 모듈의 상수/검증 함수를 그대로 가져다 쓴다(브리핑 지정:
"이미지 크기 검증은 posts와 동일 로직 재사용").
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.domain.post import MAX_IMAGE_DATA_LEN, validate_image_data

# 인스타그램과 동일하게 24시간 뒤 만료.
STORY_TTL_MS = 24 * 60 * 60 * 1000


class Story(BaseModel):
    """24시간 후 만료되는 스토리 한 건."""

    id: str
    owner_id: str  # Firebase Auth UID
    image_data: str = Field(max_length=MAX_IMAGE_DATA_LEN)
    created_at: int  # epoch-ms
    expires_at: int  # epoch-ms. 서버가 created_at + STORY_TTL_MS로 계산해 저장한다.

    @field_validator("image_data")
    @classmethod
    def _check_image_data(cls, v: str) -> str:
        return validate_image_data(v)
