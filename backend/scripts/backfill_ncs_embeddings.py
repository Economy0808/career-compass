"""NCS 직무 임베딩 백필 스크립트 (멱등, 재실행 안전).

사용법:
    cd backend
    python scripts/backfill_ncs_embeddings.py

OPENAI_API_KEY가 .env에 있어야 한다. 키가 없으면 아무 것도 하지 않고 종료하며,
그동안 직무 매칭은 pg_trgm 경로로 정상 동작한다. NCS를 재적재해 직무가 늘어난
뒤에도 다시 돌리면 새 행만 임베딩된다.
"""

import argparse
import asyncio
import logging
import sys

import app.db as db
from app.config import get_settings
from app.etl.ncs_embed import backfill_job_embeddings


async def main(batch_size: int) -> None:
    db._get_engine()
    assert db._session_factory is not None
    async with db._session_factory() as session:
        result = await backfill_job_embeddings(session, batch_size=batch_size)
    print(f"NCS 직무 임베딩 백필 완료: {result}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NCS 직무 임베딩 백필")
    parser.add_argument("--batch-size", type=int, default=100, help="1회 임베딩 요청당 직무 수")
    args = parser.parse_args()

    if not get_settings().use_real_embeddings:
        print(
            "OPENAI_API_KEY가 없거나 플레이스홀더입니다. backend/.env에 실제 키를 넣고 "
            "다시 실행하세요. (키 없이도 직무 매칭은 pg_trgm으로 동작합니다.)"
        )
        sys.exit(1)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(main(batch_size=args.batch_size))
