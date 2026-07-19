"""정밀 로드맵 생성 오케스트레이션.

파이프라인 (요청 경로 — 웹 검색 없음):
  ⓪기존 대목표 로드 → ①의중추출 → ②NCS 직무·능력단위 매칭(내부 DB)
  → ③job_research 캐시 조회 → ④종합·개인화 마일스톤 (+브리핑, 대목표 판단)

NCS/캐시가 없으면 우아하게 축소해 항상 결과를 낸다 (초기 데이터 부재/테스트 대응).
저장은 하지 않는다 — preview 엔드포인트가 그대로 반환하고, plant가 페이로드를 저장한다.
반환: (GeneratedRoadmapSet, ncs_job_code|None) — 근거 표시용.
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import (
    CareerGoalRef,
    ChatMessage,
    GeneratedRoadmapSet,
    JobResearchResult,
    LLMClient,
    MajorGoalDecision,
    RoadmapContext,
)
from app.models.roadmap import CareerGoal, JobResearch
from app.services import ncs_repo


def build_known_profile(goals: list[CareerGoal]) -> str | None:
    """기존 대목표들의 컨텍스트를 chat 프롬프트 주입용 문자열로 합친다."""
    if not goals:
        return None
    return "\n".join(f"[{g.title}] {g.context}" for g in goals)


async def load_career_goals(db: AsyncSession, user_id: int) -> list[CareerGoal]:
    stmt = select(CareerGoal).where(CareerGoal.user_id == user_id).order_by(CareerGoal.id)
    return list((await db.scalars(stmt)).all())


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


def _clamp_set(rset: GeneratedRoadmapSet) -> None:
    """LLM 출력을 preview/plant 응답 스키마의 캡 안으로 강제한다.

    LLM 스키마는 상한이 느슨하므로(개수 무제한, 텍스트 길이 자유) 여기서 자르지
    않으면 합법적인 모델 출력이 FastAPI 응답 검증에서 500을 낸다. 순서: 개수 캡
    → 마일스톤 2개 미만 로드맵 제거 → 텍스트 길이 캡 → due_date 범위 클램프
    (plant의 [오늘-30일, 오늘+3년) 검증과 반드시 일치해야 심기가 막히지 않는다).
    """
    today = date.today()
    max_due = today + timedelta(days=365 * 3 - 1)

    rset.briefing = rset.briefing[:3000]
    rset.items = [i for i in rset.items[:20] if len(i.milestones) >= 2]
    if not rset.items:
        raise RuntimeError("synthesis produced no usable roadmap (all items < 2 milestones)")
    for item in rset.items:
        item.title = item.title[:120]
        item.milestones = item.milestones[:15]
        for m in item.milestones:
            m.title = m.title[:120]
            m.description = m.description[:300]
            m.detail = m.detail[:4000]
            if m.due_date < today:
                m.due_date = today
            elif m.due_date > max_due:
                m.due_date = max_due


async def generate_preview(
    db: AsyncSession,
    llm: LLMClient,
    user_id: int,
    goal_raw_text: str,
    messages: list[ChatMessage],
) -> tuple[GeneratedRoadmapSet, str | None]:
    # ⓪ 기존 대목표 로드 (모델이 재사용/신규를 판단할 근거)
    existing = await load_career_goals(db, user_id)
    existing_refs = [CareerGoalRef(id=g.id, title=g.title, context=g.context) for g in existing]

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
        existing_goals=existing_refs,
    )
    roadmap_set = await llm.synthesize_roadmap(context)

    _clamp_set(roadmap_set)

    # 환각/누락 방어: 소유 목록에 없는 id는 신규로 교정, major_goal 자체가 없으면 합성
    valid_ids = {g.id for g in existing}
    if roadmap_set.major_goal is None:
        roadmap_set.major_goal = MajorGoalDecision(
            existing_goal_id=None,
            title=intent.summary[:100],
            context=intent.current_level,
        )
    elif (
        roadmap_set.major_goal.existing_goal_id is not None
        and roadmap_set.major_goal.existing_goal_id not in valid_ids
    ):
        roadmap_set.major_goal.existing_goal_id = None

    return roadmap_set, ncs_job_code
