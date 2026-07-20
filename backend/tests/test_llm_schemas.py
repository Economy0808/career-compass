"""structured output 스키마가 Anthropic API 제약을 지키는지 정적으로 검사한다.

**왜 필요한가**: 나머지 테스트는 전부 MockClaudeClient를 쓰므로 실 API가 요청을
거부하는 종류의 실수를 절대 못 잡는다. 실제로 `minItems: 2`가 들어간 채로 커밋됐고,
그동안 API 키가 401로 죽어 있어 그 400 에러가 가려져 있다가 키를 고치고 나서야
"로드맵 생성 실패"로 드러났다. 스키마는 코드이므로 코드로 검증한다.

호출 없이 dict만 훑으므로 네트워크도 비용도 없다.
"""

import pytest

from app.llm import anthropic_client as ac

_SCHEMAS = {
    "intent": ac._INTENT_SCHEMA,
    "chat": ac._CHAT_SCHEMA,
    "job_select": ac._JOB_SELECT_SCHEMA,
    "roadmap": ac._ROADMAP_SCHEMA,
}


def _walk(node: object, path: str = "$"):
    """스키마 dict를 재귀적으로 훑으며 (경로, 노드)를 낸다."""
    if isinstance(node, dict):
        yield path, node
        for key, value in node.items():
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from _walk(value, f"{path}[{i}]")


@pytest.mark.parametrize("name", sorted(_SCHEMAS))
def test_min_items_within_supported_range(name: str) -> None:
    """API는 배열 minItems로 0 또는 1만 받는다 — 그 외는 요청이 400으로 거부된다.

    개수 하한이 필요하면 프롬프트로 요구하고 roadmap_gen._clamp_set으로 강제할 것.
    """
    offenders = [
        f"{path}.minItems={node['minItems']}"
        for path, node in _walk(_SCHEMAS[name])
        if "minItems" in node and node["minItems"] not in (0, 1)
    ]
    assert not offenders, f"지원되지 않는 minItems: {offenders}"


@pytest.mark.parametrize("name", sorted(_SCHEMAS))
def test_objects_are_strict(name: str) -> None:
    """structured outputs는 모든 object에 additionalProperties=False와 required를 요구한다."""
    problems = []
    for path, node in _walk(_SCHEMAS[name]):
        if node.get("type") != "object":
            continue
        if node.get("additionalProperties") is not False:
            problems.append(f"{path}: additionalProperties가 False가 아님")
        missing = set(node.get("properties", {})) - set(node.get("required", []))
        if missing:
            problems.append(f"{path}: required 누락 {sorted(missing)}")
    assert not problems, problems
