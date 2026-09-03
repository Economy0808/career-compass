"""임베딩 클라이언트 factory. app/email/__init__.py 과 같은 Mock/실제 분리 패턴."""

from functools import lru_cache

from app.config import get_settings
from app.embedding.base import EmbeddingClient
from app.embedding.fake_client import FakeEmbeddingClient


@lru_cache
def get_embedding_client() -> EmbeddingClient:
    """임베딩 클라이언트 factory.

    settings.use_real_embeddings가 True면(운영/스테이징 + 킬 스위치 켜짐) Vertex
    연동을, 아니면 결정적 Fake를 반환한다(개발/테스트 $0). 다른 코드는
    EmbeddingClient 인터페이스에만 의존한다.
    """
    settings = get_settings()
    if settings.use_real_embeddings:
        # 지연 import: 개발/테스트 환경에서는 google.auth 인증 흐름을 아예 건드리지 않는다.
        from app.embedding.vertex_client import VertexEmbeddingClient

        return VertexEmbeddingClient()
    return FakeEmbeddingClient()
