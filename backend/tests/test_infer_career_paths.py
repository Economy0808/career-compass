"""infer_career_paths.py의 순수 함수 단위 테스트 - Firestore/LLM 호출 없이 실행된다.

학과 키워드 선정, 진로 dedupe/병합, 출력 JSON 형태만 검증한다(스크립트의 나머지는
실제 Firestore 읽기와 실제 LLM 호출이라 이 파일에서는 다루지 않는다 - 네트워크 없음).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from infer_career_paths import (  # noqa: E402
    build_output,
    dedupe_paths,
    normalize_path_name,
    select_departments,
)


class TestSelectDepartments:
    def test_matches_keyword_in_department_name(self):
        depts = ["경영학과", "철학과", "컴퓨터과학과"]
        assert select_departments(depts) == ["경영학과", "컴퓨터과학과"]

    def test_ignores_unmatched_departments(self):
        depts = ["철학과", "사학과", "국어국문학과"]
        assert select_departments(depts) == []

    def test_includes_expanded_set_from_college_match(self):
        depts = ["철학과"]
        expanded = {"전기전자공학부"}
        assert select_departments(depts, expanded) == ["전기전자공학부"]

    def test_caps_and_prioritizes_primary_field_matches(self):
        # 5개 초과 매칭 - cap=3이면 PILOT_FIELDS(경영/경제/통계/컴퓨터/공학) 직접 포함
        # 학과가 확장 키워드(정보)로만 걸린 학과보다 우선 채택돼야 한다.
        depts = ["경영학과", "경제학과", "정보대학원학과", "정보사회학과"]
        result = select_departments(depts, cap=3)
        assert len(result) == 3
        assert "경영학과" in result
        assert "경제학과" in result

    def test_no_cap_needed_returns_all_sorted(self):
        depts = ["컴퓨터과학과", "경영학과"]
        assert select_departments(depts, cap=25) == ["경영학과", "컴퓨터과학과"]


class TestNormalizePathName:
    def test_strips_whitespace_and_lowercases(self):
        assert normalize_path_name(" 데이터 사이언티스트 ") == normalize_path_name(
            "데이터사이언티스트"
        )

    def test_different_names_normalize_differently(self):
        assert normalize_path_name("백엔드 개발자") != normalize_path_name("프론트엔드 개발자")


class TestDedupePaths:
    def test_merges_same_name_across_departments(self):
        raw = [
            {
                "name": "데이터 사이언티스트",
                "description": "데이터로 의사결정을 돕는다.",
                "related_departments": ["응용통계학과"],
                "job_fields": ["정보기술"],
                "cert_hints": ["ADsP"],
            },
            {
                "name": "데이터 사이언티스트",
                "description": "다른 설명(무시돼야 함).",
                "related_departments": ["컴퓨터과학과"],
                "job_fields": ["정보기술", "금융·보험"],
                "cert_hints": ["ADsP", "SQLD"],
            },
        ]
        merged = dedupe_paths(raw)
        assert len(merged) == 1
        entry = merged[0]
        assert entry["description"] == "데이터로 의사결정을 돕는다."
        assert entry["related_departments"] == ["응용통계학과", "컴퓨터과학과"]
        assert entry["job_fields"] == ["정보기술", "금융·보험"]
        assert entry["cert_hints"] == ["ADsP", "SQLD"]

    def test_distinct_names_stay_separate_and_ordered(self):
        raw = [
            {
                "name": "A",
                "description": "",
                "related_departments": [],
                "job_fields": [],
                "cert_hints": [],
            },
            {
                "name": "B",
                "description": "",
                "related_departments": [],
                "job_fields": [],
                "cert_hints": [],
            },
        ]
        merged = dedupe_paths(raw)
        assert [m["name"] for m in merged] == ["A", "B"]

    def test_empty_input_returns_empty(self):
        assert dedupe_paths([]) == []


class TestBuildOutput:
    def test_shape_and_slug_ids(self):
        paths = [
            {
                "name": "데이터 사이언티스트",
                "description": "설명",
                "related_departments": ["응용통계학과"],
                "job_fields": ["정보기술"],
                "cert_hints": ["ADsP"],
            }
        ]
        output = build_output(["응용통계학과"], paths, "2026-09-05T00:00:00+00:00")
        assert output["generated_at"] == "2026-09-05T00:00:00+00:00"
        assert output["pilot_fields"] == ["경영", "경제", "통계", "컴퓨터", "공학"]
        assert output["departments"] == ["응용통계학과"]
        assert len(output["career_paths"]) == 1
        item = output["career_paths"][0]
        assert item["id"] == "path-01"
        assert item["name"] == "데이터 사이언티스트"
        assert item["source"] == "llm_inferred"
        assert item["reviewed"] is False

    def test_empty_paths_returns_empty_list(self):
        output = build_output([], [], "2026-09-05T00:00:00+00:00")
        assert output["career_paths"] == []
