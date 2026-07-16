"""정밀 로드맵 생성 오케스트레이션.

파이프라인 (요청 경로 — 웹 검색 없음):
  ①의중추출 → ②NCS 직무·능력단위 매칭(내부 DB) → ③job_research 캐시 조회
  → ④종합·개인화 마일스톤

NCS/캐시가 없으면 우아하게 축소해 항상 결과를 낸다 (초기 데이터 부재/테스트 대응).
반환: (GeneratedRoadmap, ncs_job_code|None) — 근거 표시용.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import (
    ChatMessage,
    GeneratedRoadmap,
    JobResearchResult,
    LLMClient,
    RoadmapContext,
)
from app.models.roadmap import JobResearch
from app.services import ncs_repo


async def _load_research(db: AsyncSession, job_code: str) -> JobResearchResult | None:
    row = await db.scalar(select(JobResearch).where(JobResearch.ncs_job_code == job_code))
    if row is None:
        return None
    return JobResearchResult(
        summary=row.summary,
        activities=list(row.activities or []),
        academic_societies=list(row.academic_societies or []),
        expert_insights=list(row.expert_insights or []),
        source_urls=list(row.source_urls or []),
    )


async def generate_roadmap(
    db: AsyncSession,
    llm: LLMClient,
    goal_raw_text: str,
    messages: list[ChatMessage],
) -> tuple[GeneratedRoadmap, str | None]:
    # ① 의중 추출
    intent = await llm.extract_intent(goal_raw_text, messages)

    # ② NCS 매칭 (없으면 그냥 넘어감)
    ncs_job_name: str | None = None
    ncs_job_code: str | None = None
    ability_units = []
    jobs = await ncs_repo.shortlist_jobs(db, intent.direction_keywords)
    if jobs:
        best = jobs[0]
        ncs_job_name, ncs_job_code = best.name, best.code
        ability_units = await ncs_repo.ability_units_for(db, best.code)

    # ③ 리서치 캐시 조회 (배치가 채워둔 것만; 요청 경로에서 웹검색 안 함)
    research = await _load_research(db, ncs_job_code) if ncs_job_code else None

    # ④ 종합
    context = RoadmapContext(
        intent=intent,
        ncs_job_name=ncs_job_name,
        ability_units=ability_units,
        research=research,
    )
    roadmap = await llm.synthesize_roadmap(context)
    return roadmap, ncs_job_code
