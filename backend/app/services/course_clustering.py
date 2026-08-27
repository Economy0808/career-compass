"""LLM 기반 수업(course) 군집화 오케스트레이션.

임베딩 유사도 대신 "카테고리로 후보를 좁힌 뒤 LLM이 판단"하는 패턴을 따른다 —
이전 NCS 직무 매칭에서 임베딩 유사도는 "관련 있음"과 "실제로 이것임"을 구분하지
못해 폐기됐다. 그 대체 패턴이 여기서도 그대로 적용된다:

1. select_relevant_departments — LLM이 목표를 보고 관련 단과대/학과를 고른다.
2. Firestore에서 그 학과/단과대 소속 과목만 가져온다 (7,109개 전체가 아니라
   좁혀진 집합).
3. cluster_courses — 좁혀진 후보 중 실제로 목표에 맞는 과목을 골라 이름 붙인
   군집으로 묶는다 (군집 이름은 LLM이 목표별로 즉석에서 짓는다. 고정 목록 아님).

## 계층(hierarchy) 규칙

`level`(학정번호 첫 자리, 1~4)이 1차 정렬 신호다 — 100% 커버리지를 가진 유일한
필드이기 때문이다. `years`(수강 가능 학년)와 `kind`(전기/전필/전선)는 있을 때만
보정에 쓴다. `years`와 `level`은 서로 다른 개념이라 절대 섞지 않는다(하나로
다른 하나를 채우지 않는다).

계층은 정렬/추천 순서를 위한 보조 신호일 뿐, 자격 요건(lock)이 아니다 — 이
모듈은 과목을 배제하는 데 계층을 쓰지 않는다. 유일한 예외는 5000/6000단위
(대학원 과목)로, 학부생 추천에서는 항상 하드 제외한다 — LLM 프롬프트 준수
여부와 무관하게 이 서비스 레이어에서 필터링한다.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from google.cloud.firestore import Client

from app.etl.yonsei_courses import MergedCourse
from app.firestore.course_repo import list_by_department, search_by_college
from app.llm.base import CourseOption, LLMClient

# 학정번호 첫 자리가 이 값 이상이면 대학원 과목으로 간주해 학부 추천에서 제외한다.
_GRADUATE_LEVEL_MIN = 5

# kind 진행 순서(전공기초 -> 전공필수 -> 전공선택). 관측되지 않은 종별/None은
# "전필"과 같은 중립 순위로 취급해 정렬을 크게 흔들지 않는다.
_KIND_ORDER = {"전기": 0, "전필": 1, "전선": 2}
_KIND_DEFAULT_RANK = 1


@dataclass
class ClusteredCourseView:
    """군집 안의 과목 하나 — 화면 표시에 필요한 정보 + LLM의 추천 사유."""

    code: str
    name: str
    level: int | None
    years: list[int]
    kind: str | None
    reason: str


@dataclass
class CourseClusterView:
    """LLM이 목표에 맞춰 즉석에서 이름 붙인 군집. 과목은 계층 규칙으로 정렬돼 있다."""

    name: str
    courses: list[ClusteredCourseView] = field(default_factory=list)
    # 이 군집이 왜 목표에 필요한지에 대한 코치 코멘트 (base.CourseCluster.advice 그대로).
    advice: str | None = None


@dataclass
class CourseClusterResult:
    clusters: list[CourseClusterView] = field(default_factory=list)


def _is_undergraduate(course: MergedCourse) -> bool:
    """5000/6000단위(대학원)만 제외한다. level이 없는 과목은 배제하지 않는다."""
    return course.level is None or course.level < _GRADUATE_LEVEL_MIN


def _hierarchy_key(course: MergedCourse) -> tuple[int, int, int]:
    """정렬 키: (level 오름차순, kind 진행, years 최솟값). level 없는 과목은 맨 뒤로."""
    level_rank = course.level if course.level is not None else 999
    kind_rank = _KIND_ORDER.get(course.kind or "", _KIND_DEFAULT_RANK)
    years_rank = min(course.years) if course.years else 99
    return (level_rank, kind_rank, years_rank)


async def select_relevant_departments(llm: LLMClient, goal_text: str) -> list[str]:
    """목표와 관련 있는 단과대/학과 이름을 고른다. 확신이 없으면 빈 리스트(정상 경로)."""
    return await llm.select_relevant_departments(goal_text)


async def cluster_courses(
    llm: LLMClient,
    goal_text: str,
    courses: list[MergedCourse],
    rules_context: str | None = None,
) -> CourseClusterResult:
    """후보 과목 중 목표에 맞는 것을 골라 군집으로 묶고, 군집 내부를 계층 규칙으로 정렬한다.

    5000/6000단위는 LLM에 넘기기 전에 이미 걸러낸다 — 결과에 나타날 수 없다.

    rules_context: 학사 규정 발췌 — 주어지면 그대로 llm.cluster_courses에 넘겨
    군집별 advice의 근거로 쓰이게 한다. None이면 규정 근거 없이 생성한다.
    """
    undergrad_courses = [c for c in courses if _is_undergraduate(c)]
    if not undergrad_courses:
        return CourseClusterResult(clusters=[])

    options = [
        CourseOption(
            code=c.code,
            name=c.name,
            description=c.description,
            level=c.level,
            years=c.years,
            kind=c.kind,
            department=c.department,
        )
        for c in undergrad_courses
    ]
    raw = await llm.cluster_courses(goal_text, options, rules_context=rules_context)
    by_code = {c.code: c for c in undergrad_courses}

    clusters: list[CourseClusterView] = []
    for raw_cluster in raw.clusters:
        # 환각 방어: LLM이 후보에 없는 code를 냈으면 버린다(anthropic_client도 한 번
        # 걸러주지만, mock이나 다른 구현체가 안 지킬 수도 있으니 서비스 레이어에서 재확인).
        valid = [rc for rc in raw_cluster.courses if rc.code in by_code]
        if not valid:
            continue
        ordered = sorted(valid, key=lambda rc: _hierarchy_key(by_code[rc.code]))
        clusters.append(
            CourseClusterView(
                name=raw_cluster.name,
                courses=[
                    ClusteredCourseView(
                        code=rc.code,
                        name=by_code[rc.code].name,
                        level=by_code[rc.code].level,
                        years=by_code[rc.code].years,
                        kind=by_code[rc.code].kind,
                        reason=rc.reason,
                    )
                    for rc in ordered
                ],
                advice=raw_cluster.advice,
            )
        )
    return CourseClusterResult(clusters=clusters)


async def suggest_course_bin(
    db: Client,
    llm: LLMClient,
    goal_text: str,
    fetch_limit: int = 100,
    rules_context: str | None = None,
) -> CourseClusterResult:
    """전체 파이프라인: 학과 선택 -> Firestore 좁혀 조회 -> 군집화.

    관련 학과가 하나도 없으면(목표가 애매하거나 이 학교 학과와 무관) 빈 결과를
    반환한다 — 예외를 던지지 않는다. 호출자는 이를 "제안할 수업 없음"으로 취급한다.

    rules_context: 학사 규정 발췌 — cluster_courses로 그대로 전달한다.
    """
    departments = await select_relevant_departments(llm, goal_text)
    if not departments:
        return CourseClusterResult(clusters=[])

    seen_codes: set[str] = set()
    candidates: list[MergedCourse] = []
    for name in departments:
        # LLM이 반환하는 이름이 학과명인지 단과대명인지 보장되지 않으므로 두 필드
        # 모두로 조회해본다(course_catalog에는 department/college가 별도 필드).
        # list_by_department/search_by_college는 동기(sync) Firestore 호출이다 —
        # 이 함수(suggest_course_bin) 자체는 백그라운드 asyncio 태스크(다른 코루틴과
        # 동시에 asyncio.gather로 묶여) 안에서 돌 수 있으므로, 그대로 부르면 이벤트
        # 루프를 블로킹해 같은 프로세스의 다른 API 요청까지 멈춰버린다. asyncio.to_thread로
        # 스레드풀에 위임해 이벤트 루프 블로킹을 막는다(반환값·순서·필터링 동작은 동일).
        fetched_lists = await asyncio.gather(
            asyncio.to_thread(list_by_department, db, name, limit=fetch_limit),
            asyncio.to_thread(search_by_college, db, name, limit=fetch_limit),
        )
        for fetched in fetched_lists:
            for course in fetched:
                if course.code not in seen_codes:
                    seen_codes.add(course.code)
                    candidates.append(course)

    if not candidates:
        return CourseClusterResult(clusters=[])

    return await cluster_courses(llm, goal_text, candidates, rules_context=rules_context)
