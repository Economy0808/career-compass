"""임베딩 클라이언트 팩토리 분기 + Fake/Vertex 어댑터 테스트."""

import json

import httpx
import pytest

from app.config import Settings
from app.embedding import get_embedding_client
from app.embedding.base import EmbeddingError
from app.embedding.fake_client import DIMENSIONS, FakeEmbeddingClient
from app.embedding.vertex_client import VertexEmbeddingClient


def _settings(**over) -> Settings:
    base = {"app_env": "development", "embedding_enabled": True}
    return Settings(**{**base, **over})


# --- use_real_embeddings 판별 ------------------------------------------------


@pytest.mark.parametrize(
    "embedding_enabled,app_env,expected",
    [
        (True, "production", True),
        (True, "staging", True),
        (True, "development", False),  # 로컬엔 GCP ADC가 없는 게 보통
        (True, "test", False),  # 테스트는 절대 실제 호출 안 함
        (False, "production", False),  # 킬 스위치
    ],
)
def test_use_real_embeddings(embedding_enabled: bool, app_env: str, expected: bool) -> None:
    assert (
        _settings(embedding_enabled=embedding_enabled, app_env=app_env).use_real_embeddings
        is expected
    )


# --- 팩토리 분기 -------------------------------------------------------------


def test_factory_returns_fake_in_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.embedding.get_settings", lambda: _settings(app_env="development"))
    get_embedding_client.cache_clear()
    assert isinstance(get_embedding_client(), FakeEmbeddingClient)
    get_embedding_client.cache_clear()


def test_factory_returns_fake_when_kill_switch_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.embedding.get_settings",
        lambda: _settings(app_env="production", embedding_enabled=False),
    )
    get_embedding_client.cache_clear()
    assert isinstance(get_embedding_client(), FakeEmbeddingClient)
    get_embedding_client.cache_clear()


def test_factory_returns_vertex_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.embedding.get_settings", lambda: _settings(app_env="production"))
    get_embedding_client.cache_clear()
    assert isinstance(get_embedding_client(), VertexEmbeddingClient)
    get_embedding_client.cache_clear()


# --- Fake 클라이언트 ---------------------------------------------------------


async def test_fake_embed_is_deterministic() -> None:
    client = FakeEmbeddingClient()
    a = await client.embed("빅데이터", kind="query")
    b = await client.embed("빅데이터", kind="query")
    assert a == b


async def test_fake_embed_ignores_kind() -> None:
    """같은 문자열이면 kind가 달라도 동일 벡터(거리 0) - 결정성 요구사항."""
    client = FakeEmbeddingClient()
    query_vec = await client.embed("데이터사이언티스트", kind="query")
    doc_vec = await client.embed("데이터사이언티스트", kind="document")
    assert query_vec == doc_vec


async def test_fake_embed_has_expected_dimensions() -> None:
    client = FakeEmbeddingClient()
    vector = await client.embed("아무 텍스트", kind="document")
    assert len(vector) == DIMENSIONS


async def test_fake_embed_is_unit_norm() -> None:
    client = FakeEmbeddingClient()
    vector = await client.embed("단위노름 확인용 텍스트", kind="document")
    norm = sum(v * v for v in vector) ** 0.5
    assert norm == pytest.approx(1.0, abs=1e-9)


async def test_fake_embed_different_text_gives_different_vector() -> None:
    client = FakeEmbeddingClient()
    a = await client.embed("빅데이터", kind="query")
    b = await client.embed("밴드동아리", kind="query")
    assert a != b


# --- Vertex 클라이언트 -------------------------------------------------------


def _vertex(handler, **over) -> VertexEmbeddingClient:
    st = _settings(app_env="production", **over)
    return VertexEmbeddingClient(
        settings=st,
        access_token="fake-token",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def _predict_response(values: list[float]) -> httpx.Response:
    return httpx.Response(200, json={"predictions": [{"embeddings": {"values": values}}]})


async def test_vertex_embed_posts_expected_url_headers_and_body() -> None:
    from app.firestore.client import _resolve_project_id

    project = _resolve_project_id()
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["project_header"] = request.headers.get("x-goog-user-project")
        seen["json"] = json.loads(request.content)
        return _predict_response([0.1] * DIMENSIONS)

    await _vertex(handler).embed("빅데이터", kind="query")

    assert seen["url"] == (
        f"https://asia-northeast3-aiplatform.googleapis.com/v1/projects/{project}/"
        "locations/asia-northeast3/publishers/google/models/gemini-embedding-001:predict"
    )
    assert seen["auth"] == "Bearer fake-token"
    assert seen["project_header"] == project
    assert seen["json"]["instances"] == [{"content": "빅데이터", "task_type": "RETRIEVAL_QUERY"}]
    assert seen["json"]["parameters"] == {"outputDimensionality": DIMENSIONS, "autoTruncate": True}


async def test_vertex_embed_uses_document_task_type() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = json.loads(request.content)
        return _predict_response([0.1] * DIMENSIONS)

    await _vertex(handler).embed("데이터사이언티스트 목표", kind="document")
    assert seen["json"]["instances"][0]["task_type"] == "RETRIEVAL_DOCUMENT"


async def test_vertex_embed_parses_values() -> None:
    values = [float(i) / DIMENSIONS for i in range(DIMENSIONS)]

    def handler(request: httpx.Request) -> httpx.Response:
        return _predict_response(values)

    result = await _vertex(handler).embed("텍스트", kind="query")
    assert result == values


async def test_vertex_embed_raises_on_dimension_mismatch() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _predict_response([0.1] * 10)  # 768이 아님

    with pytest.raises(EmbeddingError):
        await _vertex(handler).embed("텍스트", kind="query")


async def test_vertex_embed_retries_once_then_raises_on_5xx() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503, json={"error": "unavailable"})

    with pytest.raises(EmbeddingError):
        await _vertex(handler).embed("텍스트", kind="query")
    assert len(calls) == 2


async def test_vertex_embed_does_not_retry_on_4xx() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(400, json={"error": "bad request"})

    with pytest.raises(EmbeddingError):
        await _vertex(handler).embed("텍스트", kind="query")
    assert len(calls) == 1
