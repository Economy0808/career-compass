"""학과 교과과정 기반 "진로(career path)" 파일럿 초안 추론 스크립트 (창업자 검토용, 1회성).

Phase 1: 자격증을 평평한 목록이 아니라 진로별로 큐레이션하기 위한 사전 작업이다.
경영/경제/통계/컴퓨터/공학 5개 파일럿 분야의 실제 연세대 개설 과목명을 근거로,
LLM이 그 학과 학생이 지향할 만한 진로 후보를 추론해 초안 JSON을 만든다. 런타임
기능이 아니라 오프라인 배치이며, 결과는 반드시 사람이 검토한다(reviewed=false로 저장).

## 안전 수칙 (절대 규칙)
- Firestore는 읽기만 한다 - course_repo의 list_taxonomy/search_by_college/search_courses
  외에는 아무 것도 호출하지 않는다. upsert_courses 등 쓰기 함수는 이 파일에서 import조차
  하지 않는다(과거 실사고: 스크립트가 운영 카탈로그 ~7,000건을 지운 적이 있다).
- FIRESTORE_EMULATOR_HOST/FIRESTORE_PROJECT_ID는 절대 여기서 설정/해제하지 않는다 -
  이미 셸에 설정된 값을 그대로 따르고, 어디를 읽는지만 시작 시 출력해 감사 가능하게 한다.
- 출력은 backend/app/etl/seeds/career_paths_draft.json 하나뿐이다.

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/infer_career_paths.py

ANTHROPIC_API_KEY가 실제 키가 아니면(use_real_llm=False) 즉시 중단한다 - 이 스크립트는
Mock으로 의미 있는 결과를 낼 수 없다(진짜 과목명 기반 추론이 핵심이므로).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from anthropic import AsyncAnthropic  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.firestore import course_repo  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402

# --- 파일럿 스코프 -----------------------------------------------------------

# 5개 파일럿 분야 - "우선 채택" 판정(select_departments)에도 그대로 쓰인다.
PILOT_FIELDS = ["경영", "경제", "통계", "컴퓨터", "공학"]

# 학과명 매칭에 쓰는 확장 키워드 - PILOT_FIELDS보다 넓게 잡아 인접 학과(데이터, 인공지능,
# 전기/전자/기계/화공/산업/정보 등 공대 세부 전공)까지 담는다.
DEPARTMENT_KEYWORDS = [
    "경영",
    "경제",
    "통계",
    "데이터",
    "컴퓨터",
    "소프트웨어",
    "인공지능",
    "공학",
    "전기",
    "전자",
    "기계",
    "화공",
    "산업",
    "정보",
]

DEPARTMENT_CAP = 25
# search_courses 한 번에 학과당 fetch할 상한 - 학과 하나의 개설 과목 수는 이보다
# 훨씬 작으므로(course_repo._FILTER_SCAN_LIMIT=1000과 동일한 여유) 넉넉하게 잡는다.
TITLES_PER_DEPARTMENT_LIMIT = 300
# LLM 프롬프트에 학과당 실어 보내는 과목명 상한 - 토큰 절감(제목만 보내도 개설 과목이
# 아주 많은 학과가 있을 수 있어 상한을 둔다).
MAX_TITLES_IN_PROMPT = 60
DEPARTMENTS_PER_LLM_CALL = 5

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "app" / "etl" / "seeds" / "career_paths_draft.json"
)

# Sonnet 5 요금(claude-api 스킬 조회, 2026-09 기준) - 근사 비용 출력용.
_SONNET5_INPUT_PER_MTOK = 2.0
_SONNET5_OUTPUT_PER_MTOK = 10.0

_WHITESPACE_RE = re.compile(r"\s+")


# --- 순수 함수 (Firestore/LLM 없이 단위 테스트 가능) --------------------------


def select_departments(
    all_departments: list[str],
    expanded: set[str] | None = None,
    *,
    keywords: list[str] = DEPARTMENT_KEYWORDS,
    primary_fields: list[str] = PILOT_FIELDS,
    cap: int = DEPARTMENT_CAP,
) -> list[str]:
    """학과명이 keyword에 매칭되는 것 + expanded(단과대명 매칭으로 넓힌 학과)를 모아
    cap개로 제한해 정렬 반환한다.

    매칭이 cap을 넘으면, 학과명에 PILOT_FIELDS(5개 파일럿 분야 단어)를 직접 포함하는
    쪽을 우선 채택한다 - 확장 키워드(데이터/소프트웨어 등)나 단과대 매칭으로만 걸린
    학과보다 다섯 분야 대표성이 먼저 지켜지게 하기 위함이다.
    """
    matched = {d for d in all_departments if any(kw in d for kw in keywords)}
    matched |= expanded or set()
    if len(matched) <= cap:
        return sorted(matched)
    primary = sorted(d for d in matched if any(kw in d for kw in primary_fields))
    rest = sorted(d for d in matched if d not in primary)
    return sorted((primary + rest)[:cap])


def normalize_path_name(name: str) -> str:
    """진로명을 중복 판정용으로 정규화한다(공백 제거 + 소문자화)."""
    return _WHITESPACE_RE.sub("", name).strip().lower()


def dedupe_paths(raw_paths: list[dict]) -> list[dict]:
    """학과별로 흩어져 나온 원시 진로(raw path)를 정규화된 name 기준으로 병합한다.

    raw_paths 항목 형태: {name, description, related_departments: [dept, ...],
    job_fields: [...], cert_hints: [...]}. 같은 name으로 묶이면 description은 처음
    나온 것을 유지하고, related_departments/job_fields/cert_hints는 등장 순서를
    보존한 합집합(중복 제거)으로 합친다. 반환 순서는 최초 등장 순서를 유지한다.
    """
    merged: dict[str, dict] = {}
    order: list[str] = []
    for raw in raw_paths:
        key = normalize_path_name(raw["name"])
        if key not in merged:
            merged[key] = {
                "name": raw["name"],
                "description": raw.get("description", ""),
                "related_departments": [],
                "job_fields": [],
                "cert_hints": [],
            }
            order.append(key)
        entry = merged[key]
        for field in ("related_departments", "job_fields", "cert_hints"):
            for value in raw.get(field, []):
                if value not in entry[field]:
                    entry[field].append(value)
    return [merged[k] for k in order]


def build_output(departments: list[str], career_paths: list[dict], generated_at: str) -> dict:
    """career_paths_draft.json 최종 형태를 조립한다. id는 등장 순서 기반 slug다."""
    return {
        "generated_at": generated_at,
        "pilot_fields": PILOT_FIELDS,
        "departments": departments,
        "career_paths": [
            {
                "id": f"path-{i + 1:02d}",
                "name": p["name"],
                "description": p["description"],
                "related_departments": p["related_departments"],
                "job_fields": p["job_fields"],
                "cert_hints": p["cert_hints"],
                "source": "llm_inferred",
                "reviewed": False,
            }
            for i, p in enumerate(career_paths)
        ],
    }


# --- Firestore 읽기 (read-only) ----------------------------------------------


def discover_departments(db) -> list[str]:
    """list_taxonomy + search_by_college(읽기 전용)로 파일럿 학과 목록을 고른다."""
    departments, colleges = course_repo.list_taxonomy(db)
    matched_colleges = [c for c in colleges if any(kw in c for kw in DEPARTMENT_KEYWORDS)]
    expanded: set[str] = set()
    for college in matched_colleges:
        for course in course_repo.search_by_college(db, college, limit=1000):
            if course.department:
                expanded.add(course.department)
    return select_departments(departments, expanded)


def fetch_titles(db, departments: list[str]) -> dict[str, list[str]]:
    """학과별 개설 과목명(제목만, 설명 제외) 목록을 읽기 전용으로 가져온다."""
    result: dict[str, list[str]] = {}
    for dept in departments:
        courses = course_repo.search_courses(db, department=dept, limit=TITLES_PER_DEPARTMENT_LIMIT)
        result[dept] = sorted({c.name for c in courses if c.name})
    return result


# --- LLM 추론 -----------------------------------------------------------------

_CAREER_PATH_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "job_fields": {"type": "array", "items": {"type": "string"}},
        "cert_hints": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "description", "job_fields", "cert_hints"],
}
_CAREER_PATHS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "departments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "department": {"type": "string"},
                    "career_paths": {"type": "array", "items": _CAREER_PATH_ITEM_SCHEMA},
                },
                "required": ["department", "career_paths"],
            },
        }
    },
    "required": ["departments"],
}

_SYSTEM_PROMPT = (
    "너는 한국 대학의 진로 상담 전문가다. 아래 학과들과 각 학과의 실제 개설 과목명을 보고,"
    " 그 학과 학생이 현실적으로 지향할 수 있는 진로(career path)를 학과당 2~6개 제안하라.\n\n"
    "규칙:\n"
    "- name: 진로명(예: '데이터 사이언티스트').\n"
    "- description: 1~2문장, 한국어로.\n"
    "- job_fields: NCS 직무분야 스타일의 키워드 태그 2~5개(예: '정보기술', '금융·보험').\n"
    "- cert_hints: 이 진로와 흔히 연관되는 자격증 이름(국가/민간/국제 무관, 실제로 존재하고"
    " 국내에 널리 알려진 것만). 확신이 없으면 빈 배열로 둬라 - 지어내지 마라.\n"
    "- 과목명이 실제로 그 학과에서 무엇을 배우는지 보여주는 근거다 - 학과 이름만 보고"
    " 뻔한 진로를 나열하지 말고 과목 구성을 반영하라."
)


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


async def infer_batch(
    client: AsyncAnthropic, model: str, batch: dict[str, list[str]]
) -> tuple[list[dict], int, int]:
    """학과 배치 하나를 LLM에 보내 진로 후보를 뽑는다. (raw_paths, input_tok, output_tok) 반환."""
    lines = []
    for dept, titles in batch.items():
        shown = titles[:MAX_TITLES_IN_PROMPT]
        lines.append(
            f"### {dept} (과목 {len(titles)}개 중 {len(shown)}개 표시)\n" + ", ".join(shown)
        )
    user = "\n\n".join(lines)
    resp = await client.messages.create(
        model=model,
        max_tokens=4096,
        thinking={"type": "disabled"},
        system=[{"type": "text", "text": _SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": _CAREER_PATHS_SCHEMA}},
    )
    usage = resp.usage
    in_tok, out_tok = usage.input_tokens, usage.output_tokens
    if getattr(resp, "stop_reason", None) in ("refusal", "max_tokens"):
        print(f"경고: 배치 {list(batch)} 추론 실패(stop_reason={resp.stop_reason}) - 건너뜀")
        return [], in_tok, out_tok
    try:
        data = json.loads(_first_text(resp))
    except json.JSONDecodeError:
        print(f"경고: 배치 {list(batch)} 응답이 JSON이 아님 - 건너뜀")
        return [], in_tok, out_tok

    raw_paths: list[dict] = []
    for dept_result in data.get("departments", []):
        dept = dept_result.get("department", "")
        for path in dept_result.get("career_paths", []):
            raw_paths.append(
                {
                    "name": path["name"],
                    "description": path.get("description", ""),
                    "related_departments": [dept] if dept else [],
                    "job_fields": [str(j) for j in path.get("job_fields", [])],
                    "cert_hints": [str(c) for c in path.get("cert_hints", [])],
                }
            )
    return raw_paths, in_tok, out_tok


async def infer_all(
    client: AsyncAnthropic, model: str, dept_titles: dict[str, list[str]]
) -> tuple[list[dict], int, int]:
    depts = list(dept_titles)
    all_paths: list[dict] = []
    total_in = total_out = 0
    for start in range(0, len(depts), DEPARTMENTS_PER_LLM_CALL):
        chunk = depts[start : start + DEPARTMENTS_PER_LLM_CALL]
        batch = {d: dept_titles[d] for d in chunk}
        paths, tin, tout = await infer_batch(client, model, batch)
        all_paths.extend(paths)
        total_in += tin
        total_out += tout
        print(f"  배치 {chunk} -> 진로 {len(paths)}개 (in={tin} out={tout} tok)")
    return all_paths, total_in, total_out


def _print_summary(paths: list[dict]) -> None:
    print(f"\n=== 진로 초안 {len(paths)}개 (창업자 검토 대기, reviewed=false) ===")
    for p in paths:
        depts = ", ".join(p["related_departments"])
        fields = ", ".join(p["job_fields"])
        certs = ", ".join(p["cert_hints"]) or "-"
        print(f"- {p['name']} | {depts} | {fields} | {certs}")


async def main() -> None:
    argparse.ArgumentParser(
        description="학과 교과과정 기반 진로(career path) 파일럿 초안 추론 (읽기 전용)"
    ).parse_args()

    settings = get_settings()
    if not settings.use_real_llm:
        print(
            "에러: ANTHROPIC_API_KEY가 실제 키가 아님 - Mock으로는 의미 있는 결과를 못 낸다. 중단."
        )
        raise SystemExit(1)

    # 감사 가능성: 여기서 아무것도 set/unset하지 않고, 셸에 이미 있는 값만 읽어 출력한다.
    emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if emulator_host:
        print(f"Firestore 읽기 대상: 에뮬레이터({emulator_host}) [읽기 전용]")
    else:
        project_id = os.environ.get("FIRESTORE_PROJECT_ID") or os.environ.get(
            "GOOGLE_CLOUD_PROJECT", "demo-ourlab(기본값)"
        )
        print(f"Firestore 읽기 대상: 프로젝트 '{project_id}' [읽기 전용]")

    db = get_firestore_client()
    departments = discover_departments(db)
    print(f"선정된 학과 {len(departments)}개: {departments}")
    if not departments:
        print("에러: 매칭된 학과가 없음 - course_catalog가 비어있거나 대상이 잘못됨. 중단.")
        raise SystemExit(1)

    dept_titles = fetch_titles(db, departments)
    for d, titles in dept_titles.items():
        print(f"  {d}: 과목 {len(titles)}개")

    default_headers = (
        {"anthropic-workspace-id": settings.anthropic_workspace_id}
        if settings.anthropic_workspace_id
        else None
    )
    client = AsyncAnthropic(api_key=settings.anthropic_api_key, default_headers=default_headers)
    raw_paths, total_in, total_out = await infer_all(
        client, settings.llm_extract_model, dept_titles
    )

    merged = dedupe_paths(raw_paths)
    output = build_output(departments, merged, datetime.now(UTC).isoformat())

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{OUTPUT_PATH} 에 진로 {len(merged)}개 저장 완료")

    _print_summary(output["career_paths"])

    cost = (
        total_in / 1_000_000 * _SONNET5_INPUT_PER_MTOK
        + total_out / 1_000_000 * _SONNET5_OUTPUT_PER_MTOK
    )
    print(
        f"\n토큰 사용량: input={total_in} output={total_out}"
        f" (근사 비용 ${cost:.4f}, Sonnet 5 기준 - 실제 청구와는 캐싱 등으로 다를 수 있음)"
    )


if __name__ == "__main__":
    asyncio.run(main())
