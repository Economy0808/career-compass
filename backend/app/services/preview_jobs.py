"""저장 전 로드맵 프리뷰를 백그라운드에서 생성하는 인메모리 잡 매니저.

웹서치가 낀 종합은 2분 이상 걸려 동기 요청으로는 브라우저/프록시 타임아웃과
스트림 연결 끊김에 취약하다. POST /preview는 잡을 만들어 즉시 job_id를 돌려주고,
실제 생성은 asyncio 백그라운드 태스크가 수행한다. 프론트는 GET /preview/{job_id}로
폴링한다.

인메모리라 단일 워커 프로토타입 전용 — 서버 재시작 시 진행 중 잡은 유실된다
(프론트가 재시도 안내). 멀티 워커 배포 시 Redis/DB로 이전(레이트리밋과 동일한 과제).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from app.schemas.roadmap import RoadmapPreviewOut

logger = logging.getLogger(__name__)

JobStatus = Literal["pending", "running", "done", "error"]

_TTL_SECONDS = 30 * 60  # 완료/실패 잡을 30분간 보관 후 청소
_MAX_JOBS = 500  # 남용/누수 방지 상한
_ERROR_DETAIL = "AI 응답을 받지 못했어요. 잠시 후 다시 시도해주세요."


@dataclass
class PreviewJob:
    id: str
    user_id: int
    status: JobStatus = "pending"
    result: RoadmapPreviewOut | None = None
    detail: str | None = None
    created_at: float = field(default_factory=time.monotonic)


_jobs: dict[str, PreviewJob] = {}
# 태스크 참조를 붙잡아 두지 않으면 GC가 실행 중 태스크를 취소할 수 있다.
_tasks: set[asyncio.Task] = set()


def _prune() -> None:
    now = time.monotonic()
    stale = [
        jid
        for jid, job in _jobs.items()
        if job.status in ("done", "error") and now - job.created_at > _TTL_SECONDS
    ]
    for jid in stale:
        _jobs.pop(jid, None)


def create_job(user_id: int) -> PreviewJob:
    _prune()
    if len(_jobs) >= _MAX_JOBS:
        # 상한 초과 시 가장 오래된 잡부터 밀어낸다.
        oldest = min(_jobs.values(), key=lambda j: j.created_at)
        _jobs.pop(oldest.id, None)
    job = PreviewJob(id=uuid.uuid4().hex, user_id=user_id)
    _jobs[job.id] = job
    return job


def get_job(job_id: str, user_id: int) -> PreviewJob | None:
    """작성자 본인의 잡만 반환한다 (타인 잡 열람 방지)."""
    job = _jobs.get(job_id)
    if job is None or job.user_id != user_id:
        return None
    return job


def launch(job: PreviewJob, work: Callable[[], Awaitable[RoadmapPreviewOut]]) -> None:
    """work를 백그라운드 태스크로 실행하며 잡 상태를 갱신한다."""

    async def _runner() -> None:
        job.status = "running"
        try:
            job.result = await work()
            job.status = "done"
        except Exception:
            logger.exception("preview job %s failed", job.id)
            job.status = "error"
            job.detail = _ERROR_DETAIL

    task = asyncio.create_task(_runner())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
