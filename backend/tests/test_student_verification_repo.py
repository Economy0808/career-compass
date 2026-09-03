"""student_verification_repo 단위 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_quota_repo.py와 동일한 이유로 Mock을 쓰지 않는다 - 스킵 가드도 그 파일을
그대로 복사한 관례다.

실행 방법 (backend/ 에서, 두 에뮬레이터가 이미 떠 있는 상태):
    .venv/Scripts/python.exe -m pytest tests/test_student_verification_repo.py -q
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

from app.firestore import student_verification_repo
from app.firestore.client import get_firestore_client

_SECRET = "test-secret-key"


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
    return f"student-verif-test-{uuid.uuid4().hex}"


def test_hash_is_deterministic() -> None:
    a = student_verification_repo._hash_student_id(_SECRET, "2024123456")
    b = student_verification_repo._hash_student_id(_SECRET, "2024123456")
    assert a == b


def test_hash_differs_for_different_student_ids() -> None:
    a = student_verification_repo._hash_student_id(_SECRET, "2024123456")
    b = student_verification_repo._hash_student_id(_SECRET, "2024999999")
    assert a != b


def test_hash_differs_for_different_secret_keys() -> None:
    """키 없이는 사전 계산이 불가능해야 한다는 설계 의도 - 키가 바뀌면 해시도 바뀐다."""
    a = student_verification_repo._hash_student_id("key-one", "2024123456")
    b = student_verification_repo._hash_student_id("key-two", "2024123456")
    assert a != b


def test_store_and_dedup_lookup_round_trips() -> None:
    db = get_firestore_client()
    uid = _uid()
    student_id = "2024111222"

    stored_hash = student_verification_repo.store_student_id_hash(
        db, uid, student_id, secret_key=_SECRET
    )

    found_uid = student_verification_repo.find_uid_by_student_id_hash(db, stored_hash)
    assert found_uid == uid


def test_find_uid_by_hash_returns_none_when_no_match() -> None:
    db = get_firestore_client()
    bogus_hash = student_verification_repo._hash_student_id(_SECRET, "0000000000")
    assert student_verification_repo.find_uid_by_student_id_hash(db, bogus_hash) is None


def test_verified_defaults_false_and_is_preserved_on_resubmit() -> None:
    db = get_firestore_client()
    uid = _uid()

    student_verification_repo.store_student_id_hash(db, uid, "2024333444", secret_key=_SECRET)
    doc = get_firestore_client().collection("student_verifications").document(uid).get().to_dict()
    assert doc["verified"] is False

    # 수동으로 verified=True로 승격했다고 가정하고, 재제출이 이를 되돌리지 않는지 확인.
    get_firestore_client().collection("student_verifications").document(uid).set(
        {"verified": True}, merge=True
    )
    student_verification_repo.store_student_id_hash(db, uid, "2024333444", secret_key=_SECRET)
    doc_after = (
        get_firestore_client().collection("student_verifications").document(uid).get().to_dict()
    )
    assert doc_after["verified"] is True


def test_student_id_not_stored_verbatim_anywhere_in_document() -> None:
    """학번 원문이 저장 문서 어디에도(필드명/값) 나타나지 않아야 한다 (PIPA 최소수집)."""
    db = get_firestore_client()
    uid = _uid()
    student_id = "2024555666"

    student_verification_repo.store_student_id_hash(db, uid, student_id, secret_key=_SECRET)

    doc = db.collection("student_verifications").document(uid).get().to_dict()
    assert student_id not in str(doc.values())
