"""라이브 Firestore(ourlab-0808)에 대고 벡터 검색이 실제로 그럴듯한지 눈으로 확인한다.

distance_threshold=0.45(운영 기본값) 튜닝 전에, 질의별로 실제 유저들이 거리순
으로 어떻게 나열되는지 먼저 봐야 한다 - 이 스크립트는 threshold를 아예 걸지
않고(distance_threshold=None) 상위 20명을 거리 오름차순으로 보여준다.

인증은 backfill_profile_embeddings.py와 동일(GCLOUD_ACCESS_TOKEN + --project).

Usage (backend/ 에서, .venv 활성화 후):
    export GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token)
    .venv/Scripts/python.exe scripts/probe_profile_search.py --project ourlab-0808 "빅데이터" "밴드동아리"
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.cloud import firestore  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402

from app.embedding.vertex_client import VertexEmbeddingClient  # noqa: E402
from app.firestore import user_repo  # noqa: E402

_PROBE_LIMIT = 20


def _firestore_client(project: str, token: str) -> firestore.Client:
    credentials = Credentials(token=token).with_quota_project(project)
    return firestore.Client(project=project, credentials=credentials)


async def _probe_one(db: firestore.Client, embedder: VertexEmbeddingClient, query: str) -> None:
    vector = await embedder.embed(query, kind="query")
    results = user_repo.find_nearest_users(db, vector, limit=_PROBE_LIMIT, distance_threshold=None)
    print(f"\n=== 질의: {query!r} ({len(results)}건) ===")
    print(f"{'거리':>8}  {'표시이름':<20}  관심사 태그")
    for uid, profile in results:
        distance = profile.get("vector_distance")
        distance_str = f"{distance:.4f}" if distance is not None else "?"
        print(
            f"{distance_str:>8}  {(profile.get('display_name') or uid):<20}  "
            f"{profile.get('interest_tags') or []}"
        )


async def _run(db: firestore.Client, embedder: VertexEmbeddingClient, queries: list[str]) -> None:
    for query in queries:
        await _probe_one(db, embedder, query)


def main() -> None:
    parser = argparse.ArgumentParser(description="probe profile_embedding vector search")
    parser.add_argument(
        "--project", required=True, help="Firestore/Vertex 프로젝트 id (예: ourlab-0808)"
    )
    parser.add_argument("queries", nargs="+", help="확인할 질의 목록 (예: 빅데이터 밴드동아리)")
    args = parser.parse_args()

    token = os.environ.get("GCLOUD_ACCESS_TOKEN")
    if not token:
        print(
            "ERROR: GCLOUD_ACCESS_TOKEN이 없습니다. "
            "export GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token) 후 재실행하세요.",
            file=sys.stderr,
        )
        sys.exit(1)

    db = _firestore_client(args.project, token)
    embedder = VertexEmbeddingClient(access_token=token)
    asyncio.run(_run(db, embedder, args.queries))


if __name__ == "__main__":
    main()
