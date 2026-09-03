"""개발/테스트용 결정적 Fake 임베딩 클라이언트.

app/email/mock_sender.py와 같은 역할 - 실제 Vertex 호출 없이($0) 같은 인터페이스로
동작한다. 의미적 유사도를 흉내내지 않는다(설계 확정 사항): 텍스트가 정확히
같으면 같은 벡터(거리 0), 다르면 사실상 무작위라 "빅데이터"와 "데이터사이언티스트"가
서로 가깝다는 보장이 없다 - 그런 검증은 tests/test_embedding_vertex_live.py가 실제
Vertex로만 한다. 여기서는 팩토리 분기와 파이프라인 배선(차원 수, 정규화, 저장/조회)만
검증하면 된다.
"""

import random
import zlib

from app.embedding.base import EmbeddingKind

DIMENSIONS = 768


class FakeEmbeddingClient:
    """crc32(텍스트) 시드로 768차 단위벡터를 결정적으로 만든다. kind는 무시한다."""

    async def embed(self, text: str, *, kind: EmbeddingKind) -> list[float]:
        seed = zlib.crc32(text.strip().encode("utf-8"))
        rng = random.Random(seed)
        vector = [rng.gauss(0.0, 1.0) for _ in range(DIMENSIONS)]
        norm = sum(v * v for v in vector) ** 0.5
        return [v / norm for v in vector]
