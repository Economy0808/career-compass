"""MockClaudeClient.suggest_draft_constellations 단위 테스트 (Firestore 불필요).

이 메서드는 Firestore도 웹서치도 쓰지 않고 넘겨받은 bins_payload만으로 결정론적으로
구성하므로, test_bin_suggestion.py처럼 에뮬레이터가 필요 없다 - test_llm_support_elements.py
와 동일한 결의 순수 mock 단위 테스트.

새 계약(성단 전체 배치): 시안은 항목을 발췌하지 않는다 - drafts는 bins의 label
중 핵심 군집(core_bin_labels)과 그 사이 학습 경로(bin_edges)만 다르게 낸다.
"""

import pytest

from app.llm.mock_client import MockClaudeClient

_GOAL = "데이터 분석가가 되고 싶다"


def _bins(label_count: int) -> list[dict]:
    """label_count개의 서로 다른 label을 가진 bin 목록을 만든다(items는 이 계약에서 안 쓰인다)."""
    return [{"id": f"bin-{i}", "label": f"군집{i:02d}", "items": []} for i in range(label_count)]


@pytest.mark.asyncio
async def test_suggest_draft_constellations_empty_bins_returns_no_drafts() -> None:
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, [])

    assert result.drafts == []


@pytest.mark.asyncio
async def test_suggest_draft_constellations_too_few_bins_returns_no_drafts() -> None:
    """군집이 core 최소 개수(2개)도 못 채우면 초안으로서 의미가 없어 빈 리스트로 degrade한다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(1))

    assert result.drafts == []


@pytest.mark.asyncio
async def test_suggest_draft_constellations_small_bins_yields_fewer_drafts() -> None:
    """군집이 초안 3개(각 2~4개)를 다 채울 만큼 없으면(5개 -> 3+2) 초안은 2개로 준다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(5))

    assert len(result.drafts) == 2


@pytest.mark.asyncio
async def test_suggest_draft_constellations_plenty_of_bins_yields_exactly_three() -> None:
    """군집이 충분하면(12개) 초안 3개가 나오고, 각 초안은 core 2~4개를 받는다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(12))

    assert len(result.drafts) == 3
    for draft in result.drafts:
        assert 2 <= len(draft.core_bin_labels) <= 4


@pytest.mark.asyncio
async def test_suggest_draft_constellations_core_labels_are_subset_of_bins() -> None:
    """모든 draft.core_bin_labels/bin_edges는 넘겨준 bins_payload의 label 안에서만 골라야 한다(환각 방지 계약)."""
    llm = MockClaudeClient()
    bins_payload = _bins(12)
    known_labels = {b["label"] for b in bins_payload}

    result = await llm.suggest_draft_constellations(_GOAL, bins_payload)

    for draft in result.drafts:
        assert draft.name
        assert set(draft.core_bin_labels) <= known_labels
        core_set = set(draft.core_bin_labels)
        for a, b in draft.bin_edges:
            assert a in core_set
            assert b in core_set


@pytest.mark.asyncio
async def test_suggest_draft_constellations_is_deterministic() -> None:
    """같은 입력이면 같은 결과 - mock 전체의 핵심 계약(네트워크 없는 재현 가능성)."""
    llm = MockClaudeClient()
    bins_payload = _bins(12)

    first = await llm.suggest_draft_constellations(_GOAL, bins_payload)
    second = await llm.suggest_draft_constellations(_GOAL, bins_payload)

    assert [d.core_bin_labels for d in first.drafts] == [d.core_bin_labels for d in second.drafts]
    assert [d.name for d in first.drafts] == [d.name for d in second.drafts]


@pytest.mark.asyncio
async def test_suggest_draft_constellations_core_labels_disjoint_across_drafts() -> None:
    """세 초안은 서로 다른 핵심 군집 조합이어야 한다 - 같은 label이 두 초안에 겹치면 안 된다.

    새 계약에서 bins 자체는 모든 초안에 항상 전부 표시되므로, 초안 간 차이는
    오직 무엇을 core로 강조하느냐다 - 그래서 mock도 core 조합을 상호 배타적으로 만든다.
    """
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(9))

    assert len(result.drafts) == 3
    seen_labels: set[str] = set()
    for draft in result.drafts:
        core_set = set(draft.core_bin_labels)
        assert core_set, "각 초안은 핵심 군집을 가져야 한다"
        assert not (core_set & seen_labels), "핵심 군집 label이 두 초안에 겹치면 안 된다"
        seen_labels |= core_set


@pytest.mark.asyncio
async def test_suggest_draft_constellations_edges_form_a_path_within_core() -> None:
    """bin_edges는 그 초안의 core_bin_labels를 순서대로 잇는 경로여야 한다."""
    llm = MockClaudeClient()

    result = await llm.suggest_draft_constellations(_GOAL, _bins(12))

    for draft in result.drafts:
        assert len(draft.bin_edges) == len(draft.core_bin_labels) - 1
        expected = [
            (draft.core_bin_labels[i], draft.core_bin_labels[i + 1])
            for i in range(len(draft.core_bin_labels) - 1)
        ]
        assert draft.bin_edges == expected
