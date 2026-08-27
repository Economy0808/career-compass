import pytest

from app.domain.constellation import NodeTypes
from app.llm.mock_client import MockClaudeClient

_VALID_TYPES = {
    NodeTypes.CERTIFICATION,
    NodeTypes.ORGANIZATION,
    NodeTypes.ACTIVITY,
    NodeTypes.NETWORKING,
}


@pytest.mark.asyncio
async def test_suggest_support_elements_returns_nonempty_bins_for_plausible_goal() -> None:
    llm = MockClaudeClient()
    result = await llm.suggest_support_elements("데이터 분석가가 되고 싶다")

    assert result.bins  # 비어있지 않음
    for cluster_bin in result.bins:
        assert cluster_bin.name
        assert cluster_bin.elements


@pytest.mark.asyncio
async def test_suggest_support_elements_types_are_valid_node_types() -> None:
    """모든 element.type이 NodeTypes 상수 값 중 하나여야 한다 — 프론트가 모르는
    타입을 받으면 렌더링이 깨진다."""
    llm = MockClaudeClient()
    result = await llm.suggest_support_elements("전략 컨설턴트가 되고 싶다")

    assert result.bins
    for cluster_bin in result.bins:
        for element in cluster_bin.elements:
            assert element.type in _VALID_TYPES


@pytest.mark.asyncio
async def test_suggest_support_elements_advice_present_and_mock_marked() -> None:
    """각 군집은 advice(코치 코멘트)를 채워야 하고, mock 결과임이 표시돼야 한다."""
    llm = MockClaudeClient()
    result = await llm.suggest_support_elements("전략 컨설턴트가 되고 싶다")

    assert result.bins
    for cluster_bin in result.bins:
        assert cluster_bin.advice is not None
        assert "(mock)" in cluster_bin.advice


@pytest.mark.asyncio
async def test_suggest_support_elements_empty_goal_degrades_to_empty() -> None:
    """빈 문자열/공백만 있는 목표는 예외 없이 빈 결과로 degrade한다 —
    select_relevant_departments의 '확신 없으면 빈 리스트' 계약과 동일한 모양."""
    llm = MockClaudeClient()

    empty_result = await llm.suggest_support_elements("")
    assert empty_result.bins == []

    whitespace_result = await llm.suggest_support_elements("   ")
    assert whitespace_result.bins == []


@pytest.mark.asyncio
async def test_suggest_support_elements_rules_context_none_still_works() -> None:
    """rules_context를 안 넘겨도(기본값 None) 기존 호출부는 그대로 동작해야 한다."""
    llm = MockClaudeClient()
    result = await llm.suggest_support_elements("전략 컨설턴트가 되고 싶다", rules_context=None)
    assert result.bins

    result_default = await llm.suggest_support_elements("전략 컨설턴트가 되고 싶다")
    assert result_default.bins


@pytest.mark.asyncio
async def test_suggest_support_elements_labels_derive_from_goal_keywords() -> None:
    """결정론적 mock: 목표 키워드에 매칭되는 자격증이 label에 반영돼야 한다."""
    llm = MockClaudeClient()
    result = await llm.suggest_support_elements("데이터 분석가가 되고 싶다")

    cert_bin = next(b for b in result.bins if b.name.endswith("자격증"))
    labels = [e.label for e in cert_bin.elements]
    assert any("ADsP" in label for label in labels)
