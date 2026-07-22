"""NCS 직무 매칭 테스트.

주 경로는 유저가 고른 대분류 안에서 LLM이 판정하는 것이고, 분야를 안 골랐거나
판정이 실패하면 pg_trgm → ILIKE로 축소한다. LLM은 MockClaudeClient(결정론적
부분일치)로 대체하므로 네트워크 호출은 없다.

**주의: 이 테스트는 실적재된 NCS(현행 직무 1,094개)와 같은 테이블을 공유한다.**
그래서 시드 행이 항상 1등이라고 단정하면 안 된다. 실데이터에 같은 이름의 직무가
있으면(예: "빅데이터분석") trgm 유사도가 동점이라 순위가 뒤집힌다 — 실제로 임베딩
백필이 행을 UPDATE하자 물리적 순서가 바뀌며 깨졌다. 검증 대상이 "어느 행"이 아니라
"어느 직무명"이므로, 동점이 가능한 곳은 code 대신 name으로 단언한다.
"""

import pytest
from sqlalchemy import delete, func, select

from app.db import get_session_factory
from app.llm.base import CareerIntent
from app.llm.mock_client import MockClaudeClient
from app.models.ncs import NcsJob, NcsLclas, NcsMclas, NcsSclas
from app.services import ncs_repo, roadmap_gen

_LCLAS = "98"
_MCLAS = "9898"
_SCLAS = "989898"
_JOB_DATA = "9898JOB1"  # 빅데이터분석 - 띄어쓰기 변형 대상
_JOB_SW = "9898JOB2"  # 소프트웨어개발 - 약어 확장 대상
_JOB_FAR = "9898JOB3"  # 무관한 직무 - 폴백/거리 검증용


@pytest.fixture
async def ncs_match_seed():
    """직무 매칭용 NCS 계층을 심고 정리한다 (FK 때문에 상위 계층 필수)."""
    async with get_session_factory()() as session:
        session.add(NcsLclas(code=_LCLAS, degree=1, name="정보통신", is_current=True))
        await session.flush()
        session.add(
            NcsMclas(code=_MCLAS, degree=1, lclas_code=_LCLAS, name="정보기술", is_current=True)
        )
        await session.flush()
        session.add(
            NcsSclas(code=_SCLAS, degree=1, mclas_code=_MCLAS, name="정보기술개발", is_current=True)
        )
        await session.flush()
        session.add_all(
            [
                NcsJob(
                    code=_JOB_DATA,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="빅데이터분석",
                    is_current=True,
                ),
                NcsJob(
                    code=_JOB_SW,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="소프트웨어개발",
                    is_current=True,
                ),
                NcsJob(
                    code=_JOB_FAR,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="한복의장",
                    is_current=True,
                ),
            ]
        )
        await session.commit()

    yield

    async with get_session_factory()() as s:
        await s.execute(delete(NcsJob).where(NcsJob.sclas_code == _SCLAS))
        await s.execute(delete(NcsSclas).where(NcsSclas.code == _SCLAS))
        await s.execute(delete(NcsMclas).where(NcsMclas.code == _MCLAS))
        await s.execute(delete(NcsLclas).where(NcsLclas.code == _LCLAS))
        await s.commit()


@pytest.mark.asyncio
async def test_trgm_matches_across_spacing(ncs_match_seed) -> None:
    """띄어쓰기 변형: '데이터 분석' -> '빅데이터분석' (ILIKE로는 못 잡던 케이스).

    실데이터에도 같은 이름의 직무가 있어 어느 행이 1등일지는 동점이다 — 직무명으로 본다.
    """
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["데이터 분석"])
    assert rows and rows[0].name == "빅데이터분석"


@pytest.mark.asyncio
async def test_trgm_expands_synonyms(ncs_match_seed) -> None:
    """약어 확장: 'SW 개발' -> '소프트웨어개발'."""
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["SW 개발"])
    assert rows and rows[0].code == _JOB_SW


@pytest.mark.asyncio
async def test_gibberish_keyword_matches_nothing(ncs_match_seed) -> None:
    """의미 없는 문자열은 trgm 임계값에도, ILIKE에도 걸리지 않는다.

    (직무명과 글자를 공유하는 키워드는 적재된 실제 NCS 직무에 느슨하게 매칭될 수
    있다 — 임계값의 목적은 완전한 소음을 거르는 것이지 정확도 보장이 아니다.)
    """
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["쿽쿽쿽뷁뷁뷁"])
    assert rows == []


@pytest.mark.asyncio
async def test_empty_keywords_short_circuit() -> None:
    async with get_session_factory()() as db:
        assert await ncs_repo.shortlist_jobs(db, ["", "   "]) == []


@pytest.mark.asyncio
async def test_synonym_targets_exist_in_ncs() -> None:
    """동의어 대상은 전부 실제 NCS 직무명에 존재해야 한다.

    NCS에 없는 말로 보내는 매핑은 조용히 아무것도 안 한다 — 후보만 늘리고 매칭은
    0건이라 눈에 띄지 않는다. 실제로 HR->인적자원, UX->사용자경험, UI->사용자
    인터페이스, 엔지니어->공학 네 개가 그 상태로 방치돼 있었다.
    """
    async with get_session_factory()() as db:
        if not await db.scalar(select(func.count()).select_from(NcsJob)):
            pytest.skip("NCS 데이터가 적재되지 않은 환경")
        dead = [
            f"{src} -> {dst}"
            for src, dst in ncs_repo._SYNONYMS.items()
            if await db.scalar(
                select(NcsJob.name)
                .where(NcsJob.is_current.is_(True), NcsJob.name.ilike(f"%{dst}%"))
                .limit(1)
            )
            is None
        ]
    assert not dead, f"NCS 직무명에 존재하지 않는 동의어 대상: {dead}"


