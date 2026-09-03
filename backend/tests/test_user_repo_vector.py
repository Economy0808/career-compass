"""user_repo의 프로필 임베딩 벡터 저장/조회 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_explore_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터 스킵 가드도
그 파일을 그대로 복사한 관례) - find_nearest는 실제 벡터 인덱스 질의 경로라
Mock으로는 검증할 수 없다.

실행 방법 (backend/ 에서, 두 에뮬레이터가 이미 떠 있는 상태):
    .venv/Scripts/python.exe -m pytest tests/test_user_repo_vector.py -q
"""

from __future__ import annotations

import os

import pytest
import requests

from app.firestore import user_repo
from app.firestore.client import get_firestore_client


def _emulator_available() -> bool:
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)

_DIMENSIONS = 768


def _unit_vector(*, positive: bool) -> list[float]:
    """단위벡터 하나와 그 반대부호(코사인 거리 2) 벡터를 만든다."""
    base = [1.0] + [0.0] * (_DIMENSIONS - 1)
    return base if positive else [-v for v in base]


@pytest.mark.asyncio
async def test_find_nearest_ranks_identical_vector_first_and_excludes_opposite() -> None:
    db = get_firestore_client()
    query_vector = _unit_vector(positive=True)

    db.collection("users").document("same-vector").set({"display_name": "동일벡터"})
    db.collection("users").document("opposite-vector").set({"display_name": "반대벡터"})
    user_repo.set_profile_embedding(db, "same-vector", query_vector)
    user_repo.set_profile_embedding(db, "opposite-vector", _unit_vector(positive=False))

    results = user_repo.find_nearest_users(db, query_vector, limit=10, distance_threshold=1.0)

    uids = [uid for uid, _ in results]
    assert uids[0] == "same-vector"
    assert "opposite-vector" not in uids


@pytest.mark.asyncio
async def test_set_profile_embedding_none_deletes_field() -> None:
    db = get_firestore_client()
    uid = "embedding-delete-target"
    db.collection("users").document(uid).set({"display_name": "삭제대상"})
    user_repo.set_profile_embedding(db, uid, _unit_vector(positive=True))

    user_repo.set_profile_embedding(db, uid, None)

    doc = db.collection("users").document(uid).get().to_dict()
    assert "profile_embedding" not in doc


@pytest.mark.asyncio
async def test_list_all_users_projection_excludes_profile_embedding() -> None:
    db = get_firestore_client()
    uid = "embedding-projection-target"
    db.collection("users").document(uid).set({"display_name": "프로젝션대상"})
    user_repo.set_profile_embedding(db, uid, _unit_vector(positive=True))

    results = user_repo.list_all_users(db)

    profile = next(profile for candidate_uid, profile in results if candidate_uid == uid)
    assert "profile_embedding" not in profile
