"""OpenAI 임베딩 클라이언트 (NCS 직무 매칭용).

CLAUDE.md 기준 임베딩 모델은 text-embedding-3-small로 고정. openai 패키지를 새로
추가하지 않고 이미 의존성에 있는 httpx로 REST 엔드포인트를 직접 호출한다.

키가 없으면 RuntimeError를 던지고, 호출자(ncs_repo)가 pg_trgm 매칭으로 폴백한다.
"""

import httpx

from app.config import get_settings

_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"


async def embed_texts(texts: list[str], *, timeout: float = 30.0) -> list[list[float]]:
    """텍스트 배치를 임베딩 벡터로 변환한다 (입력 순서와 동일한 순서로 반환)."""
    if not texts:
        return []
    settings = get_settings()
    key = settings.openai_api_key.strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다.")

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            _EMBEDDINGS_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"model": settings.embedding_model, "input": texts},
        )
        resp.raise_for_status()
        payload = resp.json()

    # API가 순서를 보장하지 않으므로 index로 정렬해 입력 순서에 맞춘다.
    items = sorted(payload["data"], key=lambda d: d["index"])
    return [item["embedding"] for item in items]
