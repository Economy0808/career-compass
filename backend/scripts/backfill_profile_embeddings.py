"""라이브 Firestore(ourlab-0808) 전체 유저의 profile_embedding을 재계산한다.

에뮬레이터가 아니라 실제 프로젝트를 건드리는 운영 스크립트이므로, 실수로
잘못된 프로젝트에 쓰지 않도록 --project를 항상 명시하게 강제하고(기본값 없음),
인증은 로컬 gcloud 세션의 access token을 그대로 쓴다(서비스 계정 키 파일을
로컬에 두지 않기 위함) - Firestore/Vertex 둘 다 같은 토큰을 재사용한다.

Usage (backend/ 에서, .venv 활성화 후):
    export GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token)
    .venv/Scripts/python.exe scripts/backfill_profile_embeddings.py --project ourlab-0808 --dry-run
    .venv/Scripts/python.exe scripts/backfill_profile_embeddings.py --project ourlab-0808
    .venv/Scripts/python.exe scripts/backfill_profile_embeddings.py --project ourlab-0808 --clear

--dry-run은 uid별 합성 텍스트 "길이"만 찍는다(본문 자체는 PIPA상 로그에 남기지
않는다 - app/embedding/vertex_client.py와 동일한 원칙). 실제 임베딩/쓰기는
하지 않는다. --clear는 임베딩 호출 없이 전원 profile_embedding 필드를 지운다
(킬 스위치를 끄기로 한 뒤 기존 데이터를 정리할 때 쓴다).
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

from app.domain.constellation import compute_profile_text  # noqa: E402
from app.embedding.vertex_client import VertexEmbeddingClient  # noqa: E402
from app.firestore import constellation_repo, user_repo  # noqa: E402
from app.services.profile_embedding import refresh_profile_embedding  # noqa: E402

_LIST_LIMIT = 5000  # 백필 시점 유저 규모를 넉넉히 덮는 상한 (list_all_users 기본값 500 상향)


def _firestore_client(project: str, token: str) -> firestore.Client:
    credentials = Credentials(token=token).with_quota_project(project)
    return firestore.Client(project=project, credentials=credentials)


async def _run(db: firestore.Client, *, dry_run: bool, clear: bool, token: str) -> None:
    users = user_repo.list_all_users(db, limit=_LIST_LIMIT)
    print(f"대상 유저 {len(users)}명")

    if clear:
        for uid, _ in users:
            user_repo.set_profile_embedding(db, uid, None)
            print(f"cleared uid={uid}")
        return

    if dry_run:
        for uid, profile in users:
            published = constellation_repo.list_published_by_owner(db, uid)
            text = compute_profile_text(
                published, bio=profile.get("bio"), interest_tags=profile.get("interest_tags") or []
            )
            print(f"uid={uid} text_len={len(text)}")
        return

    embedder = VertexEmbeddingClient(access_token=token)
    for uid, _ in users:
        await refresh_profile_embedding(db, uid, embedder=embedder)
        print(f"refreshed uid={uid}")


def main() -> None:
    parser = argparse.ArgumentParser(description="backfill users.profile_embedding")
    parser.add_argument(
        "--project", required=True, help="Firestore/Vertex 프로젝트 id (예: ourlab-0808)"
    )
    parser.add_argument("--dry-run", action="store_true", help="쓰기 없이 텍스트 길이만 출력")
    parser.add_argument("--clear", action="store_true", help="임베딩 호출 없이 전원 필드 삭제")
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
    asyncio.run(_run(db, dry_run=args.dry_run, clear=args.clear, token=token))


if __name__ == "__main__":
    main()
