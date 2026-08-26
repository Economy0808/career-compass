"""실제 Claude API 없이 전체 플로우를 테스트하기 위한 결정론적 Mock 구현체.

네트워크를 전혀 쓰지 않으므로 개발·테스트 비용이 $0이다. 종합은 목표 텍스트에서
결정적으로 6~12개 마일스톤을 만들고(같은 입력=같은 결과), NCS 능력단위가 주어지면
상세(detail)에 가볍게 녹여 그라운딩 흉내를 낸다. research_job도 canned 결과를 돌려준다.

ANTHROPIC_API_KEY가 설정되면 app/llm/__init__.py의 get_llm_client()가 실제
AnthropicClaudeClient로 교체한다 (config.use_real_llm).
"""

import zlib
from datetime import date, timedelta

from app.llm.base import (
    AbilityUnitRef,
    CareerIntent,
    ChatMessage,
    ChatTurn,
    ClusteredCourse,
    CourseCluster,
    CourseClusterResult,
    CourseOption,
    GeneratedMilestone,
    GeneratedRoadmapItem,
    GeneratedRoadmapSet,
    JobResearchResult,
    MajorGoalDecision,
    NcsJobOption,
    RoadmapContext,
)

# 목표 텍스트의 키워드 -> 관련 단과대/학과 (결정론적 mock 매칭용, 닫힌 집합 아님).
# 실제 모델은 의미로 판단하지만, mock은 부분일치로 같은 계약(못 찾으면 빈 리스트)을 지킨다.
_DEPARTMENT_KEYWORDS: dict[str, list[str]] = {
    "컨설턴트": ["경영대학", "상경대학"],
    "컨설팅": ["경영대학", "상경대학"],
    "경영": ["경영대학"],
    "재무": ["경영대학", "상경대학"],
    "회계": ["경영대학"],
    "마케팅": ["경영대학"],
    "전과": ["문과대학"],
    "데이터": ["응용통계학과", "공과대학"],
    "통계": ["응용통계학과"],
    "개발자": ["공과대학"],
    "프로그래": ["공과대학"],
}

MIN_MILESTONES = 6
MAX_MILESTONES = 12

FIXED_QUESTIONS = [
    "그 목표는 언제까지 이루고 싶으신가요?",
    "지금까지 이 분야에서 해본 경험이나 준비가 있나요?",
    "일주일에 이 목표를 위해 쓸 수 있는 시간은 대략 어느 정도인가요?",
    "특별히 끌리는 세부 분야나 역할이 있나요? (아직 몰라도 괜찮아요)",
    "혼자 파고드는 것과 사람들과 함께하는 것 중 어느 쪽이 더 잘 맞나요?",
]

# known_profile이 있으면(대목표 컨텍스트 재사용) 이미 아는 경험·시간 질문은 생략하고
# 이번 목표에 특화된 질문만 남긴다.
FOLLOWUP_QUESTIONS = [FIXED_QUESTIONS[0], FIXED_QUESTIONS[3], FIXED_QUESTIONS[4]]

_GOAL_SUFFIXES = ("이 되고 싶어", "가 되고 싶어", "하고 싶어", "하고싶어", "되고 싶어")

# 뼈대 단계는 (title, 프리뷰 한 줄, 상세 가이드) 3-튜플.
# 프리뷰는 스크롤 뷰용 한 줄, detail은 무엇을/왜/어떻게 + 완료 기준.
_Step = tuple[str, str, str]

