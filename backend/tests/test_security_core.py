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


def test_refund_returns_slot_to_bucket() -> None:
    key = "test:refund"
    assert rate_limit.allow(key, limit=1, window_sec=60)
    assert not rate_limit.allow(key, limit=1, window_sec=60)  # 슬롯 소진
    rate_limit.refund(key)
    assert rate_limit.allow(key, limit=1, window_sec=60)  # 환불됐으므로 다시 허용


def test_refund_on_empty_or_unknown_bucket_is_noop() -> None:
    # 호출된 적 없는 키를 환불해도 에러 없이 조용히 무시한다.
    rate_limit.refund("test:never-called")


@pytest.mark.asyncio
async def test_rate_limit_dependency_refunds_409_and_422_but_not_401() -> None:
    """yield 디펜던시가 409/422는 슬롯을 환불하고, 401은 환불하지 않는지 직접 검증한다."""
    from fastapi import HTTPException
    from fastapi.exceptions import RequestValidationError
    from starlette.requests import Request

    def _fake_request() -> Request:
        return Request({"type": "http", "client": ("9.9.9.9", 1234), "headers": []})

    # 409는 환불된다 → limit=1이어도 같은 스코프를 바로 다시 쓸 수 있다.
    dep = rate_limit.rate_limit("dep-test-409", limit=1, window_sec=60)
    gen = dep(_fake_request())
    await gen.__anext__()  # allow() 통과, yield 지점까지 진행
    with pytest.raises(HTTPException):
        await gen.athrow(HTTPException(status_code=409, detail="dup"))
    gen2 = dep(_fake_request())
    await gen2.__anext__()  # 환불됐으므로 다시 통과해야 함
    with pytest.raises(StopAsyncIteration):
        await gen2.__anext__()

    # 422도 환불된다.
    dep_422 = rate_limit.rate_limit("dep-test-422", limit=1, window_sec=60)
    gen3 = dep_422(_fake_request())
    await gen3.__anext__()
    with pytest.raises(RequestValidationError):
        await gen3.athrow(RequestValidationError(errors=[]))
    gen4 = dep_422(_fake_request())
    await gen4.__anext__()  # 환불됐으므로 다시 통과해야 함

    # 401은 환불되지 않는다 → 같은 스코프의 다음 호출은 429로 막힌다.
    dep_401 = rate_limit.rate_limit("dep-test-401", limit=1, window_sec=60)
    gen5 = dep_401(_fake_request())
    await gen5.__anext__()
    with pytest.raises(HTTPException):
        await gen5.athrow(HTTPException(status_code=401, detail="bad"))
    gen6 = dep_401(_fake_request())
    with pytest.raises(HTTPException) as exc_info:
        await gen6.__anext__()
    assert exc_info.value.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_dependency_hard_limit_survives_refunds() -> None:
    """hard_limit은 soft 환불과 무관하게 전체 시도 횟수를 제한한다."""
    from fastapi import HTTPException
    from starlette.requests import Request

    def _fake_request() -> Request:
        return Request({"type": "http", "client": ("9.9.9.8", 1234), "headers": []})

    dep = rate_limit.rate_limit("dep-test-hard", limit=5, window_sec=60, hard_limit=2)

    # 매번 409로 끝나 soft는 계속 환불되지만, hard는 2번 만에 막혀야 한다.
    for _ in range(2):
        gen = dep(_fake_request())
        await gen.__anext__()
        with pytest.raises(HTTPException) as exc_info:
            await gen.athrow(HTTPException(status_code=409, detail="dup"))
        assert exc_info.value.status_code == 409

    gen = dep(_fake_request())
    with pytest.raises(HTTPException) as exc_info:
        await gen.__anext__()
    assert exc_info.value.status_code == 429


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
