"""roadmap_gen 서비스 파이프라인 테스트 (Mock LLM, 네트워크 없음).

NCS 데이터와 job_research 캐시를 직접 시드해 그라운딩·축소 동작을 검증한다.
"""

import pytest
from sqlalchemy import delete

from app.db import get_session_factory
from app.llm.base import ChatMessage
from app.llm.mock_client import MockClaudeClient
from app.models.ncs import NcsAbilityUnit, NcsJob, NcsLclas, NcsMclas, NcsSclas
from app.models.roadmap import JobResearch
from app.services import roadmap_gen

JOB_CODE = "9999TEST"


@pytest.fixture
async def ncs_seed():
    """테스트용 NCS 계층(대→중→소→직무→능력단위) + 리서치 캐시를 심고 정리한다.

    NcsJob은 소분류로의 FK가 있어 상위 계층도 함께 심어야 무결성 오류가 안 난다.
    """
    async with get_session_factory()() as session:
        # NCS 클래스들엔 ORM relationship이 없어 UoW가 삽입 순서를 못 잡는다 →
        # 계층 순서대로 flush를 강제해 FK 위반을 막는다.
        session.add(NcsLclas(code="99", degree=1, name="테스트대분류", is_current=True))
        await session.flush()
        session.add(
            NcsMclas(code="9999", degree=1, lclas_code="99", name="테스트중분류", is_current=True)
        )
        await session.flush()
        session.add(
            NcsSclas(
                code="999999", degree=1, mclas_code="9999", name="테스트소분류", is_current=True
            )
        )
        await session.flush()
        session.add(
            NcsJob(
                code=JOB_CODE,
                degree=1,
                lclas_code="99",
                mclas_code="9999",
                sclas_code="999999",
                name="테스트데이터분석",
                is_current=True,
            )
        )
        await session.flush()
        session.add_all(
            [
                NcsAbilityUnit(
                    code="9999TEST000001",
                    degree=1,
                    job_code=JOB_CODE,
                    name="통계적 가설검정",
                    is_current=True,
                ),
                JobResearch(
                    ncs_job_code=JOB_CODE,
                    ncs_job_name="테스트데이터분석",
                    summary="테스트 리서치 요약",
                    activities=["교내 데이터 공모전"],
                    academic_societies=["연세 데이터사이언스 학회"],
                    expert_insights=["결과물을 공개하라"],
                    source_urls=["https://example.com/x"],
                ),
            ]
        )
        await session.commit()

    yield

    async with get_session_factory()() as s:
        await s.execute(delete(JobResearch).where(JobResearch.ncs_job_code == JOB_CODE))
        await s.execute(delete(NcsAbilityUnit).where(NcsAbilityUnit.job_code == JOB_CODE))
        await s.execute(delete(NcsJob).where(NcsJob.code == JOB_CODE))
        await s.execute(delete(NcsSclas).where(NcsSclas.code == "999999"))
        await s.execute(delete(NcsMclas).where(NcsMclas.code == "9999"))
        await s.execute(delete(NcsLclas).where(NcsLclas.code == "99"))
        await s.commit()


@pytest.mark.asyncio
async def test_pipeline_grounds_on_ncs_and_research(ncs_seed) -> None:
    llm = MockClaudeClient()
    async with get_session_factory()() as db:
        # Mock 추출은 공백으로 토큰화하므로 직무명과 매칭될 키워드가 나오게 문구 구성
        roadmap, job_code = await roadmap_gen.generate_preview(
            db, llm, 0, "테스트데이터분석 하고 싶어", []
        )
    assert job_code == JOB_CODE
    # NCS 능력단위가 마일스톤 상세 가이드(detail)에 그라운딩됨
    assert any(m.detail and "통계적 가설검정" in m.detail for m in roadmap.milestones)
    # 브리핑·대목표 판단이 항상 채워진다
    assert roadmap.briefing
    assert roadmap.major_goal is not None
    assert roadmap.major_goal.existing_goal_id is None


@pytest.mark.asyncio
async def test_pipeline_degrades_without_ncs_match() -> None:
    llm = MockClaudeClient()
    async with get_session_factory()() as db:
        roadmap, job_code = await roadmap_gen.generate_preview(
            db,
            llm,
            0,
            "존재하지않는이상한목표를이루고싶어",
            [ChatMessage(role="user", content="답")],
        )
    assert job_code is None
    assert len(roadmap.milestones) >= 5
    assert roadmap.title.endswith("로드맵")
