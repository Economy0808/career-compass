"""Firestore 교과목 카탈로그 리포지토리 통합 테스트 - 실제 에뮬레이터를 상대로 실행한다.

test_constellation_repo.py와 동일한 이유로 Mock을 쓰지 않는다: 배치 쓰기가
정말로 500개 제한을 넘겨도 성공하는지, set()이 정말로 멱등적인지는 실제
Firestore(에뮬레이터) 동작을 봐야만 검증할 수 있다.

FIRESTORE_EMULATOR_HOST가 설정돼 있지 않거나 에뮬레이터가 응답하지 않으면 이
파일의 모든 테스트를 스킵한다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_course_repo.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
import requests
from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.etl.yonsei_courses import MergedCourse
from app.firestore import course_repo as repo
from app.firestore.client import get_firestore_client


def _emulator_available() -> bool:
    """FIRESTORE_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
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


@pytest.fixture
def db() -> Iterator[Client]:
    yield get_firestore_client()


def _make_course(
    code: str,
    *,
    name: str = "철학개론",
    kind: str = "전기",
    years: list[int] | None = None,
    department: str = "철학과",
    college: str = "문과대학",
    description: str | None = "과목 설명입니다.",
) -> MergedCourse:
    return MergedCourse(
        code=code,
        name=name,
        kind=kind,
        years=years if years is not None else [1, 2],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        lab_hours=0.0,
        name_en="Introduction to Philosophy",
        description=description,
        college=college,
        department=department,
    )


# --- upsert_courses / get_course 왕복 ---


def test_upsert_then_get_round_trip_preserves_fields(db: Client) -> None:
    course = _make_course("HUM2037", years=[1, 2, 3])

    written = repo.upsert_courses(db, [course])

    assert written == 1
    fetched = repo.get_course(db, "HUM2037")
    assert fetched is not None
    assert fetched.code == "HUM2037"
    assert fetched.name == "철학개론"
    assert fetched.name_en == "Introduction to Philosophy"
    assert fetched.years == [1, 2, 3]
    assert fetched.description == "과목 설명입니다."
    assert fetched.college == "문과대학"
    assert fetched.department == "철학과"


def test_get_course_missing_returns_none(db: Client) -> None:
    assert repo.get_course(db, "NOSUCH9999") is None


# --- 멱등성 ---


def test_upsert_twice_leaves_one_doc_with_updated_values(db: Client) -> None:
    repo.upsert_courses(db, [_make_course("HUM2037", name="철학개론")])
    repo.upsert_courses(db, [_make_course("HUM2037", name="철학개론(개정)")])

    fetched = repo.get_course(db, "HUM2037")
    assert fetched is not None
    assert fetched.name == "철학개론(개정)"

    docs = list(
        db.collection("course_catalog").where(filter=FieldFilter("code", "==", "HUM2037")).stream()
    )
    assert len(docs) == 1


# --- 배치 처리 (500개 제한) ---


def test_upsert_more_than_500_courses_succeeds(db: Client) -> None:
    courses = [_make_course(f"BAT{i:04d}") for i in range(650)]

    written = repo.upsert_courses(db, courses)

    assert written == 650
    assert repo.get_course(db, "BAT0000") is not None
    assert repo.get_course(db, "BAT0649") is not None


# --- list_by_department / search_by_college ---


def test_list_by_department_filters_correctly(db: Client) -> None:
    repo.upsert_courses(
        db,
        [
            _make_course("PHI1001", department="철학과"),
            _make_course("PHI1002", department="철학과"),
            _make_course("ECO1001", department="경제학과"),
        ],
    )

    result = repo.list_by_department(db, "철학과")

    assert {c.code for c in result} == {"PHI1001", "PHI1002"}


def test_list_by_department_respects_limit(db: Client) -> None:
    repo.upsert_courses(db, [_make_course(f"LIM{i:03d}", department="철학과") for i in range(10)])

    result = repo.list_by_department(db, "철학과", limit=3)

    assert len(result) == 3


def test_search_by_college_filters_correctly(db: Client) -> None:
    repo.upsert_courses(
        db,
        [
            _make_course("HUM0001", college="문과대학"),
            _make_course("HUM0002", college="문과대학"),
            _make_course("ENG0001", college="공과대학"),
        ],
    )

    result = repo.search_by_college(db, "문과대학")

    assert {c.code for c in result} == {"HUM0001", "HUM0002"}


def test_search_by_college_respects_limit(db: Client) -> None:
    repo.upsert_courses(db, [_make_course(f"COL{i:03d}", college="문과대학") for i in range(10)])

    result = repo.search_by_college(db, "문과대학", limit=4)

    assert len(result) == 4


# --- list_taxonomy ---


def test_list_taxonomy_returns_sorted_unique_departments_and_colleges(db: Client) -> None:
    repo.upsert_courses(
        db,
        [
            _make_course("TAX0001", department="응용통계학과", college="상경대학"),
            _make_course("TAX0002", department="응용통계학과", college="상경대학"),
            _make_course("TAX0003", department="철학과", college="문과대학"),
        ],
    )
    # 모듈 레벨 캐시를 이 테스트의 upsert 이후 상태로 강제 리프레시한다 - 캐시가
    # 프로세스 생애주기 동안 남아있으므로 다른 테스트가 먼저 채웠을 수 있다.
    repo._taxonomy_cache = None

    departments, colleges = repo.list_taxonomy(db)

    assert "응용통계학과" in departments
    assert "철학과" in departments
    assert departments == sorted(departments)
    assert "상경대학" in colleges
    assert "문과대학" in colleges
    assert colleges == sorted(colleges)


def test_list_taxonomy_caches_after_first_call(db: Client) -> None:
    repo._taxonomy_cache = None
    repo.upsert_courses(db, [_make_course("TAX0010", department="캐시학과", college="캐시대학")])

    first = repo.list_taxonomy(db)
    # 캐시된 뒤 새 학과를 추가해도(재스캔 없이) 첫 호출 결과를 그대로 반환해야 한다.
    repo.upsert_courses(db, [_make_course("TAX0011", department="새학과", college="새대학")])
    second = repo.list_taxonomy(db)

    assert first == second
    assert "새학과" not in second[0]
    repo._taxonomy_cache = None  # 다른 테스트에 영향 주지 않도록 정리.
