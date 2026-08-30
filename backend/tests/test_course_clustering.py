import pytest

from app.etl.yonsei_courses import MergedCourse
from app.llm.mock_client import MockClaudeClient
from app.services.course_clustering import (
    cluster_courses,
    select_relevant_departments,
)


class _RecordingLLM(MockClaudeClient):
    """select_relevant_departments에 실제로 전달된 known_departments/colleges를
    기록하는 스텁 - course_clustering.select_relevant_departments가 어휘를
    llm.select_relevant_departments까지 그대로 전달하는지(카탈로그 그라운딩) 검증용.
    """

    def __init__(self) -> None:
        self.received_departments: list[str] | None = None
        self.received_colleges: list[str] | None = None

    async def select_relevant_departments(
        self,
        goal_text: str,
        known_departments: list[str] | None = None,
        known_colleges: list[str] | None = None,
    ) -> list[str]:
        self.received_departments = known_departments
        self.received_colleges = known_colleges
        return ["응용통계학과"] if known_departments else []


def _course(
    code: str,
    name: str = "테스트 과목",
    level: int | None = 1,
    years: list[int] | None = None,
    kind: str | None = None,
    department: str = "경영대학",
) -> MergedCourse:
    return MergedCourse(
        code=code,
        name=name,
        level=level,
        years=years or [],
        kind=kind,
        description="설명",
        department=department,
        college=department,
    )


@pytest.mark.asyncio
async def test_select_relevant_departments_returns_nonempty_for_plausible_goal() -> None:
    llm = MockClaudeClient()
    departments = await select_relevant_departments(llm, "전략 컨설턴트가 되고 싶다")
    assert departments  # 비어있지 않음
    assert "경영대학" in departments


@pytest.mark.asyncio
async def test_select_relevant_departments_empty_for_unrelated_goal_degrades_gracefully() -> None:
    """어떤 학과와도 매칭 안 되는 목표는 빈 리스트를 낸다 — 예외가 아니다."""
    llm = MockClaudeClient()
    departments = await select_relevant_departments(llm, "asdf 12345 !!!")
    assert departments == []

    # 빈 학과 목록으로 군집화를 시도해도 크래시하지 않고 빈 결과를 낸다.
    result = await cluster_courses(llm, "asdf 12345 !!!", [])
    assert result.clusters == []


@pytest.mark.asyncio
async def test_cluster_courses_orders_by_level_ascending_within_cluster() -> None:
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [
        _course("BIZ4001", "고급 전략", level=4, department="경영대학"),
        _course("BIZ1001", "경영학 원론", level=1, department="경영대학"),
        _course("BIZ3001", "재무관리", level=3, department="경영대학"),
        _course("BIZ2001", "회계원리", level=2, department="경영대학"),
    ]
    result = await cluster_courses(llm, goal, courses)

    assert result.clusters  # 최소 1개 군집
    for cluster in result.clusters:
        levels = [c.level for c in cluster.courses]
        assert levels == sorted(levels)


@pytest.mark.asyncio
async def test_cluster_courses_excludes_graduate_level_5000_6000() -> None:
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [
        _course("BIZ1001", "경영학 원론", level=1, department="경영대학"),
        _course("BIZ5001", "대학원 세미나", level=5, department="경영대학"),
        _course("BIZ6001", "박사 세미나", level=6, department="경영대학"),
    ]
    result = await cluster_courses(llm, goal, courses)

    all_codes = {c.code for cluster in result.clusters for c in cluster.courses}
    assert "BIZ1001" in all_codes
    assert "BIZ5001" not in all_codes
    assert "BIZ6001" not in all_codes


