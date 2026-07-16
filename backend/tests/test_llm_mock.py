import pytest

from app.llm import get_llm_client
from app.llm.base import AbilityUnitRef, ChatMessage, RoadmapContext
from app.llm.mock_client import (
    FIXED_QUESTIONS,
    MAX_MILESTONES,
    MIN_MILESTONES,
    MockClaudeClient,
    _milestone_count,
)


@pytest.mark.asyncio
async def test_chat_asks_minimum_three_questions_then_done() -> None:
    client = MockClaudeClient()
    goal = "데이터 분석가가 되고 싶어"
    messages: list[ChatMessage] = []

    for expected_question in FIXED_QUESTIONS:
        turn = await client.chat(goal, messages)
        assert turn.done is False
        assert turn.question == expected_question
        messages.append(ChatMessage(role="assistant", content=turn.question))
        messages.append(ChatMessage(role="user", content="답변입니다"))

    final_turn = await client.chat(goal, messages)
    assert final_turn.done is True
    assert final_turn.question is None


@pytest.mark.asyncio
async def test_extract_intent_is_deterministic() -> None:
    client = MockClaudeClient()
    goal = "데이터 분석가가 되고 싶어"
    intent = await client.extract_intent(goal, [ChatMessage(role="user", content="1학년입니다")])
    assert intent.summary == goal
    assert intent.direction_keywords  # 비어있지 않음
    assert "1학년" in intent.current_level


@pytest.mark.asyncio
async def test_synthesize_returns_variable_milestones() -> None:
    client = MockClaudeClient()
    intent = await client.extract_intent("데이터 분석가가 되고 싶어", [])
    result = await client.synthesize_roadmap(RoadmapContext(intent=intent))

    assert result.title == "데이터 분석가 로드맵"
    assert MIN_MILESTONES <= len(result.milestones) <= MAX_MILESTONES
    due_dates = [m.due_date for m in result.milestones]
    assert due_dates == sorted(due_dates)
    assert len(set(due_dates)) == len(due_dates)  # 마감일 중복 없음


@pytest.mark.asyncio
async def test_synthesize_grounds_on_ncs_ability_units() -> None:
    client = MockClaudeClient()
    intent = await client.extract_intent("데이터 분석가가 되고 싶어", [])
    ctx = RoadmapContext(
        intent=intent,
        ncs_job_name="데이터분석",
        ability_units=[AbilityUnitRef(code="A1", name="통계적 가설검정")],
    )
    result = await client.synthesize_roadmap(ctx)
    # 첫 마일스톤 설명에 능력단위가 녹아든다
    assert any("통계적 가설검정" in m.description for m in result.milestones)


def test_milestone_count_is_deterministic_and_varies() -> None:
    goals = [
        "데이터 분석가가 되고 싶어",
        "백엔드 개발자 되기",
        "교환학생 가기",
        "회계사 시험 합격",
        "UX 디자이너 전환",
        "창업하기",
    ]
    for g in goals:
        assert _milestone_count(g) == _milestone_count(g)  # 재현성
        assert MIN_MILESTONES <= _milestone_count(g) <= MAX_MILESTONES
    assert len({_milestone_count(g) for g in goals}) > 1  # 목표마다 달라짐


@pytest.mark.asyncio
async def test_research_job_returns_canned_without_network() -> None:
    client = MockClaudeClient()
    result = await client.research_job("데이터분석", [])
    assert result.summary
    assert result.academic_societies  # 학회 포함
    assert result.source_urls == []  # Mock은 출처 없음


def test_factory_returns_mock_without_key() -> None:
    # test 환경 + 키 없음 → Mock
    assert isinstance(get_llm_client(), MockClaudeClient)
