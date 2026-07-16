"""실제 Claude API 없이 전체 플로우를 테스트하기 위한 결정론적 Mock 구현체.

네트워크를 전혀 쓰지 않으므로 개발·테스트 비용이 $0이다. 종합은 목표 텍스트에서
결정적으로 5~8개 마일스톤을 만들고(같은 입력=같은 결과), NCS 능력단위가 주어지면
설명에 가볍게 녹여 그라운딩 흉내를 낸다. research_job도 canned 결과를 돌려준다.

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
    GeneratedMilestone,
    GeneratedRoadmap,
    JobResearchResult,
    RoadmapContext,
)

MIN_MILESTONES = 5
MAX_MILESTONES = 8

FIXED_QUESTIONS = [
    "그 목표는 언제까지 이루고 싶으신가요?",
    "지금까지 이 분야에서 해본 경험이나 준비가 있나요?",
    "하루에 이 목표를 위해 쓸 수 있는 시간은 대략 어느 정도인가요?",
]

_GOAL_SUFFIXES = ("이 되고 싶어", "가 되고 싶어", "하고 싶어", "하고싶어", "되고 싶어")

# 핵심 5단계: 어떤 로드맵에도 들어가는 뼈대 (마지막은 항상 회고).
_CORE_OPENING: list[tuple[str, str]] = [
    ("기초 다지기", "{goal} 관련 기초 개념과 필수 지식을 학습합니다."),
    ("실전 연습", "배운 내용을 작은 프로젝트나 연습으로 적용해봅니다."),
]
_CORE_CLOSING: list[tuple[str, str]] = [
    ("결과물 만들기", "포트폴리오나 결과물로 남길 수 있는 작업을 완성합니다."),
    ("실전 도전", "실제 기회(지원, 시험, 공모전 등)에 도전합니다."),
    ("회고 및 다음 단계 설정", "진행 상황을 점검하고 다음 목표를 구체화합니다."),
]
# 목표에 따라 0~3개가 중간에 삽입되는 확장 단계.
_EXTRA_STEPS: list[tuple[str, str]] = [
    ("사람 만나기", "현직자·선배와 커피챗을 하고 관련 커뮤니티에 참여합니다."),
    ("심화 학습", "{goal}에 필요한 심화 주제를 골라 깊게 파봅니다."),
    ("중간 점검", "지금까지의 진행을 되돌아보고 계획을 조정합니다."),
]


def _derive_title(goal_raw_text: str) -> str:
    text = goal_raw_text.strip()
    for suffix in _GOAL_SUFFIXES:
        if text.endswith(suffix):
            return f"{text[: -len(suffix)].strip()} 로드맵"
    return f"{text} 로드맵"


def _milestone_count(goal_raw_text: str) -> int:
    """목표 텍스트에서 결정적으로 5~8개를 고른다 (내장 hash는 실행마다 달라져 crc32 사용)."""
    spread = MAX_MILESTONES - MIN_MILESTONES + 1
    return MIN_MILESTONES + zlib.crc32(goal_raw_text.strip().encode()) % spread


class MockClaudeClient:
    """네트워크 없는 결정론적 시나리오. 질답은 고정 3문항, 종합은 5~8단계 템플릿."""

    async def chat(self, goal_raw_text: str, messages: list[ChatMessage]) -> ChatTurn:
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= len(FIXED_QUESTIONS):
            return ChatTurn(done=True, question=None)
        return ChatTurn(done=False, question=FIXED_QUESTIONS[asked])

    async def extract_intent(
        self, goal_raw_text: str, messages: list[ChatMessage]
    ) -> CareerIntent:
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

    async def synthesize_roadmap(self, context: RoadmapContext) -> GeneratedRoadmap:
        goal = context.intent.summary
        count = _milestone_count(goal)
        extras = _EXTRA_STEPS[: count - MIN_MILESTONES]
        steps = [*_CORE_OPENING, *extras, *_CORE_CLOSING]

        # NCS 능력단위가 있으면 앞쪽 단계 설명에 가볍게 녹인다 (그라운딩 흉내).
        unit_names = [u.name for u in context.ability_units[:3]]

        today = date.today()
        span_start, span_end = 14, 100
        milestones: list[GeneratedMilestone] = []
        for i, (title, desc_template) in enumerate(steps):
            desc = desc_template.format(goal=goal)
            if i < len(unit_names):
                desc += f" (NCS 능력단위: {unit_names[i]})"
            milestones.append(
                GeneratedMilestone(
                    title=title,
                    description=desc,
                    due_date=today
                    + timedelta(
                        days=span_start + round((span_end - span_start) * i / (len(steps) - 1))
                    ),
                )
            )
        return GeneratedRoadmap(title=_derive_title(goal), milestones=milestones)

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
