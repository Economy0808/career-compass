"""Vertex AI 실호출 스모크 테스트.

기본 스위트에서는 항상 스킵된다 - CI/일반 pytest 실행이 과금되는 실 API를
부르면 안 된다. 아래 두 환경변수를 모두 사람이 직접 설정했을 때만 실행된다:

    EMBEDDING_LIVE_SMOKE=1
    GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token)

검증 목표: "빅데이터"(질의) 임베딩이 "데이터사이언티스트..."(문서) 임베딩과
코사인 거리가 "밴드동아리 기타..."(문서) 임베딩보다 가까운가 - 즉 실제 임베딩
모델이 의미적으로 그럴듯한 벡터를 돌려주는지 확인한다. FakeEmbeddingClient는
의미 유사도를 흉내내지 않으므로 이 검증은 반드시 실제 Vertex 호출로만 가능하다.
"""

import math
import os

import pytest

from app.embedding.vertex_client import VertexEmbeddingClient

_LIVE = os.environ.get("EMBEDDING_LIVE_SMOKE") == "1" and bool(
    os.environ.get("GCLOUD_ACCESS_TOKEN")
)

pytestmark = pytest.mark.skipif(
    not _LIVE,
    reason="EMBEDDING_LIVE_SMOKE=1 과 GCLOUD_ACCESS_TOKEN이 모두 설정됐을 때만 실행",
)


def _cosine_distance(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return 1.0 - dot / (norm_a * norm_b)


async def test_related_texts_are_closer_than_unrelated_texts() -> None:
    client = VertexEmbeddingClient(access_token=os.environ["GCLOUD_ACCESS_TOKEN"])

    query = await client.embed("빅데이터", kind="query")
    related = await client.embed(
        "데이터사이언티스트가 되기 위해 통계와 머신러닝을 공부하고 싶다", kind="document"
    )
    unrelated = await client.embed("밴드동아리에서 기타를 치고 합주를 하고 싶다", kind="document")

    assert len(query) == 768
    assert len(related) == 768
    assert len(unrelated) == 768
    assert _cosine_distance(query, related) < _cosine_distance(query, unrelated)
