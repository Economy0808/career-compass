"""NCS 직무 매칭 3단 폴백 테스트 (임베딩 → pg_trgm → ILIKE).

실제 Postgres(pgvector 이미지)를 쓰므로 cosine 정렬·trgm 유사도가 진짜로 실행된다.
임베딩 API는 절대 호출하지 않는다 — 벡터는 직접 심고 embed_texts는 monkeypatch한다.
"""

import pytest
from sqlalchemy import delete

from app.db import get_session_factory
from app.models.ncs import EMBEDDING_DIM, NcsJob, NcsLclas, NcsMclas, NcsSclas
from app.services import ncs_repo

_LCLAS = "98"
_MCLAS = "9898"
_SCLAS = "989898"
_JOB_DATA = "9898JOB1"  # 빅데이터분석 - 띄어쓰기 변형 대상
_JOB_SW = "9898JOB2"  # 소프트웨어개발 - 약어 확장 대상
_JOB_FAR = "9898JOB3"  # 무관한 직무 - 폴백/거리 검증용


def _unit_vector(axis: int) -> list[float]:
    """지정한 축만 1인 단위 벡터 (코사인 거리 검증용)."""
    vector = [0.0] * EMBEDDING_DIM
    vector[axis] = 1.0
    return vector


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
                    embedding=_unit_vector(0),
                ),
                NcsJob(
                    code=_JOB_SW,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="소프트웨어개발",
                    is_current=True,
                    embedding=_unit_vector(1),
                ),
                NcsJob(
                    code=_JOB_FAR,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="한복의장",
                    is_current=True,
                    embedding=None,
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
    """띄어쓰기 변형: '데이터 분석' -> '빅데이터분석' (ILIKE로는 못 잡던 케이스)."""
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["데이터 분석"])
    assert rows and rows[0].code == _JOB_DATA


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
async def test_embedding_orders_by_cosine_distance(ncs_match_seed, monkeypatch) -> None:
    """임베딩이 켜지면 코사인 거리가 가까운 직무가 먼저 온다 (pgvector 바인딩 검증)."""
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)

    async def fake_embed(texts: list[str], **kwargs: object) -> list[list[float]]:
        # 축 1(소프트웨어개발) 쪽으로 기울인 질의 벡터
        return [_unit_vector(1)]

    monkeypatch.setattr(ncs_repo, "embed_texts", fake_embed)
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["아무 키워드"])
    # 임베딩이 NULL인 직무(_JOB_FAR)는 후보에서 빠진다
    assert [r.code for r in rows] == [_JOB_SW, _JOB_DATA]


@pytest.mark.asyncio
async def test_embedding_failure_falls_back_to_trgm(ncs_match_seed, monkeypatch) -> None:
    """임베딩 API가 죽어도 매칭은 trgm으로 계속된다."""
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)

    async def boom(texts: list[str], **kwargs: object) -> list[list[float]]:
        raise RuntimeError("embedding service down")

    monkeypatch.setattr(ncs_repo, "embed_texts", boom)
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["데이터 분석"])
    assert rows and rows[0].code == _JOB_DATA


@pytest.mark.asyncio
async def test_defaults_to_trgm_without_key(ncs_match_seed) -> None:
    """키가 없는 기본 상태(app_env=test)에선 임베딩을 시도조차 하지 않는다."""
    assert ncs_repo._embeddings_enabled() is False
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["빅데이터분석"])
    assert rows and rows[0].code == _JOB_DATA
