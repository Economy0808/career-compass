"""quota_repo 단위 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_explore_api.py와 동일한 이유로 Mock을 쓰지 않는다(트랜잭션 재시도/직렬화
동작은 실제 에뮬레이터가 아니면 검증할 수 없다) - 스킵 가드도 그 파일을 그대로
복사한 관례다.

실행 방법 (backend/ 에서, 두 에뮬레이터가 이미 떠 있는 상태):
    .venv/Scripts/python.exe -m pytest tests/test_quota_repo.py -q
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import requests

from app.firestore import quota_repo
from app.firestore.client import get_firestore_client


def _emulator_available() -> bool:
    """FIRESTORE_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)


def _uid() -> str:
    """테스트마다 독립된 유저 문서를 쓰기 위한 유니크 uid."""
    return f"quota-test-{uuid.uuid4().hex}"


@pytest.mark.asyncio
async def test_first_consume_charges_free_and_opens_cycle() -> None:
    db = get_firestore_client()
    uid = _uid()

    result = quota_repo.consume_cycle(db, uid)

    assert result.charged is True
    assert result.reused is False
    assert result.consumed_from == "free"
    assert result.cycle_id is not None

    quota = quota_repo.get_quota(db, uid)
    assert quota["freeCreditLeft"] == 0
    assert quota["hasOpenCycle"] is True


@pytest.mark.asyncio
async def test_second_consume_same_user_reuses_open_cycle_without_charge() -> None:
    db = get_firestore_client()
    uid = _uid()

    first = quota_repo.consume_cycle(db, uid)
    second = quota_repo.consume_cycle(db, uid)

    assert second.charged is False
    assert second.reused is True
    assert second.cycle_id == first.cycle_id

    quota = quota_repo.get_quota(db, uid)
    assert quota["freeCreditLeft"] == 0  # 두 번째 호출로 추가 차감되지 않았다


@pytest.mark.asyncio
async def test_consume_after_close_completed_with_no_credits_raises_quota_exceeded() -> None:
    db = get_firestore_client()
    uid = _uid()

    quota_repo.consume_cycle(db, uid)  # 무료 소진 + 사이클 오픈
    quota_repo.close_cycle(db, uid, outcome="completed")  # 복원 없이 닫기

    with pytest.raises(quota_repo.QuotaExceeded):
        quota_repo.consume_cycle(db, uid)


@pytest.mark.asyncio
async def test_consume_after_grant_credits_consumes_credit() -> None:
    db = get_firestore_client()
    uid = _uid()

    quota_repo.consume_cycle(db, uid)
    quota_repo.close_cycle(db, uid, outcome="completed")
    quota_repo.grant_credits(db, uid, 3)

    result = quota_repo.consume_cycle(db, uid)

    assert result.charged is True
    assert result.consumed_from == "credit"
    quota = quota_repo.get_quota(db, uid)
    assert quota["credits"] == 2


@pytest.mark.asyncio
async def test_close_with_refund_restores_credit() -> None:
    db = get_firestore_client()
    uid = _uid()

    quota_repo.consume_cycle(db, uid)
    quota_repo.close_cycle(db, uid, outcome="completed")
    quota_repo.grant_credits(db, uid, 1)
    quota_repo.consume_cycle(db, uid)  # 크레딧 1 소진

    quota_repo.close_cycle(db, uid, outcome="refund")

    quota = quota_repo.get_quota(db, uid)
    assert quota["credits"] == 1  # 복원됨
    assert quota["hasOpenCycle"] is False


@pytest.mark.asyncio
async def test_concurrent_consume_charges_exactly_once() -> None:
    """동시 consume 2건 중 정확히 1건만 charged - 트랜잭션 직렬화 검증."""
    db = get_firestore_client()
    uid = _uid()

    results = await asyncio.gather(
        asyncio.to_thread(quota_repo.consume_cycle, db, uid),
        asyncio.to_thread(quota_repo.consume_cycle, db, uid),
        return_exceptions=True,
    )

    charged = [r for r in results if isinstance(r, quota_repo.ConsumeResult) and r.charged]
    exceeded = [r for r in results if isinstance(r, quota_repo.QuotaExceeded)]
    reused = [r for r in results if isinstance(r, quota_repo.ConsumeResult) and r.reused]

    # 두 트랜잭션이 경합하면 한쪽만 새로 열고(charged), 다른 한쪽은 재시도 후
    # 그 사이클을 그대로 이어받거나(reused) 무료/크레딧이 없어 QuotaExceeded다 -
    # 어느 경우든 실제 차감은 정확히 1건이어야 한다.
    assert len(charged) == 1
    assert len(reused) + len(exceeded) == 1


@pytest.mark.asyncio
async def test_get_quota_lazy_grants_free_credit_for_new_user() -> None:
    db = get_firestore_client()
    uid = _uid()

    quota = quota_repo.get_quota(db, uid)

    assert quota == {"freeCreditLeft": 1, "credits": 0, "hasOpenCycle": False}
