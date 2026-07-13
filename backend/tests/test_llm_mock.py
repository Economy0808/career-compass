import pytest

from app.llm import get_llm_client
from app.llm.base import ChatMessage
from app.llm.mock_client import FIXED_QUESTIONS, MockClaudeClient


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
async def test_generate_roadmap_returns_five_milestones_with_increasing_due_dates() -> None:
    client = MockClaudeClient()
    goal = "데이터 분석가가 되고 싶어"
    result = await client.generate_roadmap(goal, messages=[])

    assert result.title == "데이터 분석가 로드맵"
    assert len(result.milestones) == 5
    due_dates = [m.due_date for m in result.milestones]
    assert due_dates == sorted(due_dates)
    assert goal in result.milestones[0].description


@pytest.mark.asyncio
async def test_get_llm_client_returns_mock_instance() -> None:
    client = get_llm_client()
    assert isinstance(client, MockClaudeClient)
