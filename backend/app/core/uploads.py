"""이미지 업로드 공용 유틸: 매직바이트 검증 + 리사이즈.

Content-Type 헤더는 위조 가능하므로 항상 바이트를 직접 검사한다.
공개용 이미지(마일스톤 기록)는 긴 변 1280px로 축소해 JPEG로 통일 저장한다.
"""

import io

from PIL import Image, UnidentifiedImageError

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

MAX_DIMENSION = 1280
JPEG_QUALITY = 85


def detect_image_ext(data: bytes) -> str | None:
    """매직바이트로 이미지 형식을 판별한다. 지원 외 형식이면 None."""
    if data.startswith(JPEG_MAGIC):
        return "jpg"
    if data.startswith(PNG_MAGIC):
        return "png"
    return None


def resize_to_jpeg(data: bytes, max_dim: int = MAX_DIMENSION) -> bytes:
    """이미지를 열어 검증하고, 긴 변이 max_dim을 넘으면 축소해 JPEG로 저장한다.

    PNG 투명 배경은 흰색으로 합성한다. 이미지가 아니면 ValueError.
    """
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("not a valid image") from e

    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()
