"""NCS 대분류 ETL 일회성 실행 스크립트.

사용법:
    cd backend
    python scripts/run_ncs_ingest.py
"""
import asyncio

import app.db as db
from app.etl.ncs_ingest import ingest_ncs_lclas


async def main() -> None:
    db._get_engine()
    assert db._session_factory is not None
    async with db._session_factory() as session:
        result = await ingest_ncs_lclas(session)
        print(f"NCS 대분류 적재 완료: {result}")


if __name__ == "__main__":
    asyncio.run(main())