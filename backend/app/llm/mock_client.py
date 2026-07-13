"""실제 Claude API 없이 전체 플로우를 테스트하기 위한 결정론적 Mock 구현체.

ANTHROPIC_API_KEY/anthropic SDK가 준비되면 이 파일 대신 실제 Anthropic
클라이언트를 구현하고, app/llm/__init__.py의 get_llm_client()만 바꾸면 된다.
"""
from datetime import date, timedelta

from app.llm.base import ChatMessage, ChatTurn, GeneratedMilestone, GeneratedRoadmap

FIXED_QUESTIONS = [
    "그 목표는 언제까지 이루고 싶으신가요?",
    "지금까지 이 분야에서 해본 경험이나 준비가 있나요?",
    "하루에 이 목표를 위해 쓸 수 있는 시간은 대략 어느 정도인가요?",
]

_GOAL_SUFFIXES = ("이 되고 싶어", "가 되고 싶어", "하고 싶어", "하고싶어", "되고 싶어")

_TEMPLATE_STEPS: list[tuple[str, str, int]] = [
    ("기초 다지기", "{goal} 관련 기초 개념과 필수 지식을 학습합니다.", 14),
    ("실전 연습", "배운 내용을 작은 프로젝트나 연습으로 적용해봅니다.", 30),
    ("결과물 만들기", "포트폴리오나 결과물로 남길 수 있는 작업을 완성합니다.", 55),
    ("실전 도전", "실제 기회(지원, 시험, 공모전 등)에 도전합니다.", 80),
    ("회고 및 다음 단계 설정", "진행 상황을 점검하고 다음 목표를 구체화합니다.", 100),
]


def _derive_title(goal_raw_text: str) -> str:
    text = goal_raw_text.strip()
    for suffix in _GOAL_SUFFIXES:
        if text.endswith(suffix):
            return f"{text[: -len(suffix)].strip()} 로드맵"
    return f"{text} 로드맵"


class MockClaudeClient:
    """최소 3개 질문 후 종료하는 고정 시나리오. generate_roadmap은 목표 텍스트를
    템플릿에 끼워 5개 마일스톤을 결정적으로 만들어낸다."""

    async def chat(self, goal_raw_text: str, messages: list[ChatMessage]) -> ChatTurn:
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= len(FIXED_QUESTIONS):
            return ChatTurn(done=True, question=None)
        return ChatTurn(done=False, question=FIXED_QUESTIONS[asked])

    async def generate_roadmap(
        self, goal_raw_text: str, messages: list[ChatMessage]
    ) -> GeneratedRoadmap:
        today = date.today()
        milestones = [
            GeneratedMilestone(
                title=title,
                description=desc_template.format(goal=goal_raw_text),
                due_date=today + timedelta(days=offset),
            )
            for title, desc_template, offset in _TEMPLATE_STEPS
        ]
        return GeneratedRoadmap(title=_derive_title(goal_raw_text), milestones=milestones)
