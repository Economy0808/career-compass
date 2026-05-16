"""NCS 데이터를 API에서 가져와 DB에 적재하는 ETL 함수."""

import asyncio
import json

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.ncs import NcsAbilityUnit, NcsJob, NcsLclas, NcsMclas, NcsSclas
from app.ncs_client import (
    NCS_BASE_URL,
    fetch_ncs_ability_unit,
    fetch_ncs_job,
    fetch_ncs_lclas,
    fetch_ncs_mclas,
    fetch_ncs_sclas,
)

# 오퍼레이션별 추정 필드명 — probe에서 실제 응답과 대조한다
_EXPECTED_FIELDS: dict[str, list[str]] = {
    "NCS002": ["NCS_MCLAS_CD", "NCS_MCLAS_CDNM", "NCS_LCLAS_CD", "NCS_DEGR", "USG_YN"],
    "NCS003": ["NCS_SCLAS_CD", "NCS_SCLAS_CDNM", "NCS_MCLAS_CD", "NCS_DEGR", "USG_YN"],
    "NCS004": ["NCS_CD", "NCS_CDNM", "NCS_SCLAS_CD", "NCS_DEGR", "USG_YN"],
    "NCS005": ["NCS_ABLTY_UNIT_CD", "NCS_ABLTY_UNIT_CDNM", "NCS_CD", "NCS_DEGR", "USG_YN"],
}


