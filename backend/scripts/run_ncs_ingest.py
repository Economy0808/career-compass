"""NCS 기준정보 ETL 일회성 실행 스크립트.

사용법:
    cd backend
    python scripts/run_ncs_ingest.py                     # 001~004 실행
    python scripts/run_ncs_ingest.py --include-ability-unit  # 001~005 실행 (시간 많이 걸림)
"""
import argparse
import asyncio

import app.db as db
from app.etl.ncs_ingest import (
    ingest_ncs_ability_unit,
    ingest_ncs_job,
    ingest_ncs_lclas,
    ingest_ncs_mclas,
    ingest_ncs_sclas,
)


async def main(include_ability_unit: bool) -> None:
    db._get_engine()
    assert db._session_factory is not None
    async with db._session_factory() as session:
        steps = [
            ("대분류 (NCS001)", ingest_ncs_lclas(session)),
            ("중분류 (NCS002)", ingest_ncs_mclas(session)),
            ("소분류 (NCS003)", ingest_ncs_sclas(session)),
            ("세분류 (NCS004)", ingest_ncs_job(session)),
        ]
        if include_ability_unit:
            steps.append(("능력단위 (NCS005)", ingest_ncs_ability_unit(session)))

        for label, coro in steps:
            result = await coro
            print(f"NCS {label} 적재 완료: {result}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NCS 기준정보 ETL 실행")
    parser.add_argument(
        "--include-ability-unit",
        action="store_true",
        help="NCS005 능력단위 적재 포함 (기본값: 제외, 실행 시간 매우 길어짐)",
    )
    args = parser.parse_args()
    asyncio.run(main(include_ability_unit=args.include_ability_unit))
