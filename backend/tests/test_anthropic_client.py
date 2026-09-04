"""app.llm.anthropic_client의 순수 로직(헬퍼·프롬프트 조립) 단위 테스트.

실제 Anthropic API는 절대 호출하지 않는다 - self._client.messages.create를
스텁으로 갈아끼워 호출 인자만 검증한다(count_tokens 등 실호출 금지, 하드 제약).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.llm.anthropic_client import AnthropicClaudeClient, _needs_desc
from app.llm.base import CourseOption


def _course(code: str, name: str, description: str | None = "설명") -> CourseOption:
    return CourseOption(
        code=code,
        name=name,
        description=description,
        level=1,
        years=[1],
        kind="전선",
        department="테스트학과",
    )


def _fake_message(payload: dict) -> SimpleNamespace:
    """messages.create가 반환하는 Message를 흉내 - _refused/_first_text가 읽는
    최소 인터페이스(stop_reason, content[].type/.text)만 채운다."""
    return SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="text", text=json.dumps(payload))],
    )


def _client_with_stub_create() -> tuple[AnthropicClaudeClient, AsyncMock]:
    client = AnthropicClaudeClient()
    stub = AsyncMock(return_value=_fake_message({"clusters": []}))
    client._client.messages.create = stub
    return client, stub


class TestNeedsDesc:
    def test_opaque_names_keep_description(self) -> None:
        assert _needs_desc("전공세미나") is True
        assert _needs_desc("캡스톤디자인") is True

    def test_clear_names_drop_description(self) -> None:
        assert _needs_desc("경영통계") is False
        assert _needs_desc("데이터마이닝") is False


@pytest.mark.asyncio
async def test_cluster_courses_trims_description_for_clear_names_only() -> None:
    """clear 이름은 desc를 완전히 생략하고, opaque 이름은 desc를 유지해야 한다."""
    client, stub = _client_with_stub_create()
    courses = [
        _course("BIZ1001", "경영통계", description="설명이 트림돼야 한다"),
        _course("BIZ4001", "전공세미나", description="설명이 유지돼야 한다"),
    ]

    await client.cluster_courses("진로 목표", courses)

    catalog = stub.call_args.kwargs["messages"][0]["content"]
    assert "설명이 트림돼야 한다" not in catalog
    assert "설명이 유지돼야 한다" in catalog


@pytest.mark.asyncio
async def test_cluster_courses_defaults_to_sonnet() -> None:
    """노브 기본값은 Sonnet 유지 - 배포해도 즉시 모델이 안 바뀌어야 한다."""
    client, stub = _client_with_stub_create()

    await client.cluster_courses("진로 목표", [_course("BIZ1001", "경영통계")])

    assert stub.call_args.kwargs["model"] == "claude-sonnet-5"


@pytest.mark.asyncio
async def test_cluster_model_knob_is_isolated_from_extract_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM_CLUSTER_MODEL을 내려도 cluster_courses만 강등되고, 다른 경량 호출
    (select_relevant_departments 등, llm_extract_model 공유)은 그대로여야 한다 -
    llm_extract_model을 직접 내리면 대화(chat)까지 같이 강등되는 문제의 해결책."""
    overridden = Settings(llm_cluster_model="claude-haiku-4-5-20251001")
    monkeypatch.setattr("app.llm.anthropic_client.get_settings", lambda: overridden)
    client, stub = _client_with_stub_create()

    await client.cluster_courses("진로 목표", [_course("BIZ1001", "경영통계")])
    assert stub.call_args.kwargs["model"] == "claude-haiku-4-5-20251001"

    stub.return_value = _fake_message({"departments": []})
    await client.select_relevant_departments("진로 목표")
    assert stub.call_args.kwargs["model"] == overridden.llm_extract_model
    assert stub.call_args.kwargs["model"] != "claude-haiku-4-5-20251001"