async def _probe_raw(operation: str, extra_params: dict) -> dict:
    """API에 numOfRows=1로 1건만 호출해 raw JSON 응답을 반환한다 (필드 검증용)."""
    settings = get_settings()
    params = {
        "serviceKey": settings.data_go_kr_api_key,
        "_type": "json",
        "numOfRows": "1",
        "pageNo": "1",
        **extra_params,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{NCS_BASE_URL}/{operation}", params=params)
        resp.raise_for_status()
        return resp.json()


def _assert_fields(raw: dict, expected: list[str], operation: str) -> None:
    """raw 응답에서 첫 번째 item을 꺼내 추정 필드명을 검증한다.

    항상 raw JSON을 출력한다. 필드가 없으면 RuntimeError로 중단한다.
    """
    body = raw.get("response", {}).get("body", {})
    items = body.get("items", {}).get("item", [])
    if isinstance(items, dict):
        items = [items]

    print(f"\n[{operation}] probe 응답 (raw JSON, 1건):")
    print(json.dumps(raw, ensure_ascii=False, indent=2))

    if not items:
        raise RuntimeError(
            f"[{operation}] probe 응답에 item이 없습니다. totalCount={body.get('totalCount')}"
        )

    first = items[0]
    missing = [f for f in expected if f not in first]
    if missing:
        raise RuntimeError(
            f"[{operation}] 필드명 불일치 — 누락: {missing} | 실제 키: {list(first.keys())}"
        )
    print(f"[{operation}] 필드 검증 통과: {expected}")


async def ingest_ncs_lclas(session: AsyncSession) -> dict[str, int]:
    """NCS 대분류 데이터를 API에서 가져와 DB에 UPSERT한다."""
    items = await fetch_ncs_lclas()

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

    await session.commit()
    return {"fetched": len(items), "upserted": len(items)}


async def ingest_ncs_mclas(session: AsyncSession) -> dict[str, int]:
    """NCS 중분류 데이터를 API에서 가져와 DB에 UPSERT한다."""
    result = await session.execute(
        select(NcsLclas.code).where(NcsLclas.is_current.is_(True)).distinct()
    )
    lclas_codes = [r[0] for r in result.all()]
    if not lclas_codes:
        return {"fetched": 0, "upserted": 0}

    raw = await _probe_raw("NCS002", {"NCS_LCLAS_CD": lclas_codes[0]})
    _assert_fields(raw, _EXPECTED_FIELDS["NCS002"], "NCS002")

    total_fetched = total_upserted = 0
    for lclas_code in lclas_codes:
        items = await fetch_ncs_mclas(lclas_code)
        for item in items:
            code = item["NCS_MCLAS_CD"]
            degree = int(item["NCS_DEGR"])
            name = item["NCS_MCLAS_CDNM"]
            is_current = item["USG_YN"] == "Y"
            stmt = pg_insert(NcsMclas).values(
                code=code,
                degree=degree,
                lclas_code=item["NCS_LCLAS_CD"],
                name=name,
                is_current=is_current,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["code", "degree"],
                set_={"name": name, "is_current": is_current},
            )
            await session.execute(stmt)
            total_upserted += 1
        total_fetched += len(items)
        await asyncio.sleep(0.1)

    await session.commit()
    return {"fetched": total_fetched, "upserted": total_upserted}


async def ingest_ncs_sclas(session: AsyncSession) -> dict[str, int]:
    """NCS 소분류 데이터를 API에서 가져와 DB에 UPSERT한다."""
    result = await session.execute(
        select(NcsMclas.lclas_code, NcsMclas.code).where(NcsMclas.is_current.is_(True)).distinct()
    )
    mclas_rows = result.all()
    if not mclas_rows:
        return {"fetched": 0, "upserted": 0}

    first_lclas, first_mclas = mclas_rows[0]
    raw = await _probe_raw("NCS003", {"NCS_LCLAS_CD": first_lclas, "NCS_MCLAS_CD": first_mclas})
    _assert_fields(raw, _EXPECTED_FIELDS["NCS003"], "NCS003")

    total_fetched = total_upserted = 0
    for lclas_code, mclas_code in mclas_rows:
        items = await fetch_ncs_sclas(lclas_code, mclas_code)
        for item in items:
            code = item["NCS_SCLAS_CD"]
            degree = int(item["NCS_DEGR"])
            name = item["NCS_SCLAS_CDNM"]
            is_current = item["USG_YN"] == "Y"
            stmt = pg_insert(NcsSclas).values(
                code=code,
                degree=degree,
                mclas_code=item["NCS_MCLAS_CD"],
                name=name,
                is_current=is_current,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["code", "degree"],
                set_={"name": name, "is_current": is_current},
            )
            await session.execute(stmt)
            total_upserted += 1
        total_fetched += len(items)
        await asyncio.sleep(0.1)

    await session.commit()
    return {"fetched": total_fetched, "upserted": total_upserted}


async def ingest_ncs_job(session: AsyncSession) -> dict[str, int]:
    """NCS 세분류(직무) 데이터를 API에서 가져와 DB에 UPSERT한다."""
    result = await session.execute(
        select(NcsSclas.code).where(NcsSclas.is_current.is_(True)).distinct()
    )
    sclas_codes = [r[0] for r in result.all()]
    if not sclas_codes:
        return {"fetched": 0, "upserted": 0}

    raw = await _probe_raw("NCS004", {"NCS_SCLAS_CD": sclas_codes[0]})
    _assert_fields(raw, _EXPECTED_FIELDS["NCS004"], "NCS004")

    total_fetched = total_upserted = 0
    for sclas_code in sclas_codes:
        items = await fetch_ncs_job(sclas_code)
        for item in items:
            code = item["NCS_CD"]
            degree = int(item["NCS_DEGR"])
            name = item["NCS_CDNM"]
            is_current = item["USG_YN"] == "Y"
            stmt = pg_insert(NcsJob).values(
                code=code,
                degree=degree,
                sclas_code=item["NCS_SCLAS_CD"],
                name=name,
                is_current=is_current,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["code", "degree"],
                set_={"name": name, "is_current": is_current},
            )
            await session.execute(stmt)
            total_upserted += 1
        total_fetched += len(items)
        await asyncio.sleep(0.1)

    await session.commit()
    return {"fetched": total_fetched, "upserted": total_upserted}


async def ingest_ncs_ability_unit(session: AsyncSession) -> dict[str, int]:
    """NCS 능력단위 데이터를 API에서 가져와 DB에 UPSERT한다."""
    result = await session.execute(
        select(NcsJob.code).where(NcsJob.is_current.is_(True)).distinct()
    )
    job_codes = [r[0] for r in result.all()]
    if not job_codes:
        return {"fetched": 0, "upserted": 0}

    raw = await _probe_raw("NCS005", {"NCS_CD": job_codes[0]})
    _assert_fields(raw, _EXPECTED_FIELDS["NCS005"], "NCS005")

    total_fetched = total_upserted = 0
    for job_code in job_codes:
        items = await fetch_ncs_ability_unit(job_code)
        for item in items:
            code = item["NCS_ABLTY_UNIT_CD"]
            degree = int(item["NCS_DEGR"])
            name = item["NCS_ABLTY_UNIT_CDNM"]
            is_current = item["USG_YN"] == "Y"
            stmt = pg_insert(NcsAbilityUnit).values(
                code=code,
                degree=degree,
                job_code=item["NCS_CD"],
                name=name,
                is_current=is_current,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["code", "degree"],
                set_={"name": name, "is_current": is_current},
            )
            await session.execute(stmt)
            total_upserted += 1
        total_fetched += len(items)
        await asyncio.sleep(0.1)

    await session.commit()
    return {"fetched": total_fetched, "upserted": total_upserted}
