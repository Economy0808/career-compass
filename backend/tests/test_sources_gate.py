"""출처 레지스트리 보안 게이트(app/etl/sources.py) 유닛 테스트.

네트워크/Firestore 의존성 없음 - 순수 함수 + 인라인 dict 픽스처만 사용한다.
"""

from __future__ import annotations

import pytest

from app.etl.sources import SourceGateError, assert_source_allowed, load_sources

_FIXTURE_SOURCES = {
    "kogl1": {"source_type": "government_open_data", "kogl_type": 1},
    "kogl2": {"source_type": "government_open_data", "kogl_type": 2},
    "kogl3": {"source_type": "government_open_data", "kogl_type": 3},
    "kogl4": {"source_type": "government_open_data", "kogl_type": 4},
    "kogl_none": {"source_type": "government_open_data", "kogl_type": None},
    "kogl_missing": {"source_type": "government_open_data"},
    "kogl_todo": {"source_type": "government_open_data", "kogl_type": "TODO"},
    "crowd": {"source_type": "crowdsource", "kogl_type": None},
}


def test_kogl1_passes_display_and_llm() -> None:
    assert_source_allowed("kogl1", for_llm=False, sources=_FIXTURE_SOURCES)
    assert_source_allowed("kogl1", for_llm=True, sources=_FIXTURE_SOURCES)


def test_kogl3_passes_display_but_rejects_llm() -> None:
    assert_source_allowed("kogl3", for_llm=False, sources=_FIXTURE_SOURCES)
    with pytest.raises(SourceGateError):
        assert_source_allowed("kogl3", for_llm=True, sources=_FIXTURE_SOURCES)


@pytest.mark.parametrize("source_id", ["kogl2", "kogl4", "kogl_none", "kogl_missing", "kogl_todo"])
def test_disallowed_kogl_types_rejected(source_id: str) -> None:
    with pytest.raises(SourceGateError):
        assert_source_allowed(source_id, for_llm=False, sources=_FIXTURE_SOURCES)


def test_crowdsource_exempt() -> None:
    assert_source_allowed("crowd", for_llm=False, sources=_FIXTURE_SOURCES)
    assert_source_allowed("crowd", for_llm=True, sources=_FIXTURE_SOURCES)


def test_unknown_source_rejected() -> None:
    with pytest.raises(SourceGateError):
        assert_source_allowed("does_not_exist", sources=_FIXTURE_SOURCES)


def test_real_sources_yaml_data_go_kr_entries_pass_display_gate() -> None:
    """실제 sources.yml이 로드되고, data.go.kr 두 소스가 표시 게이트를 통과하는지 고정한다."""
    registry = load_sources()
    assert_source_allowed("data_go_kr_15003024_jongmok_list", for_llm=False, sources=registry)
    assert_source_allowed("data_go_kr_15074408_exam_schedule", for_llm=False, sources=registry)
