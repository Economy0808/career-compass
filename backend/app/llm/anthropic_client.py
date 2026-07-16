"""실제 Anthropic Claude 연동 (LLMClient 구현체).

계층형 모델로 비용을 통제한다:
  - chat / extract_intent : Haiku 4.5 (저렴)
  - synthesize_roadmap    : Sonnet 5 (adaptive thinking + effort=high)
  - research_job          : Sonnet 5 + web_search (월간 배치 전용)

비용 절감: 반복되는 시스템 프롬프트는 prompt caching(cache_control)으로 캐시,
출력은 structured outputs로 고정, max_tokens 상한. 요청 경로(chat/extract/synth)는
웹 검색을 쓰지 않는다 — 웹 검색은 research_job(배치)에만.

컴플라이언스: research_job은 요약 + 출처 URL만 수집한다(원문 복제 금지, 개인정보
저장 금지). 커피챗은 특정인 지목이 아니라 "직접 검색해 접촉" 안내로 유도한다.
"""
import json
from datetime import date, datetime

from anthropic import AsyncAnthropic

from app.config import get_settings
from app.llm.base import (
    AbilityUnitRef,
    CareerIntent,
    ChatMessage,
    ChatTurn,
    GeneratedMilestone,
    GeneratedRoadmap,
    JobResearchResult,
    RoadmapContext,
)

MAX_INTAKE_QUESTIONS = 4  # 비용/UX 상한 — 이 이상은 강제 종료

# --- structured output 스키마 ---
_INTENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "direction_keywords": {"type": "array", "items": {"type": "string"}},
        "current_level": {"type": "string"},
    },
    "required": ["summary", "direction_keywords", "current_level"],
}
_CHAT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "done": {"type": "boolean"},
        "question": {"type": ["string", "null"]},
    },
    "required": ["done", "question"],
}
_ROADMAP_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "due_date": {"type": "string", "format": "date"},
                },
                "required": ["title", "description", "due_date"],
            },
        },
    },
    "required": ["title", "milestones"],
}


def _cached_system(text: str) -> list[dict]:
    """반복 호출에서 재사용되도록 시스템 프롬프트를 캐시 블록으로 감싼다."""
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def _refused(message) -> bool:
    return getattr(message, "stop_reason", None) == "refusal"


