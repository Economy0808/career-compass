"""MockClaudeClient.suggest_draft_constellations 단위 테스트 (Firestore 불필요).

이 메서드는 Firestore도 웹서치도 쓰지 않고 넘겨받은 bins_payload만으로 결정론적으로
구성하므로, test_bin_suggestion.py처럼 에뮬레이터가 필요 없다 - test_llm_support_elements.py
와 동일한 결의 순수 mock 단위 테스트.
"""

import pytest

from app.llm.mock_client import MockClaudeClient

_GOAL = "데이터 분석가가 되고 싶다"


def _bins(item_count: int) -> list[dict]:
    """item_count개의 항목을 담은 bin 하나짜리 wire-ready bins_payload를 만든다."""
    items = [
        {"id": f"course:C{i:03d}", "label": f"과목{i}", "type": "course"} for i in range(item_count)
    ]
    return [{"id": "bin-1", "label": "테스트 보관함", "items": items}]


@pytest.mark.asyncio
async def test_suggest_draft_constellations_empty_bins_returns_no_drafts() -> None:
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, [])

    assert result.drafts == []


@pytest.mark.asyncio
async def test_suggest_draft_constellations_too_few_items_returns_no_drafts() -> None:
    """항목이 3개 미만이면 초안으로서 의미가 없어 빈 리스트로 degrade한다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(2))

    assert result.drafts == []


@pytest.mark.asyncio
async def test_suggest_draft_constellations_small_bins_yields_fewer_drafts() -> None:
    """bins가 3개짜리 초안 하나만 채울 만큼 작으면(15개 -> 7+7+1) 초안은 2개로 준다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(15))

    assert len(result.drafts) == 2


@pytest.mark.asyncio
async def test_suggest_draft_constellations_plenty_of_items_yields_exactly_three() -> None:
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(20))

    assert len(result.drafts) == 3
    # 20개가 7+7+6으로 남김없이 소진돼야 한다.
    assert sum(len(d.item_ids) for d in result.drafts) == 20


@pytest.mark.asyncio
async def test_suggest_draft_constellations_item_ids_are_subset_of_bins() -> None:
    """모든 draft.item_ids는 넘겨준 bins_payload의 id 안에서만 골라야 한다(환각 방지 계약)."""
    llm = MockClaudeClient()
    bins_payload = _bins(20)
    known_ids = {item["id"] for b in bins_payload for item in b["items"]}

    result = await llm.suggest_draft_constellations(_GOAL, bins_payload)

    for draft in result.drafts:
        assert draft.name
        assert set(draft.item_ids) <= known_ids
        item_id_set = set(draft.item_ids)
        for a, b in draft.edges:
            assert a in item_id_set
            assert b in item_id_set


@pytest.mark.asyncio
async def test_suggest_draft_constellations_is_deterministic() -> None:
    """같은 입력이면 같은 결과 - mock 전체의 핵심 계약(네트워크 없는 재현 가능성)."""
    llm = MockClaudeClient()
    bins_payload = _bins(20)

    first = await llm.suggest_draft_constellations(_GOAL, bins_payload)
    second = await llm.suggest_draft_constellations(_GOAL, bins_payload)

    assert [d.item_ids for d in first.drafts] == [d.item_ids for d in second.drafts]
    assert [d.name for d in first.drafts] == [d.name for d in second.drafts]
