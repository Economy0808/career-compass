"""NCS 임베딩 백필 테스트 (임베딩 API 호출 없음 — monkeypatch)."""

import pytest
from sqlalchemy import delete, select

from app.db import get_session_factory
from app.etl import ncs_embed
from app.models.ncs import EMBEDDING_DIM, NcsJob, NcsLclas, NcsMclas, NcsSclas

_LCLAS = "97"
_MCLAS = "9797"
_SCLAS = "979797"
_JOBS = ["9797JOB1", "9797JOB2"]


def test_build_embedding_text() -> None:
    text = ncs_embed.build_embedding_text("정보통신", "정보기술", "정보기술개발", "빅데이터분석")
    assert text == "정보통신 > 정보기술 > 정보기술개발 > 빅데이터분석"


@pytest.fixture
async def backfill_seed():
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
                    code=code,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name=f"백필테스트직무{i}",
                    is_current=True,
                )
                for i, code in enumerate(_JOBS)
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
async def test_backfill_is_idempotent(backfill_seed, monkeypatch) -> None:
    """NULL인 행만 임베딩하므로 두 번째 실행은 API를 부르지 않는다.

    job_codes로 시드 행에만 범위를 한정한다 — 그러지 않으면 적재된 실제 NCS 직무
    전체에 테스트용 가짜 벡터를 써버린다.
    """
    calls: list[list[str]] = []

    async def fake_embed(texts: list[str], **kwargs: object) -> list[list[float]]:
        calls.append(texts)
        return [[0.1] * EMBEDDING_DIM for _ in texts]

    monkeypatch.setattr(ncs_embed, "embed_texts", fake_embed)

    async with get_session_factory()() as session:
        first = await ncs_embed.backfill_job_embeddings(session, batch_size=10, job_codes=_JOBS)
    assert first["embedded"] == len(_JOBS)
    # 계층명이 붙은 텍스트로 임베딩된다
    assert all(text.startswith("정보통신 > 정보기술 > 정보기술개발 > ") for text in calls[0])

    async with get_session_factory()() as session:
        rows = (await session.scalars(select(NcsJob).where(NcsJob.sclas_code == _SCLAS))).all()
        assert all(r.embedding is not None for r in rows)

    calls.clear()
    async with get_session_factory()() as session:
        second = await ncs_embed.backfill_job_embeddings(session, batch_size=10, job_codes=_JOBS)
    assert second["embedded"] == 0
    assert calls == []
