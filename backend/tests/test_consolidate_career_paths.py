"""진로 통합 스크립트(scripts/consolidate_career_paths.py)의 순수 함수 테스트.

LLM·네트워크·Firestore 없음. 커버리지 검증·누락 보충·최종 문서 조립만 검사한다.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "consolidate_career_paths.py"
_spec = importlib.util.spec_from_file_location("consolidate_career_paths", _SCRIPT)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

_RAW = [
    {
        "name": "데이터 분석가",
        "description": "d1",
        "related_departments": ["A"],
        "job_fields": ["x"],
        "cert_hints": ["ADsP"],
    },
    {
        "name": "데이터 사이언티스트",
        "description": "d2",
        "related_departments": ["B"],
        "job_fields": ["x"],
        "cert_hints": ["SQLD"],
    },
    {
        "name": "보험계리사",
        "description": "d3",
        "related_departments": ["B"],
        "job_fields": ["y"],
        "cert_hints": ["보험계리사"],
    },
]


def _names() -> list[str]:
    return [p["name"] for p in _RAW]


def test_check_coverage_reports_missing_and_duplicates() -> None:
    paths = [
        {"variants": ["데이터 분석가", "데이터  사이언티스트"]},
        {"variants": ["데이터 분석가"]},
    ]
    missing, duplicated = mod.check_coverage(_names(), paths)
    assert missing == ["보험계리사"]
    assert duplicated == [mod.normalize_name("데이터 분석가")]


def test_append_missing_adds_singleton_flagged() -> None:
    paths = [{"name": "데이터 전문가", "variants": ["데이터 분석가", "데이터 사이언티스트"]}]
    paths = mod.append_missing(paths, _RAW, ["보험계리사"])
    assert paths[-1]["name"] == "보험계리사"
    assert paths[-1]["auto_appended"] is True
    assert paths[-1]["variants"] == ["보험계리사"]
    assert mod.check_coverage(_names(), paths) == ([], [])


def test_finalize_assigns_ids_and_dedupes_lists() -> None:
    paths = [
        {
            "name": "데이터 전문가",
            "description": "d",
            "primary_field": "통계·데이터",
            "related_departments": ["A", "B", "A"],
            "job_fields": ["x", "x"],
            "cert_hints": ["ADsP", "adsp", "SQLD"],
            "variants": ["데이터 분석가", "데이터 사이언티스트"],
        }
    ]
    meta = {"generated_at": "g", "departments": ["A", "B"]}
    doc = mod.finalize(paths, "2026-09-05T00:00:00+00:00", meta)
    cp = doc["career_paths"][0]
    assert cp["id"] == "cp-01"
    assert cp["related_departments"] == ["A", "B"]
    assert cp["job_fields"] == ["x"]
    assert cp["cert_hints"] == ["ADsP", "SQLD"]
    assert cp["source"] == "llm_consolidated" and cp["reviewed"] is False
    assert doc["source_draft_generated_at"] == "g"


def test_enrich_from_draft_unions_from_variants() -> None:
    paths = [
        {"name": "데이터 전문가", "variants": ["데이터 분석가", "데이터 사이언티스트", "없는이름"]}
    ]
    out = mod.enrich_from_draft(paths, _RAW)
    assert out[0]["related_departments"] == ["A", "B"]
    assert out[0]["job_fields"] == ["x"]
    assert out[0]["cert_hints"] == ["ADsP", "SQLD"]