# opening(3) + closing(3) = MIN(6). extras는 count-6개(0~6)가 중간 삽입.
_CORE_OPENING: list[_Step] = [
    (
        "기초 개념 잡기",
        "{goal}의 핵심 개념과 용어를 훑는다.",
        "{goal}이 실제로 어떤 일이고 어떤 역량이 필요한지 전체 지도를 그린다. "
        "입문 강의 1개 또는 개론서 1권을 정해 끝까지 본다. "
        "완료 기준: 핵심 용어 10개를 내 말로 설명할 수 있다.",
    ),
    (
        "필수 도구 익히기",
        "가장 많이 쓰는 도구 하나를 손에 익힌다.",
        "이 분야에서 가장 기본이 되는 도구·언어를 하나 골라 튜토리얼을 따라 해본다. "
        "완료 기준: 간단한 예제를 남의 도움 없이 처음부터 끝까지 만들어본다.",
    ),
    (
        "작은 실습 해보기",
        "배운 걸 아주 작은 결과물로 만들어본다.",
        "규모가 작아도 좋으니 직접 손을 움직여 결과물 하나를 완성한다. "
        "완벽함보다 '끝까지 완성'이 목표. "
        "완료 기준: 남에게 보여줄 수 있는 결과물 1개가 생긴다.",
    ),
]
_CORE_CLOSING: list[_Step] = [
    (
        "대표 결과물 완성",
        "포트폴리오에 남길 결과물 하나를 제대로 완성한다.",
        "지금까지 배운 것을 모아 '이건 자신 있게 보여줄 수 있다' 싶은 결과물 하나를 만든다. "
        "과정과 배운 점을 짧게 정리해 함께 남긴다. "
        "완료 기준: 포트폴리오/깃허브 등에 공개할 수 있는 결과물 1개.",
    ),
    (
        "실전 기회에 도전",
        "실제 지원·공모전·시험 등에 한 번 부딪혀본다.",
        "학회 지원, 공모전, 대외활동, 자격 시험 등 실제 기회 하나에 지원해본다. "
        "합격 여부보다 '실전 경험'이 목적. "
        "완료 기준: 최소 1곳에 실제로 지원서를 제출한다.",
    ),
    (
        "회고하고 다음 목표 잡기",
        "지금까지를 점검하고 다음 도약점을 정한다.",
        "무엇이 늘었고 무엇이 부족한지 정리하고, 다음에 도달할 구체적 목표를 새로 잡는다. "
        "완료 기준: 다음 3개월 목표를 한 문장으로 적는다.",
    ),
]
# 목표에 따라 0~6개가 중간에 삽입되는 확장 단계 (opening과 closing 사이).
_EXTRA_STEPS: list[_Step] = [
    (
        "심화 주제 파기",
        "{goal}에서 특히 중요한 주제 하나를 깊게 판다.",
        "기초를 넘어 실무에서 자주 쓰이는 심화 주제를 하나 골라 집중적으로 공부한다. "
        "완료 기준: 그 주제로 짧은 정리 글이나 예제를 만든다.",
    ),
    (
        "현직자·선배 만나기",
        "이 길을 먼저 간 사람에게 이야기를 듣는다.",
        "관련 키워드로 현직자나 선배를 찾아 커피챗을 요청하거나 커뮤니티에 참여한다. "
        "특정인을 지목하기보다 '이런 분을 찾아 접촉'하는 감각을 익힌다. "
        "완료 기준: 최소 1명과 대화하거나 커뮤니티 1곳에 가입한다.",
    ),
    (
        "실무 자료로 연습",
        "실제와 비슷한 자료·과제로 연습해본다.",
        "교과서 예제가 아니라 실제에 가까운 데이터·문제로 연습하며 감을 키운다. "
        "완료 기준: 실무형 과제 1개를 처음부터 끝까지 해결한다.",
    ),
    (
        "중간 점검하기",
        "지금까지의 진행을 되돌아보고 계획을 조정한다.",
        "계획대로 되고 있는지 점검하고, 막힌 부분과 남은 시간을 보며 이후 일정을 조정한다. "
        "완료 기준: 남은 마일스톤의 순서·기한을 한 번 다듬는다.",
    ),
    (
        "협업 경험 쌓기",
        "다른 사람과 함께 무언가를 만들어본다.",
        "스터디, 팀 프로젝트, 오픈소스 기여 등 혼자가 아닌 협업 경험을 한 번 쌓는다. "
        "완료 기준: 2명 이상과 함께한 결과물이 1개 생긴다.",
    ),
    (
        "기록하고 공유하기",
        "배운 과정을 글이나 발표로 남겨 공유한다.",
        "학습·프로젝트 과정을 블로그 글, 발표, SNS 등으로 정리해 공개한다. "
        "설명하려다 보면 이해가 단단해진다. "
        "완료 기준: 공개된 기록 1개를 남긴다.",
    ),
]


