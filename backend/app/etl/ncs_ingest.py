"""NCS 데이터를 API에서 가져와 DB에 적재하는 ETL 함수."""
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ncs import NcsLclas
from app.ncs_client import fetch_ncs_lclas


async def ingest_ncs_lclas(session: AsyncSession) -> dict[str, int]:
    """NCS 대분류 데이터를 API에서 가져와 DB에 UPSERT한다.

    Returns:
        통계 dict: {"fetched": N, "upserted": N}
    """
    response = await fetch_ncs_lclas()

    items = response.get("response", {}).get("body", {}).get("items", {}).get("item", [])

    # API가 결과 1건일 때 list가 아니라 dict로 줄 수 있음 -> 항상 list로 정규화
    if isinstance(items, dict):
        items = [items]

    fetched = len(items)
    upserted = 0

    for item in items:
        code = item["NCS_LCLAS_CD"]
        degree = int(item["NCS_DEGR"])
        name = item["NCS_LCLAS_CDNM"]
        is_current = item["USG_YN"] == "Y"

        stmt = pg_insert(NcsLclas).values(
            code=code,
            degree=degree,
            name=name,
            is_current=is_current,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["code", "degree"],
            set_={"name": name, "is_current": is_current},
        )
        await session.execute(stmt)
        upserted += 1

    await session.commit()
    return {"fetched": fetched, "upserted": upserted}