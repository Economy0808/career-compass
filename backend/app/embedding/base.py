"""임베딩 클라이언트 인터페이스.

app/email/base.py와 동일한 Protocol + 예외 패턴 - Mock/실제 어댑터를 갈아끼울 수
있게 도메인 코드는 이 인터페이스에만 의존한다.
"""

from typing import Literal, Protocol

# 질의(query) 임베딩과 문서(document) 임베딩은 Vertex 쪽에서 서로 다른
# task_type으로 최적화된다(비대칭 검색) - kind로 어느 쪽인지 알려준다.
EmbeddingKind = Literal["query", "document"]


class EmbeddingError(RuntimeError):
    """임베딩 생성 실패. 호출측이 조용히 폴백하거나 위로 던질지 판단한다.

    탐색 검색(app/api/explore.py)은 이걸 잡아 부분일치 검색으로 폴백하고,
    프로필 임베딩 갱신(app/services/profile_embedding.py)은 이걸 잡아
    발행/프로필 수정 자체를 막지 않는다 - 임베딩은 검색 품질 향상 기능이지
    핵심 경로가 아니다.
    """


class EmbeddingClient(Protocol):
    async def embed(self, text: str, *, kind: EmbeddingKind) -> list[float]:
        """텍스트 하나를 임베딩 벡터로 변환한다. 실패 시 EmbeddingError."""
        ...
