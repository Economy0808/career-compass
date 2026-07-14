"""실제 Claude API 없이 전체 플로우를 테스트하기 위한 결정론적 Mock 구현체.

ANTHROPIC_API_KEY/anthropic SDK가 준비되면 이 파일 대신 실제 Anthropic
클라이언트를 구현하고, app/llm/__init__.py의 get_llm_client()만 바꾸면 된다.

마일스톤 개수는 "최소 5개, 목표에 따라 가변" 정책을 따른다 — 실제 LLM은
필요한 만큼 세우고, Mock은 목표 텍스트에서 결정적으로 5~8개를 만든다
(같은 목표는 항상 같은 결과 → 테스트 재현 가능).
"""
import zlib
from datetime import date, timedelta

from app.llm.base import ChatMessage, ChatTurn, GeneratedMilestone, GeneratedRoadmap

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
    """최소 3개 질문 후 종료하는 고정 시나리오. generate_roadmap은 목표 텍스트를
    템플릿에 끼워 5~8개 마일스톤을 결정적으로 만들어낸다."""

    async def chat(self, goal_raw_text: str, messages: list[ChatMessage]) -> ChatTurn:
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= len(FIXED_QUESTIONS):
            return ChatTurn(done=True, question=None)
        return ChatTurn(done=False, question=FIXED_QUESTIONS[asked])

    async def generate_roadmap(
        self, goal_raw_text: str, messages: list[ChatMessage]
    ) -> GeneratedRoadmap:
        count = _milestone_count(goal_raw_text)
        extras = _EXTRA_STEPS[: count - MIN_MILESTONES]
        steps = [*_CORE_OPENING, *extras, *_CORE_CLOSING]

        # 마감일은 14일~100일 사이에 균등 배치.
        today = date.today()
        span_start, span_end = 14, 100
        milestones = [
            GeneratedMilestone(
                title=title,
                description=desc_template.format(goal=goal_raw_text),
                due_date=today
                + timedelta(
                    days=span_start + round((span_end - span_start) * i / (len(steps) - 1))
                ),
            )
            for i, (title, desc_template) in enumerate(steps)
        ]
        return GeneratedRoadmap(title=_derive_title(goal_raw_text), milestones=milestones)
