"""회수용(Bin) 추천 백엔드 작업을 비동기로 처리하는 인메모리 잡 매니저.

의도적 복제: preview_jobs.py와 동일한 구조이나 소유자 타입이 uid:str(Firebase UID)
이고 결과 타입이 dict[str, Any] 직렬화된 camelCase 페이로드다. 전역 레지스트리
_jobs를 미리뷰와 분리하는 이유는 500개 상한의 최고 축출 로직이 서로 다른 도메인
간에 교차 오염되면 안 되기 때문이다.

인메모리라 단일 워커 프로토타입 전용 — 서버 재시작 시 진행 중 잡은 유실된다.
멀티 워커 배포 시 Redis/DB로 이전(레이트리밋과 동일한 과제).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

logger = logging.getLogger(__name__)

JobStatus = Literal["pending", "running", "done", "error"]

_TTL_SECONDS = 30 * 60  # 완료/실패 잡을 30분간 보관 후 청소
_MAX_JOBS = 500  # 남용/누수 방지 상한
_ERROR_DETAIL = "회수 추천을 받지 못했어요. 잠시 후 다시 시도해주세요."


@dataclass
class BinJob:
    """회수 추천 백엔드 작업 상태."""

    id: str
    uid: str
    status: JobStatus = "pending"
    result: dict[str, Any] | None = None
    detail: str | None = None
    created_at: float = field(default_factory=time.monotonic)


_jobs: dict[str, BinJob] = {}
# 태스크 참조를 붙잡아 두지 않으면 GC가 실행 중 태스크를 취소할 수 있다.
_tasks: set[asyncio.Task] = set()


def _prune() -> None:
    """완료/실패 상태의 오래된 잡을 TTL에 따라 정리한다."""
    now = time.monotonic()
    stale = [
        jid
        for jid, job in _jobs.items()
        if job.status in ("done", "error") and now - job.created_at > _TTL_SECONDS
    ]
    for jid in stale:
        _jobs.pop(jid, None)


def create_job(uid: str) -> BinJob:
    """주어진 UID 소유로 새 잡을 생성한다. 상한 초과 시 가장 오래된 잡을 축출한다."""
    _prune()
    if len(_jobs) >= _MAX_JOBS:
        # 상한 초과 시 가장 오래된 잡부터 밀어낸다.
        oldest = min(_jobs.values(), key=lambda j: j.created_at)
        _jobs.pop(oldest.id, None)
    job = BinJob(id=uuid.uuid4().hex, uid=uid)
    _jobs[job.id] = job
    return job


def get_job(job_id: str, uid: str) -> BinJob | None:
    """작성자 본인(uid)의 잡만 반환한다 (타인 잡 열람 방지)."""
    job = _jobs.get(job_id)
    if job is None or job.uid != uid:
        return None
    return job


def launch(job: BinJob, work: Callable[[], Awaitable[dict[str, Any]]]) -> None:
    """work를 백그라운드 태스크로 실행하며 잡 상태를 갱신한다."""

    async def _runner() -> None:
        job.status = "running"
        try:
            job.result = await work()
            job.status = "done"
        except Exception:
            logger.exception("bin job %s failed", job.id)
            job.status = "error"
            job.detail = _ERROR_DETAIL

    task = asyncio.create_task(_runner())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def reset_jobs() -> None:
    """테스트 격리를 위해 모든 잡과 태스크를 정리한다."""
    _jobs.clear()
    for task in _tasks:
        task.cancel()
    _tasks.clear()
