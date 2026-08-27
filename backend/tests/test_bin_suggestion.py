"""bin_suggestion 서비스 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_note_repo.py/test_constellation_repo.py와 동일한 이유로 Mock을 쓰지 않고
에뮬레이터를 쓴다(course_clustering.suggest_course_bin이 실제 course_catalog
쿼리를 거치므로) - 스킵 가드/픽스처 스타일도 그 파일들을 그대로 복사한 관례다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_bin_suggestion.py -q"
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
import requests
from google.cloud.firestore import Client

from app.etl.yonsei_courses import MergedCourse
from app.firestore.client import get_firestore_client
from app.firestore.course_repo import upsert_courses
from app.llm.mock_client import MockClaudeClient
from app.services.bin_suggestion import fill_single_bin, suggest_all_bins


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


def _course(
    code: str,
    name: str = "테스트 과목",
    level: int | None = 1,
    department: str = "경영대학",
) -> MergedCourse:
    return MergedCourse(
        code=code,
        name=name,
        level=level,
        years=[],
        kind=None,
        description="설명",
        department=department,
        college=department,
    )


_BUSINESS_GOAL = "전략 컨설턴트가 되고 싶다"
_UNMATCHED_GOAL = "asdf 12345 !!!"


def _seed_business_courses(db: Client) -> None:
    upsert_courses(
        db,
        [
            _course("BIZ1001", "경영학 원론", level=1, department="경영대학"),
            _course("BIZ2001", "회계원리", level=2, department="경영대학"),
        ],
    )


@pytest.mark.asyncio
async def test_suggest_all_bins_business_goal_has_course_and_support_bins(db: Client) -> None:
    """경영대학 과목을 시딩한 상태에서 관련 목표를 주면 수업 + 비교과 군집이 모두 나온다.

    동시성(asyncio.gather) 경로도 이 테스트 하나로 암묵적으로 커버된다 -
    suggest_all_bins가 완주해서 두 갈래 결과가 함께 오는지가 곧 그 검증이다.
    """
    _seed_business_courses(db)
    llm = MockClaudeClient()

    result = await suggest_all_bins(db, llm, _BUSINESS_GOAL)

    assert result["bins"]
    course_bins = [b for b in result["bins"] if any(i["type"] == "course" for i in b["items"])]
    support_bins = [b for b in result["bins"] if any(i["type"] != "course" for i in b["items"])]
    assert course_bins, "수업 군집이 최소 1개 있어야 한다"
    assert support_bins, "비교과 군집이 최소 1개 있어야 한다"

    course_item_ids = {item["id"] for b in course_bins for item in b["items"]}
    assert course_item_ids == {"course:BIZ1001", "course:BIZ2001"}
    for b in course_bins:
        for item in b["items"]:
            assert item["type"] == "course"

    for b in support_bins:
        assert b.get("advice", "").endswith("(mock)")


@pytest.mark.asyncio
async def test_suggest_all_bins_ids_and_origin_and_no_none_values(db: Client) -> None:
    """모든 보관함 id는 uuid로 파싱 가능해야 하고 origin은 'llm', None 값 키는 생략돼야 한다."""
    _seed_business_courses(db)
    llm = MockClaudeClient()

    result = await suggest_all_bins(db, llm, _BUSINESS_GOAL)

    assert result["bins"]
    for b in result["bins"]:
        uuid.UUID(b["id"])  # ValueError를 던지면 테스트 실패
        assert b["origin"] == "llm"
        for item in b["items"]:
            assert None not in item.values()
        if "advice" in b:
            assert b["advice"] is not None


@pytest.mark.asyncio
async def test_suggest_all_bins_unmatched_goal_has_no_course_bins(db: Client) -> None:
    """학과 매칭이 안 되는 목표는 크래시 없이 수업 군집만 비운다 (비교과는 별개 계약).

    course_clustering.suggest_course_bin은 관련 학과가 없으면 빈 결과를 낸다는
    계약이 있지만, suggest_support_elements는 목표 문자열 자체가 비어있지 않은 한
    (mock 기준) 뭔가를 제안한다 - 두 갈래의 "확신 없음" 기준이 다르다는 걸
    이 테스트로 명시한다.
    """
    _seed_business_courses(db)
    llm = MockClaudeClient()

    result = await suggest_all_bins(db, llm, _UNMATCHED_GOAL)

    for b in result["bins"]:
        for item in b["items"]:
            assert item["type"] != "course"


@pytest.mark.asyncio
async def test_suggest_all_bins_drafts_reference_only_bin_items(db: Client) -> None:
    """drafts는 최대 3개, 모든 itemId/edge 끝점이 실제 bins의 item id 안에 있어야 한다."""
    _seed_business_courses(db)
    llm = MockClaudeClient()

    result = await suggest_all_bins(db, llm, _BUSINESS_GOAL)

    assert len(result["drafts"]) <= 3
    known_ids = {item["id"] for b in result["bins"] for item in b["items"]}
    for draft in result["drafts"]:
        assert draft["name"]
        assert draft["itemIds"]
        item_id_set = set(draft["itemIds"])
        assert item_id_set <= known_ids
        for a, b in draft["edges"]:
            assert a in item_id_set
            assert b in item_id_set


@pytest.mark.asyncio
async def test_suggest_all_bins_empty_bins_has_no_drafts(db: Client) -> None:
    """bins가 아예 비면(학과 매칭도, 비교과 제안도 없는 극단적 상황) drafts도 빈 리스트."""
    llm = MockClaudeClient()

    # unmatched 목표 + 미시딩 상태에서도 mock의 suggest_support_elements는 뭔가를
    # 내므로(모듈 docstring 참고), bins를 확실히 비우려면 목표 자체를 공백으로 준다.
    result = await suggest_all_bins(db, llm, "   ")

    assert result["bins"] == []
    assert result["drafts"] == []


@pytest.mark.asyncio
async def test_fill_single_bin_returns_one_user_bin_with_requested_label(db: Client) -> None:
    llm = MockClaudeClient()
    bin_label = "네트워킹"

    result = await fill_single_bin(db, llm, _BUSINESS_GOAL, bin_label)

    assert result["label"] == bin_label
    assert result["origin"] == "user"
    uuid.UUID(result["id"])
    assert result["items"], "채워진 보관함은 최소 1개 원소를 가져야 한다"
    for item in result["items"]:
        assert item["id"].startswith("support:")
        assert None not in item.values()
