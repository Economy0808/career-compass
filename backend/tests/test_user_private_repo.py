"""user_private_repo 단위 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_quota_repo.py와 동일한 이유로 Mock을 쓰지 않는다 - 스킵 가드도 그 파일을
그대로 복사한 관례다.

실행 방법 (backend/ 에서, 두 에뮬레이터가 이미 떠 있는 상태):
    .venv/Scripts/python.exe -m pytest tests/test_user_private_repo.py -q
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

from app.firestore import user_private_repo
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


def _uid() -> str:
    return f"user-private-test-{uuid.uuid4().hex}"


def test_set_and_get_private_profile_round_trips() -> None:
    db = get_firestore_client()
    uid = _uid()

    user_private_repo.set_private_profile(
        db,
        uid,
        department="철학과",
        grade=1,
        double_major=None,
        career_text="아직 정하지 못했지만 데이터 쪽에 관심이 있습니다.",
        consents={"service": True, "overseas": True, "marketing": False},
    )

    stored = user_private_repo.get_private_profile(db, uid)
    assert stored is not None
    assert stored["department"] == "철학과"
    assert stored["grade"] == 1
    assert stored["double_major"] is None
    assert stored["career_text"] == "아직 정하지 못했지만 데이터 쪽에 관심이 있습니다."


def test_get_private_profile_unknown_uid_returns_none() -> None:
    db = get_firestore_client()
    assert user_private_repo.get_private_profile(db, _uid()) is None


def test_consent_timestamp_recorded_only_for_true_and_kept_first_only() -> None:
    db = get_firestore_client()
    uid = _uid()

    user_private_repo.set_private_profile(
        db,
        uid,
        department="철학과",
        grade=1,
        double_major=None,
        career_text=None,
        consents={"service": True, "overseas": True, "marketing": False},
    )
    first = user_private_repo.get_private_profile(db, uid)
    assert first is not None
    assert first.get("consent_service_at") is not None
    assert first.get("consent_overseas_at") is not None
    # marketing=False였으므로 타임스탬프 자체가 기록되지 않는다.
    assert "consent_marketing_at" not in first

    first_service_at = first["consent_service_at"]

    # 재제출(예: 온보딩 재시도)해도 최초 동의 시점은 덮어쓰지 않는다.
    user_private_repo.set_private_profile(
        db,
        uid,
        department="철학과",
        grade=2,
        double_major=None,
        career_text=None,
        consents={"service": True, "overseas": True, "marketing": True},
    )
    second = user_private_repo.get_private_profile(db, uid)
    assert second is not None
    assert second["consent_service_at"] == first_service_at
    assert second["grade"] == 2  # 다른 필드는 정상적으로 갱신된다
    assert second.get("consent_marketing_at") is not None  # 이번엔 True라 새로 기록됨


def test_career_text_stored_verbatim() -> None:
    db = get_firestore_client()
    uid = _uid()

    text = "창업 쪽 진로를 고민 중이고, 관련 대외활동을 준비하고 있습니다."
    user_private_repo.set_private_profile(
        db,
        uid,
        department="경영학과",
        grade=2,
        double_major="컴퓨터과학과",
        career_text=text,
        consents={"service": True, "overseas": True, "marketing": False},
    )
    stored = user_private_repo.get_private_profile(db, uid)
    assert stored is not None
    assert stored["career_text"] == text
    assert stored["double_major"] == "컴퓨터과학과"
