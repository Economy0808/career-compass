import pytest
from httpx import ASGITransport, AsyncClient

from app.core import rate_limit
from app.core.security import hash_password, hash_token, token_matches, verify_password
from app.main import app


def test_password_hash_roundtrip() -> None:
    h = hash_password("correct horse battery staple 1")
    assert h != "correct horse battery staple 1"
    assert verify_password(h, "correct horse battery staple 1")
    assert not verify_password(h, "wrong password")


def test_verify_password_with_garbage_hash_returns_false() -> None:
    assert not verify_password("not-a-hash", "anything")


def test_token_hash_is_deterministic_and_opaque() -> None:
    assert hash_token("abc") == hash_token("abc")
    assert len(hash_token("abc")) == 64
    assert token_matches("abc", hash_token("abc"))
    assert not token_matches("abd", hash_token("abc"))


def test_rate_limiter_blocks_after_limit() -> None:
    key = "test:1.2.3.4"
    for _ in range(5):
        assert rate_limit.allow(key, limit=5, window_sec=60)
    assert not rate_limit.allow(key, limit=5, window_sec=60)


def test_rate_limiter_window_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    t = [0.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: t[0])
    key = "test:expiry"
    assert rate_limit.allow(key, limit=1, window_sec=60)
    assert not rate_limit.allow(key, limit=1, window_sec=60)
    t[0] = 61.0
    assert rate_limit.allow(key, limit=1, window_sec=60)


@pytest.mark.asyncio
async def test_origin_middleware_blocks_cross_site_writes() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/auth/login",
            json={"username": "whoever", "password": "whatever1"},
            headers={"origin": "http://evil.example"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "origin not allowed"

        # 화이트리스트 origin은 미들웨어를 통과해 정상 처리(401)까지 간다.
        resp = await client.post(
            "/api/auth/login",
            json={"username": "whoever", "password": "whatever1"},
            headers={"origin": "http://localhost:3000"},
        )
        assert resp.status_code == 401
