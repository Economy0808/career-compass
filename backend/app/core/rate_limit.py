"""인메모리 슬라이딩 윈도우 레이트리미터.

프로세스 로컬이라 다중 워커/서버에서는 워커별로 따로 계산된다 —
프로토타입 규모에서는 충분하며, 스케일아웃 시 Redis 기반으로 교체할 것.
"""
import time
from collections import deque
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request

_hits: dict[str, deque[float]] = {}


def allow(key: str, limit: int, window_sec: float) -> bool:
    now = time.monotonic()
    bucket = _hits.setdefault(key, deque())
    while bucket and now - bucket[0] > window_sec:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def reset() -> None:
    """테스트용: 카운터 초기화."""
    _hits.clear()


def rate_limit(scope: str, limit: int, window_sec: float = 60.0) -> Callable[[Request], Awaitable[None]]:
    """FastAPI dependency 팩토리. IP + scope 단위로 제한한다."""

    async def dependency(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        if not allow(f"{scope}:{client_ip}", limit, window_sec):
            raise HTTPException(
                status_code=429, detail="요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
            )

    return dependency
