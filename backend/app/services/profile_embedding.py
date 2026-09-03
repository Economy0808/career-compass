"""프로필 임베딩(users.profile_embedding) 재계산 서비스.

발행 상태 변경(app/api/constellation.py의 publish 핸들러)과 소개(bio) 수정
(app/api/profiles.py의 patch_my_profile) 양쪽에서 호출한다. 임베딩은 탐색
검색의 품질을 높이는 부가 기능이지 핵심 경로가 아니므로, 이 함수는 절대
예외를 위로 던지지 않는다 - 실패해도 발행/프로필 수정 자체는 성공해야 한다
(app/api/profiles.py:95-103의 알림 생성 실패 격리 관례와 동일).
"""

from __future__ import annotations

import logging

from google.cloud.firestore import Client

from app.config import get_settings
from app.domain.constellation import Constellation, compute_profile_text
from app.embedding import get_embedding_client
from app.embedding.base import EmbeddingClient
from app.firestore import constellation_repo, user_repo

logger = logging.getLogger("app.services.profile_embedding")


async def refresh_profile_embedding(
    db: Client,
    uid: str,
    *,
    published: list[Constellation] | None = None,
    embedder: EmbeddingClient | None = None,
) -> None:
    """uid의 프로필 임베딩을 발행 별자리 + bio + interest_tags로 다시 계산해 저장한다.

    published를 안 넘기면(예: bio만 바뀐 경우) 직접 owner의 발행 별자리를
    다시 읽는다 - publish 핸들러는 이미 방금 계산한 목록을 넘겨 중복 조회를
    피한다(app/api/constellation.py 참고). embedder를 안 넘기면 팩토리
    기본값을 쓴다(테스트가 Fake/스텁을 주입할 수 있게).

    embedding_enabled 킬 스위치가 꺼져 있으면 아무 것도 하지 않는다(기존
    임베딩 필드도 건드리지 않는다 - 킬 스위치는 "더 이상 갱신하지 않는다"는
    뜻이지 "기존 데이터를 지운다"는 뜻이 아니다). scripts/backfill_profile_embeddings.py
    같은 백필 스크립트도 이 함수를 그대로 재사용한다.
    """
    if not get_settings().embedding_enabled:
        return
    try:
        if published is None:
            published = constellation_repo.list_published_by_owner(db, uid)
        profile = user_repo.get_user_profile(db, uid) or {}
        text = compute_profile_text(
            published,
            bio=profile.get("bio"),
            interest_tags=profile.get("interest_tags") or [],
        )
        values = None
        if text:
            client = embedder or get_embedding_client()
            values = await client.embed(text, kind="document")
        user_repo.set_profile_embedding(db, uid, values)
    except Exception:
        logger.warning("프로필 임베딩 갱신 실패 uid=%s", uid, exc_info=True)
