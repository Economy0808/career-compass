import pytest

from app.llm import get_llm_client
from app.llm.base import ChatMessage
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
async def test_generate_roadmap_returns_variable_milestones_with_increasing_due_dates() -> None:
    client = MockClaudeClient()
    goal = "데이터 분석가가 되고 싶어"
    result = await client.generate_roadmap(goal, messages=[])

    assert result.title == "데이터 분석가 로드맵"
    # 최소 5개는 보장하되 개수는 목표에 따라 가변 (5개 고정 금지)
    assert MIN_MILESTONES <= len(result.milestones) <= MAX_MILESTONES
    due_dates = [m.due_date for m in result.milestones]
    assert due_dates == sorted(due_dates)
    assert len(set(due_dates)) == len(due_dates)  # 마감일 중복 없음
    assert goal in result.milestones[0].description


@pytest.mark.asyncio
async def test_generate_roadmap_is_deterministic_per_goal_but_varies_across_goals() -> None:
    client = MockClaudeClient()
    goal = "데이터 분석가가 되고 싶어"
    first = await client.generate_roadmap(goal, messages=[])
    second = await client.generate_roadmap(goal, messages=[])
    assert [m.title for m in first.milestones] == [m.title for m in second.milestones]

    sample_goals = [
        "데이터 분석가가 되고 싶어",
        "백엔드 개발자 되기",
        "교환학생 가기",
        "회계사 시험 합격",
        "UX 디자이너 전환",
        "창업하기",
        "대학원 진학",
        "변리사 되기",
    ]
    counts = {_milestone_count(g) for g in sample_goals}
    assert len(counts) > 1, "마일스톤 개수가 목표와 무관하게 고정되면 안 된다"


@pytest.mark.asyncio
async def test_get_llm_client_returns_mock_instance() -> None:
    client = get_llm_client()
    assert isinstance(client, MockClaudeClient)