@pytest.mark.asyncio
async def test_cluster_names_come_from_llm_not_hardcoded() -> None:
    """군집 이름이 서비스 레이어에서 고정되는 게 아니라 LLM(mock) 출력 그대로 흘러나온다."""
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [
        _course("BIZ1001", "경영학 원론", level=1, department="경영대학"),
        _course("STA1001", "통계학 개론", level=1, department="응용통계학과"),
    ]
    result = await cluster_courses(llm, goal, courses)

    names = {cluster.name for cluster in result.clusters}
    # mock의 결정론적 네이밍 규칙("{목표}: {학과}")이 그대로 통과돼야 한다.
    assert any("경영대학" in n for n in names)
    assert any("응용통계학과" in n for n in names)
    # 고정된 4-bin 이름("수업"/"학회"/"자격증"/"네트워킹") 같은 게 섞여 있으면 안 된다.
    assert "수업" not in names
    assert "자격증" not in names


@pytest.mark.asyncio
async def test_cluster_courses_no_undergrad_candidates_returns_empty() -> None:
    llm = MockClaudeClient()
    courses = [_course("BIZ6001", "박사 세미나", level=6)]
    result = await cluster_courses(llm, "전략 컨설턴트가 되고 싶다", courses)
    assert result.clusters == []


@pytest.mark.asyncio
async def test_cluster_courses_advice_propagates_from_base_to_view() -> None:
    """base.CourseCluster.advice가 서비스 CourseClusterView.advice까지 그대로 흘러야 한다
    (A1 회귀 가드 — 섀도 타입이 조용히 필드를 떨어뜨리는 걸 방지)."""
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [_course("BIZ1001", "경영학 원론", level=1, department="경영대학")]
    result = await cluster_courses(llm, goal, courses)

    assert result.clusters
    for cluster in result.clusters:
        assert cluster.advice is not None
        assert "(mock advice)" in cluster.advice


@pytest.mark.asyncio
async def test_select_relevant_departments_forwards_known_vocabulary_to_llm() -> None:
    """course_repo.list_taxonomy가 스캔한 실제 학과/단과대 목록이 그대로
    llm.select_relevant_departments까지 전달돼야 한다(카탈로그 그라운딩)."""
    llm = _RecordingLLM()
    known_departments = ["응용통계학과", "컴퓨터과학과"]
    known_colleges = ["상경대학", "공과대학"]

    result = await select_relevant_departments(
        llm, "데이터 사이언티스트가 되고 싶다", known_departments, known_colleges
    )

    assert llm.received_departments == known_departments
    assert llm.received_colleges == known_colleges
    assert result == ["응용통계학과"]


@pytest.mark.asyncio
async def test_select_relevant_departments_defaults_to_no_vocabulary() -> None:
    """known_departments/colleges를 안 넘기는 기존 호출부도 그대로 동작해야 한다."""
    llm = _RecordingLLM()

    result = await select_relevant_departments(llm, "asdf 12345 !!!")

    assert llm.received_departments is None
    assert llm.received_colleges is None
    assert result == []


@pytest.mark.asyncio
async def test_cluster_courses_propagates_department_to_view() -> None:
    """MergedCourse.department가 ClusteredCourseView.department까지 그대로 흘러야 한다
    (2026-08-30 - bin_suggestion이 이 값을 BinItem.department로 옮겨 담는 전제)."""
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [_course("BIZ1001", "경영학 원론", level=1, department="경영대학")]
    result = await cluster_courses(llm, goal, courses)

    assert result.clusters
    all_courses = [c for cluster in result.clusters for c in cluster.courses]
    assert all_courses
    for c in all_courses:
        assert c.department == "경영대학"


@pytest.mark.asyncio
async def test_cluster_courses_rules_context_none_still_works() -> None:
    """rules_context를 안 넘겨도(기본값 None) 기존 호출부는 그대로 동작해야 한다."""
    llm = MockClaudeClient()
    goal = "전략 컨설턴트가 되고 싶다"
    courses = [_course("BIZ1001", "경영학 원론", level=1, department="경영대학")]
    result = await cluster_courses(llm, goal, courses, rules_context=None)
    assert result.clusters

    # 키워드 인자 없이 호출하는 기존 경로도 여전히 동작해야 한다.
    result_default = await cluster_courses(llm, goal, courses)
    assert result_default.clusters
