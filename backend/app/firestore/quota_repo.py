"""별자리 "1사이클" 쿼터 리포지토리 - 무료 1회 지급 + 유료 크레딧 + 진행 중 사이클.

## 자료구조 (신규 컬렉션 없음 - users/{uid} 문서 필드로만 표현)

    quota_free_granted: bool   # 가입 시 무료 1회를 지급했는지(없으면 미지급)
    quota_free_remaining: int  # 0 또는 1
    quota_credits: int         # 유료 크레딧(기본 0)
    quota_open_cycle: {"id": str, "opened_at": datetime, "consumed_from": "free"|"credit"} | None

트랜잭션 관례는 follow_repo.py를 그대로 따른다: 모든 읽기가 끝난 뒤에만 쓴다.

## lazy 지급

quota_free_granted가 없거나 False인 유저는 이 모듈의 함수(consume_cycle,
get_quota)를 처음 호출하는 순간 트랜잭션 안에서 granted=True, free_remaining=
settings.quota_free_grant로 채워진다. 가입 시점에 별도 배치로 지급하지 않는
이유는 "가입"이라는 이벤트가 이 Firebase 경로에 명시적으로 없고(옛 9개
계정처럼 가입 자체가 이 스키마 도입보다 먼저 있었던 유저도 있다), 결국 모든
유저가 이 모듈을 처음 거치는 순간이 실질적인 "최초 접근"이기 때문이다.

## "1사이클"의 뜻

별자리 하나를 만드는 대화+생성 흐름 전체가 사이클 하나다. 첫 /chat 호출에서
차감하고(app/api/constellation_intake.py), 그다음엔 quota_open_cycle이 남아있는
동안은 재차감 없이 이어간다(멱등) - 대화 이탈은 환불하지 않고, 잡 실패/빈
결과·발행 시에만 close_cycle을 호출해 사이클을 닫는다(그 훅들은 API 레이어에
있다).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, Transaction

from app.config import get_settings

_USERS_COLLECTION = "users"
# google-cloud-firestore Transaction 기본값(5회)은 같은 유저 문서에 거의
# 동시에 두 요청이 몰리면(예: 프론트 이중 클릭/여러 탭) 재시도가 다 소진돼
# ValueError로 죽는 걸 실측했다(2026-09-03) - 충돌은 결국 "이 유저 자신의
# 문서" 하나에서만 나므로 재시도 상한을 넉넉히 올려도 다른 유저에게 영향이
# 없다.
_MAX_TX_ATTEMPTS = 20

ConsumedFrom = Literal["free", "credit"]
CycleOutcome = Literal["completed", "abandoned", "refund"]


class QuotaExceeded(Exception):
    """무료 사용권도 유료 크레딧도 남지 않았을 때."""


@dataclass
class ConsumeResult:
    """consume_cycle의 결과."""

    charged: bool
    reused: bool
    consumed_from: ConsumedFrom | None
    cycle_id: str | None


def _user_doc_ref(db: Client, uid: str) -> Any:
    return db.collection(_USERS_COLLECTION).document(uid)


def consume_cycle(db: Client, uid: str) -> ConsumeResult:
    """uid의 진행 중 사이클을 이어가거나(무차감), 없으면 새로 열며 1회 차감한다.

    이미 quota_open_cycle이 있으면 무료/크레딧 어느 쪽도 건드리지 않고 그
    사이클을 그대로 이어간다(charged=False, reused=True) - 같은 대화 안에서
    /chat이 여러 번 불려도 첫 엔터에서만 실제로 차감되게 하는 멱등성의 핵심이다.
    없으면 lazy-grant 후 무료가 남아 있으면 무료에서, 없고 크레딧이 있으면
    크레딧에서 1을 빼고 새 사이클을 연다. 둘 다 없으면 QuotaExceeded.
    """
    user_ref = _user_doc_ref(db, uid)
    transaction = db.transaction(max_attempts=_MAX_TX_ATTEMPTS)

    @gcf.transactional
    def _run(transaction: Transaction) -> ConsumeResult:
        snapshot = user_ref.get(transaction=transaction)
        data = snapshot.to_dict() if snapshot.exists else {}

        open_cycle = data.get("quota_open_cycle")
        if open_cycle:
            return ConsumeResult(
                charged=False,
                reused=True,
                consumed_from=open_cycle.get("consumed_from"),
                cycle_id=open_cycle.get("id"),
            )

        # lazy 지급: 무료 크레딧을 아직 한 번도 받지 않았으면 여기서 채운다.
        # settings.quota_free_grant(기본 1)는 항상 0보다 크므로, 이 분기를 타면
        # 아래 free_remaining > 0 분기가 반드시 성립한다 - QuotaExceeded는 이미
        # 지급받았고(granted=True) 다 쓴 유저에서만 일어난다.
        granted = bool(data.get("quota_free_granted", False))
        free_remaining = int(data.get("quota_free_remaining", 0))
        credits = int(data.get("quota_credits", 0))
        updates: dict[str, Any] = {}
        if not granted:
            free_remaining = get_settings().quota_free_grant
            updates["quota_free_granted"] = True
            updates["quota_free_remaining"] = free_remaining

        if free_remaining > 0:
            consumed_from: ConsumedFrom = "free"
            updates["quota_free_remaining"] = free_remaining - 1
        elif credits > 0:
            consumed_from = "credit"
            updates["quota_credits"] = credits - 1
        else:
            raise QuotaExceeded(f"{uid}에게 남은 무료/유료 사이클이 없습니다.")

        cycle_id = uuid.uuid4().hex
        updates["quota_open_cycle"] = {
            "id": cycle_id,
            "opened_at": datetime.now(UTC),
            "consumed_from": consumed_from,
        }
        transaction.set(user_ref, updates, merge=True)
        return ConsumeResult(
            charged=True, reused=False, consumed_from=consumed_from, cycle_id=cycle_id
        )

    return _run(transaction)


def close_cycle(db: Client, uid: str, *, outcome: CycleOutcome) -> None:
    """진행 중 사이클을 닫는다. quota_open_cycle이 없으면 아무 것도 하지 않는다.

    outcome="refund"일 때만 consumed_from에 따라 무료/크레딧을 1 복원한다.
    "completed"(정상 발행)/"abandoned"(유저가 새 별자리로 갈아타며 버림)는
    복원 없이 사이클만 닫는다. 반복 호출해도 안전하다(두 번째 호출부터는
    quota_open_cycle이 이미 None이라 no-op) - 잡 폴링처럼 같은 잡 결과를 여러 번
    보는 호출부가 실수로 두 번 불러도 중복 환불되지 않는다.
    """
    user_ref = _user_doc_ref(db, uid)
    transaction = db.transaction(max_attempts=_MAX_TX_ATTEMPTS)

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        snapshot = user_ref.get(transaction=transaction)
        data = snapshot.to_dict() if snapshot.exists else {}
        open_cycle = data.get("quota_open_cycle")
        if not open_cycle:
            return

        updates: dict[str, Any] = {"quota_open_cycle": None}
        if outcome == "refund":
            consumed_from = open_cycle.get("consumed_from")
            if consumed_from == "free":
                updates["quota_free_remaining"] = int(data.get("quota_free_remaining", 0)) + 1
            elif consumed_from == "credit":
                updates["quota_credits"] = int(data.get("quota_credits", 0)) + 1
        transaction.set(user_ref, updates, merge=True)

    _run(transaction)


def get_quota(db: Client, uid: str) -> dict[str, Any]:
    """uid의 현재 쿼터 상태를 돌려준다(lazy-grant 포함)."""
    user_ref = _user_doc_ref(db, uid)
    transaction = db.transaction(max_attempts=_MAX_TX_ATTEMPTS)

    @gcf.transactional
    def _run(transaction: Transaction) -> dict[str, Any]:
        snapshot = user_ref.get(transaction=transaction)
        data = snapshot.to_dict() if snapshot.exists else {}

        granted = bool(data.get("quota_free_granted", False))
        free_remaining = int(data.get("quota_free_remaining", 0))
        if not granted:
            free_remaining = get_settings().quota_free_grant
            transaction.set(
                user_ref,
                {"quota_free_granted": True, "quota_free_remaining": free_remaining},
                merge=True,
            )

        return {
            "freeCreditLeft": free_remaining,
            "credits": int(data.get("quota_credits", 0)),
            "hasOpenCycle": data.get("quota_open_cycle") is not None,
        }

    return _run(transaction)


def grant_credits(db: Client, uid: str, n: int) -> None:
    """유료 크레딧을 n만큼 수동 지급한다(S0 - 운영자/스크립트 전용, 결제 연동 없음)."""
    user_ref = _user_doc_ref(db, uid)
    transaction = db.transaction(max_attempts=_MAX_TX_ATTEMPTS)

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        snapshot = user_ref.get(transaction=transaction)
        current = int(snapshot.to_dict().get("quota_credits", 0)) if snapshot.exists else 0
        transaction.set(user_ref, {"quota_credits": current + n}, merge=True)

    _run(transaction)