class AnthropicClaudeClient:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._extract_model = settings.llm_extract_model
        self._synthesis_model = settings.llm_synthesis_model
        self._research_model = settings.llm_research_model

    def _to_api_messages(self, messages: list[ChatMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def chat(self, goal_raw_text: str, messages: list[ChatMessage]) -> ChatTurn:
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= MAX_INTAKE_QUESTIONS:
            return ChatTurn(done=True, question=None)

        system = (
            "너는 전공 미정 대학생의 진로 코치다. 유저의 목표가 정밀한 로드맵을 짜기에"
            " 충분히 구체적인지 판단하라. 부족하면 가장 도움이 될 질문 하나만 한국어로"
            " 던지고, 충분하면 done=true로 종료하라. 질문은 짧고 하나만."
        )
        transcript = f"목표: {goal_raw_text}\n\n지금까지의 대화:\n" + "\n".join(
            f"{m.role}: {m.content}" for m in messages
        )
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=512,
            system=_cached_system(system),
            messages=[{"role": "user", "content": transcript}],
            output_config={"format": {"type": "json_schema", "schema": _CHAT_SCHEMA}},
        )
        if _refused(resp):
            return ChatTurn(done=True, question=None)
        data = json.loads(_first_text(resp))
        return ChatTurn(done=bool(data["done"]), question=data.get("question") or None)

    async def extract_intent(
        self, goal_raw_text: str, messages: list[ChatMessage]
    ) -> CareerIntent:
        system = (
            "너는 진로 분석가다. 유저의 (두서없을 수 있는) 글과 답변에서 지향하는 진로"
            " 방향과 현재 수준을 뽑아라. direction_keywords는 NCS 직무 검색에 쓰이니"
            " 직무·역량 중심의 한국어 명사 위주로. 유저가 방향을 몰라도 단서로 추론하라."
        )
        transcript = f"유저 글/목표: {goal_raw_text}\n\n질답:\n" + "\n".join(
            f"{m.role}: {m.content}" for m in messages
        )
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=1024,
            system=_cached_system(system),
            messages=[{"role": "user", "content": transcript}],
            output_config={"format": {"type": "json_schema", "schema": _INTENT_SCHEMA}},
        )
        if _refused(resp):
            raise RuntimeError("intent extraction refused")
        data = json.loads(_first_text(resp))
        return CareerIntent(
            summary=data["summary"],
            direction_keywords=[str(k) for k in data.get("direction_keywords", [])],
            current_level=data.get("current_level", "미상"),
        )

    async def synthesize_roadmap(self, context: RoadmapContext) -> GeneratedRoadmap:
        system = (
            "너는 전공 미정 대학생을 위한 진로 로드맵 설계자다. 주어진 의중·현재수준과"
            " NCS 능력단위(국가직무능력표준), 직종 리서치를 근거로 마일스톤을 설계하라."
            " 규칙:\n"
            "- 각 마일스톤은 '어떤 역량/스펙을 획득하는가'가 분명해야 한다. NCS 능력단위에"
            " 최대한 근거를 대라.\n"
            "- 리서치의 학회·대외활동을 구체적으로 추천하되, 전문가는 특정인을 지목하지"
            " 말고 '이런 키워드로 현직자를 찾아 커피챗을 요청하라' 형태로 안내하라.\n"
            "- 현재 수준에 맞춰 난이도를 조정하고, due_date는 오늘로부터 2주~4개월 사이로"
            " 순서대로 배치하라. 5~8개.\n"
            "- 한국어로, 대학생이 부끄럽지 않게."
        )
        i = context.intent
        parts = [
            f"목표/의중: {i.summary}",
            f"진로 방향 키워드: {', '.join(i.direction_keywords)}",
            f"현재 수준: {i.current_level}",
            f"오늘 날짜: {date.today().isoformat()}",
        ]
        if context.ncs_job_name:
            parts.append(f"매칭된 NCS 직무: {context.ncs_job_name}")
        if context.ability_units:
            parts.append(
                "NCS 능력단위 목록:\n"
                + "\n".join(f"- {u.name} ({u.code})" for u in context.ability_units)
            )
        if context.research:
            r = context.research
            parts.append(
                "직종 리서치(요약):\n"
                f"- 요약: {r.summary}\n"
                f"- 추천 활동: {', '.join(r.activities)}\n"
                f"- 학회: {', '.join(r.academic_societies)}\n"
                f"- 전문가 인사이트: {', '.join(r.expert_insights)}"
            )
        user_content = "\n\n".join(parts)

        # 종합은 강한 모델 + adaptive thinking + effort high. 스트리밍으로 타임아웃 회피.
        async with self._client.messages.stream(
            model=self._synthesis_model,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            output_config={
                "effort": "high",
                "format": {"type": "json_schema", "schema": _ROADMAP_SCHEMA},
            },
            system=_cached_system(system),
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            message = await stream.get_final_message()

        if _refused(message):
            raise RuntimeError("roadmap synthesis refused")
        data = json.loads(_first_text(message))
        milestones = [
            GeneratedMilestone(
                title=m["title"],
                description=m["description"],
                due_date=datetime.strptime(m["due_date"], "%Y-%m-%d").date(),
            )
            for m in data["milestones"]
        ]
        return GeneratedRoadmap(title=data["title"], milestones=milestones)

    async def research_job(
        self, job_name: str, ability_units: list[AbilityUnitRef]
    ) -> JobResearchResult:
        """월간 배치 전용. 웹 검색으로 조사 후 요약+출처만 남긴다.

        컴플라이언스: 원문을 복제·저장하지 않는다. 출처 URL은 web_search 결과의
        인용에서만 수집한다. 전문가 개인정보는 저장하지 않는다.
        """
        system = (
            "너는 한국 대학생 진로 리서처다. 주어진 직무에 대해 웹을 검색해:\n"
            "1) 대학생이 할 수 있는 대외활동/공모전,\n"
            "2) 관련 학회(연세대 교내 또는 수도권 연합 위주),\n"
            "3) 현직 전문가들이 공개 글에서 공통적으로 강조하는 준비 방향(특정인 지목 금지,"
            " 익명 요지만),\n"
            "을 조사하라. 원문을 복제하지 말고 요약만. 마지막에 아래 형식의 JSON 하나만"
            " 출력하라(코드블록 없이):\n"
            '{"summary": "...", "activities": ["..."], "academic_societies": ["..."],'
            ' "expert_insights": ["..."]}'
        )
        unit_hint = ", ".join(u.name for u in ability_units[:10])
        user_content = (
            f"직무: {job_name}\n관련 NCS 능력단위(참고): {unit_hint}\n"
            "위 직무를 준비하는 학부생 관점으로 조사해줘."
        )
        resp = await self._client.messages.create(
            model=self._research_model,
            max_tokens=4000,
            system=system,
            messages=[{"role": "user", "content": user_content}],
            tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 6}],
        )

        # 출처 URL: web_search 결과 인용에서만 수집
        source_urls: list[str] = []
        text_answer = ""
        for block in resp.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_answer += block.text
            elif btype == "web_search_tool_result":
                items = getattr(block, "content", []) or []
                for item in items:
                    url = getattr(item, "url", None)
                    if url and url not in source_urls:
                        source_urls.append(url)

        data = _lenient_json(text_answer)
        return JobResearchResult(
            summary=data.get("summary", "") or f"{job_name} 리서치 요약",
            activities=[str(x) for x in data.get("activities", [])],
            academic_societies=[str(x) for x in data.get("academic_societies", [])],
            expert_insights=[str(x) for x in data.get("expert_insights", [])],
            source_urls=source_urls[:20],
        )


def _lenient_json(text: str) -> dict:
    """텍스트에서 첫 번째 JSON 객체를 관대하게 파싱한다 (배치용, 실패 시 빈 dict)."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}
