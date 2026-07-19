"""NCS 직무 임베딩 백필.

직무명만으로는 의미가 얇아서("빅데이터분석") 상위 계층명을 붙여 문맥을 준다.
embedding이 NULL인 행만 처리하므로 몇 번을 다시 돌려도 안전하다.

알려진 한계: ncs_ingest의 UPSERT는 name/is_current만 갱신하므로 직무명이 개정되면
임베딩이 낡은 채로 남는다. NCS 직무명은 사실상 바뀌지 않아 지금은 감수한다.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.embeddings import embed_texts
from app.models.ncs import NcsJob, NcsLclas, NcsMclas, NcsSclas

logger = logging.getLogger(__name__)


def build_embedding_text(lclas: str, mclas: str, sclas: str, job: str) -> str:
    """계층 경로를 붙인 임베딩 입력 텍스트."""
    return f"{lclas} > {mclas} > {sclas} > {job}"


async def backfill_job_embeddings(
    session: AsyncSession,
    *,
    batch_size: int = 100,
    job_codes: list[str] | None = None,
) -> dict[str, int]:
    """embedding이 비어 있는 직무를 배치로 임베딩한다 (멱등).

    job_codes를 주면 그 직무들만 처리한다. 직무명이 개정돼 임베딩을 다시 만들
    때(해당 행의 embedding을 NULL로 되돌린 뒤)와 테스트에서 범위를 좁힐 때 쓴다.
    """
    embedded = 0
    while True:
        stmt = (
            select(NcsJob, NcsLclas.name, NcsMclas.name, NcsSclas.name)
            .join(
                NcsSclas,
                (NcsSclas.code == NcsJob.sclas_code) & (NcsSclas.degree == NcsJob.degree),
            )
            .join(
                NcsMclas,
                (NcsMclas.code == NcsJob.mclas_code) & (NcsMclas.degree == NcsJob.degree),
            )
            .join(
                NcsLclas,
                (NcsLclas.code == NcsJob.lclas_code) & (NcsLclas.degree == NcsJob.degree),
            )
            .where(NcsJob.embedding.is_(None))
        )
        if job_codes is not None:
            stmt = stmt.where(NcsJob.code.in_(job_codes))
        rows = (await session.execute(stmt.limit(batch_size))).all()
        if not rows:
            break

        texts = [
            build_embedding_text(lclas_name, mclas_name, sclas_name, job.name)
            for job, lclas_name, mclas_name, sclas_name in rows
        ]
        vectors = await embed_texts(texts)
        for (job, *_), vector in zip(rows, vectors, strict=True):
            job.embedding = vector
        await session.commit()

        embedded += len(rows)
        logger.info("NCS 직무 임베딩 %d건 완료 (누적 %d)", len(rows), embedded)

    return {"embedded": embedded}
