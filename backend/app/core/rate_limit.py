"""인메모리 슬라이딩 윈도우 레이트리미터.

프로세스 로컬이라 다중 워커/서버에서는 워커별로 따로 계산된다 —
프로토타입 규모에서는 충분하며, 스케일아웃 시 Redis 기반으로 교체할 것.
"""

import time
from collections import deque
from collections.abc import AsyncIterator, Callable

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError

_hits: dict[str, deque[float]] = {}

# 부작용 없는 사용자 입력 오류 — 슬롯을 환불한다.
# 409(중복 아이디/이메일 등)는 값을 입력해봐야 알 수 있는 오류라 환불 대상이고,
# 422(요청 바디 유효성 검증 실패)도 마찬가지다.
# 400/401/403은 무차별 대입 영역(로그인 실패, 인증 코드 오답 등)이라 절대 환불하지 않는다 —
# 여기서 환불하면 시도 횟수 제한 자체가 무력화된다.
_REFUNDABLE_STATUS_CODES = frozenset({409, 422})


def allow(key: str, limit: int, window_sec: float) -> bool:
    now = time.monotonic()
    bucket = _hits.setdefault(key, deque())
    while bucket and now - bucket[0] > window_sec:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def refund(key: str) -> None:
    """직전 allow() 호출로 소비된 슬롯 하나를 되돌린다.

    부작용 없는 사용자 입력 오류(409/422) 처리 후에만 호출해야 한다.
    버킷이 비어 있으면(예: 이미 윈도우가 만료돼 비워진 경우) 조용히 무시한다.
    """
    bucket = _hits.get(key)
    if bucket:
        bucket.pop()


def reset() -> None:
    """테스트용: 카운터 초기화."""
    _hits.clear()


def rate_limit(
    scope: str,
    limit: int,
    window_sec: float = 60.0,
    hard_limit: int | None = None,
) -> Callable[[Request], AsyncIterator[None]]:
    """FastAPI dependency 팩토리. IP + scope 단위로 제한한다.

    409(중복)/422(유효성 검증 실패)처럼 부작용 없는 사용자 입력 오류는 소비한
    슬롯을 환불해, 오탈자 몇 번으로 정상 재시도가 막히지 않게 한다 (soft limit).

    다만 409 환불을 무제한 허용하면 아이디/이메일 존재 여부를 무한정 조회하는
    열거(enumeration) 공격이 가능해진다. hard_limit을 지정하면 절대 환불되지
    않는 2차 상한을 별도 버킷("{scope}:hard:{ip}")으로 함께 걸어, 환불 여부와
    무관하게 윈도우당 전체 시도 횟수를 제한한다.
    """

    async def dependency(request: Request) -> AsyncIterator[None]:
        client_ip = request.client.host if request.client else "unknown"
        soft_key = f"{scope}:{client_ip}"

        if hard_limit is not None:
            hard_key = f"{scope}:hard:{client_ip}"
            if not allow(hard_key, hard_limit, window_sec):
                raise HTTPException(
                    status_code=429, detail="요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
                )

        if not allow(soft_key, limit, window_sec):
            raise HTTPException(
                status_code=429, detail="요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
            )

        try:
            yield
        except HTTPException as exc:
            if exc.status_code in _REFUNDABLE_STATUS_CODES:
                refund(soft_key)
            raise
        except RequestValidationError:
            # pydantic 요청 바디 검증 실패 → 422. 엔드포인트 진입 전에 걸러지지만
            # 서브 디펜던시는 body 검증보다 먼저 실행되므로 이미 슬롯을 소비한
            # 상태다 (fastapi/dependencies/utils.py의 solve_dependencies 순서).
            refund(soft_key)
            raise

    return dependency
