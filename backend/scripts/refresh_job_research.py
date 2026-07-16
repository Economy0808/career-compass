"""직종별 리서치 캐시 월간 갱신 배치 (운영자용).

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/refresh_job_research.py            # 큐레이션 직종, 오래된 것만 갱신
    python scripts/refresh_job_research.py --force    # TTL 무시하고 전부 갱신
    python scripts/refresh_job_research.py --keyword "데이터 분석"  # 특정 직종만

웹 검색을 쓰므로 ANTHROPIC_API_KEY가 있어야 실제 리서치가 된다(없으면 Mock canned).
cron 등으로 월 1회 실행. 유저 로드맵 생성은 이 캐시를 읽기만 한다.

컴플라이언스: llm.research_job이 요약 + 출처 URL만 반환하며, 여기서도 그것만 저장한다.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_session_factory, reset_engine  # noqa: E402
from app.llm import get_llm_client  # noqa: E402
from app.models.roadmap import JobResearch  # noqa: E402
from app.services import ncs_repo  # noqa: E402

# 대학생이 흔히 지향하는 직종 키워드 (NCS 직무명과 ILIKE 매칭). 필요 시 확장.
CURATED_KEYWORDS = [
    "데이터 분석",
    "소프트웨어 개발",
    "백엔드",
    "프론트엔드",
    "인공지능",
    "마케팅",
    "회계",
    "인사",
    "기획",
    "디자인",
    "콘텐츠",
    "물류",
    "무역",
    "금융",
    "생산관리",
]


async def _refresh_one(db, llm, job, force: bool, ttl_days: int) -> str:
    existing = await db.scalar(
        select(JobResearch).where(JobResearch.ncs_job_code == job.code)
    )
    if existing and not force:
        age = datetime.now() - existing.refreshed_at.replace(tzinfo=None)
        if age < timedelta(days=ttl_days):
            return f"skip (fresh, {age.days}d) {job.name}"

    ability_units = await ncs_repo.ability_units_for(db, job.code)
    result = await llm.research_job(job.name, ability_units)

    if existing is None:
        existing = JobResearch(ncs_job_code=job.code, ncs_job_name=job.name)
        db.add(existing)
    existing.ncs_job_name = job.name
    existing.summary = result.summary
    existing.activities = result.activities
    existing.academic_societies = result.academic_societies
    existing.expert_insights = result.expert_insights
    existing.source_urls = result.source_urls
    existing.refreshed_at = datetime.now()
    await db.commit()
    return f"updated {job.name} ({len(result.source_urls)} sources)"


async def main() -> None:
    parser = argparse.ArgumentParser(description="refresh job research cache")
    parser.add_argument("--force", action="store_true", help="TTL 무시하고 전부 갱신")
    parser.add_argument("--keyword", help="특정 키워드 직종만 갱신")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.use_real_llm:
        print("경고: ANTHROPIC_API_KEY 미설정 — Mock canned 리서치로 채웁니다.")

    keywords = [args.keyword] if args.keyword else CURATED_KEYWORDS
    llm = get_llm_client()

    async with get_session_factory()() as db:
        seen: set[str] = set()
        for kw in keywords:
            jobs = await ncs_repo.shortlist_jobs(db, [kw], limit=1)
            if not jobs:
                print(f"no NCS job for '{kw}'")
                continue
            job = jobs[0]
            if job.code in seen:
                continue
            seen.add(job.code)
            msg = await _refresh_one(db, llm, job, args.force, settings.job_research_ttl_days)
            print(msg)
    await reset_engine()


if __name__ == "__main__":
    asyncio.run(main())