def _strip_goal(goal_raw_text: str) -> str:
    text = goal_raw_text.strip()
    for suffix in _GOAL_SUFFIXES:
        if text.endswith(suffix):
            return text[: -len(suffix)].strip()
    return text


def _milestone_count(goal_raw_text: str) -> int:
    """목표 텍스트에서 결정적으로 5~8개를 고른다 (내장 hash는 실행마다 달라져 crc32 사용)."""
    spread = MAX_MILESTONES - MIN_MILESTONES + 1
    return MIN_MILESTONES + zlib.crc32(goal_raw_text.strip().encode()) % spread


class MockClaudeClient:
    """네트워크 없는 결정론적 시나리오. 질답은 고정 5문항, 종합은 6~12단계 템플릿."""

    async def chat(
        self,
        goal_raw_text: str,
        messages: list[ChatMessage],
        known_profile: str | None = None,
    ) -> ChatTurn:
        questions = FOLLOWUP_QUESTIONS if known_profile else FIXED_QUESTIONS
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= len(questions):
            return ChatTurn(done=True, question=None)
        return ChatTurn(done=False, question=questions[asked])

    async def extract_intent(self, goal_raw_text: str, messages: list[ChatMessage]) -> CareerIntent:
        goal = goal_raw_text.strip()
        # 아주 단순한 결정론적 키워드 추출 (실제 모델은 훨씬 정교하게)
        stripped = goal
        for suffix in _GOAL_SUFFIXES:
            if stripped.endswith(suffix):
                stripped = stripped[: -len(suffix)].strip()
        keywords = [w for w in stripped.replace(",", " ").split() if len(w) >= 2][:5]
        user_answers = " ".join(m.content for m in messages if m.role == "user")
        return CareerIntent(
            summary=goal,
            direction_keywords=keywords or [stripped or goal],
            current_level=user_answers[:120] or "미상",
        )

    async def select_ncs_job(
        self, intent: CareerIntent, candidates: list[NcsJobOption]
    ) -> str | None:
        """키워드가 직무명에 그대로 들어있는 후보만 고른다 (결정론적).

        실제 모델의 의미 판정 대신 부분일치를 쓰되, **못 찾으면 None을 낸다**는
        핵심 계약은 동일하게 지킨다 — 그래야 폴백 경로가 테스트에서 실행된다.
        """
        for keyword in intent.direction_keywords:
            squished = keyword.replace(" ", "")
            for candidate in candidates:
                if squished and squished in candidate.name.replace(" ", ""):
                    return candidate.code
        return None

    async def synthesize_roadmap(self, context: RoadmapContext) -> GeneratedRoadmapSet:
        goal = context.intent.summary
        count = _milestone_count(goal)
        extras = _EXTRA_STEPS[: count - MIN_MILESTONES]

        # NCS 능력단위가 있으면 앞쪽 단계의 상세(detail)에 녹인다 (그라운딩 흉내).
        unit_names = [u.name for u in context.ability_units[:3]]

        today = date.today()
        span_start, span_end = 14, 180

        def build_milestones(steps: list[_Step]) -> list[GeneratedMilestone]:
            milestones: list[GeneratedMilestone] = []
            denom = max(len(steps) - 1, 1)
            for i, (title, desc_template, detail_template) in enumerate(steps):
                desc = desc_template.format(goal=goal)
                detail = detail_template.format(goal=goal)
                if i < len(unit_names):
                    detail += f" (관련 NCS 능력단위: {unit_names[i]})"
                milestones.append(
                    GeneratedMilestone(
                        title=title,
                        description=desc,
                        detail=detail,
                        due_date=today
                        + timedelta(days=span_start + round((span_end - span_start) * i / denom)),
                    )
                )
            return milestones

        # 대목표 판단 (결정론): 기존 대목표의 핵심 명사가 목표 텍스트에 들어 있으면 재사용.
        stripped = _strip_goal(goal)
        major_goal: MajorGoalDecision | None = None
        for g in context.existing_goals:
            core = g.title.removesuffix(" 되기").strip()
            if core and core in goal:
                major_goal = MajorGoalDecision(
                    existing_goal_id=g.id,
                    title=g.title,
                    context=f"{g.context} / 최근 목표: {goal} (mock 갱신)",
                )
                break
        if major_goal is None:
            major_goal = MajorGoalDecision(
                existing_goal_id=None,
                title=f"{stripped} 되기",
                context=f"현재 수준: {context.intent.current_level} (mock)",
            )

        briefing = (
            f"{stripped}를 이루려면 {', '.join(unit_names[:2]) or '기초 역량과 실전 경험'}이"
            f" 필요해요. 지금 단계에서는 6개월 안에 도달 가능한 '{_CORE_CLOSING[1][0]}' 같은"
            " 소목표부터 도전하는 게 현실적이라, 기초와 실전 두 갈래로 나눴어요."
            " 아래 로드맵이 마음에 들면 심어주세요."
        )
        # 결정론적 2개 세트: 기초(opening+extras) + 실전(closing). #N은 서버가 붙인다.
        return GeneratedRoadmapSet(
            briefing=briefing,
            # dev/프리뷰에서 출처 뱃지 UI가 보이도록 데모 도메인 (실 합성은 웹서치 결과로 채움).
            source_urls=[
                "https://www.jobplanet.co.kr/",
                "https://dacon.io/",
                "https://www.dataq.or.kr/",
            ],
            major_goal=major_goal,
            items=[
                GeneratedRoadmapItem(
                    title=f"{stripped} 기초 다지기",
                    milestones=build_milestones([*_CORE_OPENING, *extras]),
                ),
                GeneratedRoadmapItem(
                    title=f"{stripped} 실전 도전",
                    milestones=build_milestones(_CORE_CLOSING),
                ),
            ],
        )

    async def select_relevant_departments(self, goal_text: str) -> list[str]:
        """목표 텍스트에 포함된 키워드로 결정론적으로 학과/단과대를 고른다.

        매칭되는 키워드가 없으면 빈 리스트 — 실제 모델의 "확신 없으면 비워둔다"는
        계약과 같은 모양을 mock에서도 지킨다(억지 매칭 대신 폴백 경로 테스트용).
        """
        matched: list[str] = []
        for keyword, departments in _DEPARTMENT_KEYWORDS.items():
            if keyword in goal_text:
                for dept in departments:
                    if dept not in matched:
                        matched.append(dept)
        return matched

    async def cluster_courses(
        self, goal_text: str, courses: list[CourseOption]
    ) -> CourseClusterResult:
        """학과별로 결정론적 군집을 만든다 (실제 모델의 의미 판단 대신 그룹핑).

        5000/6000단위는 방어적으로 한 번 더 걸러낸다 — course_clustering 서비스가
        이미 걸러 보내지만, 이 메서드를 단독 호출하는 테스트에서도 계약이 지켜지도록.
        군집 이름은 목표 텍스트에서 파생되므로 고정 목록이 아니다.
        """
        stripped = _strip_goal(goal_text)
        by_department: dict[str, list[CourseOption]] = {}
        for course in courses:
            if course.level is not None and course.level >= 5:
                continue
            key = course.department or "기타"
            by_department.setdefault(key, []).append(course)

        clusters = [
            CourseCluster(
                name=f"{stripped}: {dept}",
                courses=[
                    ClusteredCourse(
                        code=c.code,
                        name=c.name,
                        level=c.level,
                        reason=f"'{stripped}' 목표와 관련된 {dept} 과목",
                    )
                    for c in dept_courses
                ],
            )
            for dept, dept_courses in by_department.items()
        ]
        return CourseClusterResult(clusters=clusters)

    async def research_job(
        self, job_name: str, ability_units: list[AbilityUnitRef]
    ) -> JobResearchResult:
        return JobResearchResult(
            summary=f"{job_name} 직무를 준비하는 학부생을 위한 일반적 활동 요약(mock).",
            activities=["관련 공모전 참가", "개인 프로젝트 공개"],
            academic_societies=["교내 관련 학회", "수도권 연합 학회"],
            expert_insights=["기초 역량을 먼저 쌓고 결과물을 공개하라(요지)"],
            source_urls=[],
        )
