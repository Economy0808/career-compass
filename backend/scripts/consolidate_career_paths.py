"""진로 초안(career_paths_draft.json)을 정본 진로(약 25~40개)로 통합한다.

Phase 1 추론은 학과별로 진로를 뽑기 때문에 같은 직무가 학과마다 다른 이름으로
중복된다(예: 반도체 공정/소자/설계 엔지니어, 금융/투자 애널리스트 5종). 이 스크립트는
초안 전체를 Sonnet 구조화 호출 1회로 병합하고, 병합된 원본명을 variants에 남겨
아무것도 유실되지 않게 한다. 모든 원본명이 정확히 한 정본에 들어갔는지 코드로 검증하고,
누락분은 LLM 재호출 없이 단독 정본으로 자동 보충한다.

Firestore·네트워크 쓰기 없음. 입력·출력 모두 로컬 JSON(app/etl/seeds/).
실행: (backend/) .venv/Scripts/python.exe scripts/consolidate_career_paths.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anthropic import AsyncAnthropic  # noqa: E402

from app.config import get_settings  # noqa: E402

SEEDS_DIR = Path(__file__).resolve().parents[1] / "app" / "etl" / "seeds"
DRAFT_PATH = SEEDS_DIR / "career_paths_draft.json"
OUT_PATH = SEEDS_DIR / "career_paths_consolidated.json"

PRIMARY_FIELDS = ["경영", "경제", "통계·데이터", "컴퓨터·SW", "공학", "보건·바이오", "기타"]

_ITEM_PROPS = {
    "name": {"type": "string"},
    "description": {"type": "string"},
    "primary_field": {"type": "string", "enum": PRIMARY_FIELDS},
    "variants": {"type": "array", "items": {"type": "string"}},
}
_SCHEMA = {
    "type": "object",
    "properties": {
        "career_paths": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _ITEM_PROPS,
                "required": list(_ITEM_PROPS),
                "additionalProperties": False,
            },
        }
    },
    "required": ["career_paths"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "너는 한국 대학생 진로 데이터 편집자다. 학과별로 추론된 진로 후보 목록을 받아, "
    "실제 취업시장에서 같은 직무로 통하는 것들을 하나의 정본 진로로 병합하라.\n\n"
    "규칙:\n"
    "- 정본 진로는 25~40개. 학과만 다르고 직무가 같으면 반드시 병합하라"
    "(예: 여러 학과의 반도체 공정/소자 엔지니어는 하나로, 금융/투자 애널리스트 변형들도 하나로).\n"
    "- 단, 전문직 라이선스가 진로 자체인 것(회계/세무 전문가, 보험계리사, 감정평가사 등)은 "
    "별도 정본으로 유지하라. 보조 자격이 아니라 평생 직업이다.\n"
    "- 이름은 한국 취업시장에서 통용되는 명칭으로, description은 한국어 1문장.\n"
    "- primary_field는 정확히 하나: 경영 / 경제 / 통계·데이터 / 컴퓨터·SW / 공학 / 보건·바이오 / 기타.\n"
    "- 출력에는 name, description, primary_field, variants만 넣어라. "
    "학과, 분야, 자격증은 출력하지 마라(코드가 원본에서 합산한다).\n"
    "- variants에는 병합한 원본 진로명을 입력 원문 그대로 전부 넣어라. "
    "입력의 모든 진로명이 정확히 하나의 정본 variants에 들어가야 한다(누락·중복 금지)."
)


def normalize_name(name: str) -> str:
    return "".join(name.split()).lower()


def check_coverage(raw_names: list[str], paths: list[dict]) -> tuple[list[str], list[str]]:
    """모든 원본명이 정확히 한 정본의 variants에 들어갔는지 검증한다. (누락, 중복) 반환."""
    seen: dict[str, int] = {}
    for path in paths:
        for variant in path.get("variants", []):
            key = normalize_name(variant)
            seen[key] = seen.get(key, 0) + 1
    raw_by_key = {normalize_name(n): n for n in raw_names}
    missing = [name for key, name in raw_by_key.items() if key not in seen]
    duplicated = [key for key, count in seen.items() if count > 1]
    return missing, duplicated


def append_missing(paths: list[dict], raw_paths: list[dict], missing: list[str]) -> list[dict]:
    """LLM이 빠뜨린 원본을 단독 정본으로 보충한다(재호출 없음, 유실 방지)."""
    raw_by_key = {normalize_name(p["name"]): p for p in raw_paths}
    for name in missing:
        raw = raw_by_key[normalize_name(name)]
        paths.append(
            {
                "name": raw["name"],
                "description": raw.get("description", ""),
                "primary_field": "기타",
                "related_departments": list(raw.get("related_departments", [])),
                "job_fields": list(raw.get("job_fields", [])),
                "cert_hints": list(raw.get("cert_hints", [])),
                "variants": [raw["name"]],
                "auto_appended": True,
            }
        )
    return paths


def enrich_from_draft(paths: list[dict], raw_paths: list[dict]) -> list[dict]:
    """정본의 학과/분야/자격증힌트를 variants가 가리키는 원본들의 합집합으로 채운다.

    LLM은 묶기(name/description/primary_field/variants)만 하고, 나머지는 여기서
    결정론적으로 합산한다. 원본에 없는 학과나 자격증이 끼어들 여지를 없앤다.
    """
    raw_by_key = {normalize_name(p["name"]): p for p in raw_paths}
    for path in paths:
        depts: list[str] = []
        fields: list[str] = []
        hints: list[str] = []
        for variant in path.get("variants", []):
            raw = raw_by_key.get(normalize_name(variant))
            if raw is None:
                continue
            depts += raw.get("related_departments", [])
            fields += raw.get("job_fields", [])
            hints += raw.get("cert_hints", [])
        path["related_departments"] = _dedupe(depts)
        path["job_fields"] = _dedupe(fields)
        path["cert_hints"] = _dedupe(hints)
    return paths


def _dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        key = normalize_name(item)
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def finalize(paths: list[dict], generated_at: str, draft_meta: dict) -> dict:
    """정본에 id·provenance를 붙이고 리스트 필드를 중복 제거해 출력 문서를 만든다."""
    final: list[dict] = []
    for i, path in enumerate(paths, start=1):
        final.append(
            {
                "id": f"cp-{i:02d}",
                "name": path["name"],
                "description": path.get("description", ""),
                "primary_field": path.get("primary_field", "기타"),
                "related_departments": _dedupe(path.get("related_departments", [])),
                "job_fields": _dedupe(path.get("job_fields", [])),
                "cert_hints": _dedupe(path.get("cert_hints", [])),
                "variants": _dedupe(path.get("variants", [])),
                "auto_appended": bool(path.get("auto_appended", False)),
                "source": "llm_consolidated",
                "reviewed": False,
            }
        )
    return {
        "generated_at": generated_at,
        "source_draft_generated_at": draft_meta.get("generated_at"),
        "pilot_fields": draft_meta.get("pilot_fields", []),
        "departments": draft_meta.get("departments", []),
        "career_paths": final,
    }


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


async def consolidate(
    client: AsyncAnthropic, model: str, raw_paths: list[dict]
) -> tuple[list[dict], int, int]:
    lines = []
    for p in raw_paths:
        depts = ", ".join(p["related_departments"])
        fields = ", ".join(p["job_fields"])
        hints = ", ".join(p["cert_hints"]) or "-"
        lines.append(f"- {p['name']} | 학과: {depts} | 분야: {fields} | 자격증힌트: {hints}")
    user = f"다음 진로 후보 {len(raw_paths)}개를 정본 진로로 통합하라.\n\n" + "\n".join(lines)
    resp = await client.messages.create(
        model=model,
        max_tokens=16384,
        thinking={"type": "disabled"},
        system=[{"type": "text", "text": _SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
    )
    in_tok, out_tok = resp.usage.input_tokens, resp.usage.output_tokens
    if getattr(resp, "stop_reason", None) in ("refusal", "max_tokens"):
        raise SystemExit(f"통합 실패(stop_reason={resp.stop_reason})")
    data = json.loads(_first_text(resp))
    return data["career_paths"], in_tok, out_tok


async def main() -> None:
    draft = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))
    raw_paths: list[dict] = draft["career_paths"]
    settings = get_settings()
    default_headers = (
        {"anthropic-workspace-id": settings.anthropic_workspace_id}
        if settings.anthropic_workspace_id
        else None
    )
    client = AsyncAnthropic(api_key=settings.anthropic_api_key, default_headers=default_headers)
    paths, in_tok, out_tok = await consolidate(client, settings.llm_extract_model, raw_paths)

    raw_names = [p["name"] for p in raw_paths]
    missing, duplicated = check_coverage(raw_names, paths)
    if missing:
        print(f"경고: LLM이 {len(missing)}개 원본을 빠뜨림 - 단독 정본으로 보충: {missing}")
        paths = append_missing(paths, raw_paths, missing)
    if duplicated:
        print(f"경고: variants 중복 {len(duplicated)}개(첫 정본 기준 유지): {duplicated}")
    missing_after, _ = check_coverage(raw_names, paths)
    assert not missing_after, f"보충 후에도 누락: {missing_after}"

    paths = enrich_from_draft(paths, raw_paths)

    doc = finalize(paths, datetime.now(UTC).isoformat(), draft)
    OUT_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    cost = in_tok / 1e6 * 2 + out_tok / 1e6 * 10
    print(
        f"정본 진로 {len(doc['career_paths'])}개 (원본 {len(raw_paths)}개) -> {OUT_PATH}\n"
        f"토큰: input={in_tok} output={out_tok} (약 ${cost:.4f}, Sonnet 5 정가)"
    )


if __name__ == "__main__":
    asyncio.run(main())
