"""NCS 직무·능력단위 조회 (내부 DB 그라운딩).

v1은 키워드 ILIKE 매칭. pgvector 임베딩 매칭은 후속 정밀화 (데이터/스택은 이미 지원).
NCS 데이터가 아직 없으면(초기/테스트) 빈 결과를 돌려 서비스가 우아하게 축소한다.
"""
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import AbilityUnitRef
from app.models.ncs import NcsAbilityUnit, NcsJob


async def shortlist_jobs(
    db: AsyncSession, keywords: list[str], limit: int = 3
) -> list[NcsJob]:
    """키워드로 NCS 직무 후보를 ILIKE 매칭한다 (현재 버전 우선)."""
    terms = [k.strip() for k in keywords if k and k.strip()]
    if not terms:
        return []
    conditions = [NcsJob.name.ilike(f"%{t}%") for t in terms]
    stmt = (
        select(NcsJob)
        .where(NcsJob.is_current.is_(True))
        .where(or_(*conditions))
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    if rows:
        return rows
    # 현재 버전에서 못 찾으면 전체에서 재시도 (데이터 상태에 관대하게)
    stmt = select(NcsJob).where(or_(*conditions)).limit(limit)
    return list((await db.scalars(stmt)).all())


async def ability_units_for(
    db: AsyncSession, job_code: str, limit: int = 20
) -> list[AbilityUnitRef]:
    """직무 코드에 속한 능력단위를 가져온다.

    같은 능력단위가 개정판(degree)마다 행으로 존재하므로 현재판 우선 + 이름 중복
    제거로 LLM 그라운딩 슬롯이 낭비되지 않게 한다.
    """
    stmt = (
        select(NcsAbilityUnit)
        .where(NcsAbilityUnit.job_code == job_code)
        .order_by(NcsAbilityUnit.is_current.desc(), NcsAbilityUnit.degree.desc())
    )
    rows = (await db.scalars(stmt)).all()
    seen: set[str] = set()
    units: list[AbilityUnitRef] = []
    for u in rows:
        if u.name in seen:
            continue
        seen.add(u.name)
        units.append(AbilityUnitRef(code=u.code, name=u.name))
        if len(units) >= limit:
            break
    return units