@pytest.mark.asyncio
async def test_falls_back_to_string_matching_without_category(ncs_match_seed) -> None:
    """분야를 안 고르면 문자열 매칭으로 축소한다 (LLM 판정 없이도 결과가 나온다)."""
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["빅데이터분석"])
    assert rows and rows[0].name == "빅데이터분석"


# ---------------- 분류 기반 LLM 판정 (주 경로) ----------------


@pytest.mark.asyncio
async def test_lists_categories_with_job_counts(ncs_match_seed) -> None:
    """대분류 목록에는 직무가 있는 분류만, 직무 수와 함께 나온다."""
    async with get_session_factory()() as db:
        options = await ncs_repo.list_lclas(db)
    assert options
    assert all(o.job_count > 0 for o in options)
    assert options == sorted(options, key=lambda o: -o.job_count)[: len(options)]
    seeded = next(o for o in options if o.code == _LCLAS)
    assert seeded.name == "정보통신" and seeded.job_count == 3
    # 추천 분야 플래그가 큐레이션 목록과 일치해야 한다 (프론트가 이걸로 접고 편다)
    featured = {o.code for o in options if o.featured}
    assert featured == set(ncs_repo.FEATURED_LCLAS_CODES) & {o.code for o in options}


@pytest.mark.asyncio
async def test_jobs_in_lclas_merges_multiple_categories(ncs_match_seed) -> None:
    """복수 선택은 후보를 합치고, 중복·빈 코드는 정리하며 상한을 넘지 않는다."""
    async with get_session_factory()() as db:
        merged = await ncs_repo.jobs_in_lclas(db, [_LCLAS, "20", _LCLAS, ""])
        only_seed = await ncs_repo.jobs_in_lclas(db, [_LCLAS])
        assert await ncs_repo.jobs_in_lclas(db, []) == []
    codes = [c.code for c in merged]
    assert len(codes) == len(set(codes))  # 중복 대분류가 후보를 부풀리지 않는다
    assert len(merged) > len(only_seed)  # 실제 정보통신(20) 직무가 합쳐졌다


@pytest.mark.asyncio
async def test_jobs_in_lclas_carries_sclas_context(ncs_match_seed) -> None:
    """판정 후보에는 소분류명이 함께 실린다 (동명 직무 구분용)."""
    async with get_session_factory()() as db:
        candidates = await ncs_repo.jobs_in_lclas(db, [_LCLAS])
    assert {c.code for c in candidates} == {_JOB_DATA, _JOB_SW, _JOB_FAR}
    assert all(c.sclas_name == "정보기술개발" for c in candidates)


@pytest.mark.asyncio
async def test_get_job_validates_code(ncs_match_seed) -> None:
    """LLM이 낸 코드는 DB로 검증한다 — 없는 코드는 None."""
    async with get_session_factory()() as db:
        assert (await ncs_repo.get_job(db, _JOB_DATA)).name == "빅데이터분석"
        assert await ncs_repo.get_job(db, "NOPE0000") is None


@pytest.mark.asyncio
async def test_match_uses_llm_choice_within_category(ncs_match_seed) -> None:
    """분야를 고르면 LLM이 그 안에서 고른 직무가 채택된다."""
    intent = CareerIntent(summary="", direction_keywords=["소프트웨어개발"], current_level="")
    async with get_session_factory()() as db:
        job = await roadmap_gen._match_ncs_job(db, MockClaudeClient(), intent, [_LCLAS])
    assert job is not None and job.code == _JOB_SW


@pytest.mark.asyncio
async def test_match_falls_back_when_llm_finds_nothing(ncs_match_seed) -> None:
    """LLM이 '맞는 게 없다'고 하면 문자열 매칭으로 내려간다 (빈손 판정을 존중)."""
    intent = CareerIntent(summary="", direction_keywords=["데이터 분석"], current_level="")

    class NoMatch(MockClaudeClient):
        async def select_ncs_job(self, intent, candidates):
            return None

    async with get_session_factory()() as db:
        job = await roadmap_gen._match_ncs_job(db, NoMatch(), intent, [_LCLAS])
    assert job is not None and job.name == "빅데이터분석"  # trgm 폴백이 잡음


@pytest.mark.asyncio
async def test_match_rejects_hallucinated_job_code(ncs_match_seed) -> None:
    """후보에 없는 코드를 지어내면 버리고 폴백한다."""
    intent = CareerIntent(summary="", direction_keywords=["데이터 분석"], current_level="")

    class Hallucinating(MockClaudeClient):
        async def select_ncs_job(self, intent, candidates):
            return "9999FAKE"

    async with get_session_factory()() as db:
        job = await roadmap_gen._match_ncs_job(db, Hallucinating(), intent, [_LCLAS])
    assert job is not None and job.name == "빅데이터분석"


@pytest.mark.asyncio
async def test_match_survives_llm_failure(ncs_match_seed) -> None:
    """판정 호출이 터져도 로드맵 생성을 막지 않는다."""
    intent = CareerIntent(summary="", direction_keywords=["데이터 분석"], current_level="")

    class Boom(MockClaudeClient):
        async def select_ncs_job(self, intent, candidates):
            raise RuntimeError("LLM down")

    async with get_session_factory()() as db:
        job = await roadmap_gen._match_ncs_job(db, Boom(), intent, [_LCLAS])
    assert job is not None and job.name == "빅데이터분석"
