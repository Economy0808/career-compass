"""실제 Anthropic Claude 연동 (LLMClient 구현체).

모델은 settings에서 주입된다 (기본값 전부 Sonnet 5). 비용을 더 아끼려면
LLM_EXTRACT_MODEL을 Haiku 4.5로 내려 가벼운 두 단계만 저렴하게 돌릴 수 있다:
  - chat / extract_intent : llm_extract_model   (기본 Sonnet 5, Haiku로 다운시프트 가능)
  - synthesize_roadmap    : llm_synthesis_model (Sonnet 5, adaptive thinking + effort=high)
  - research_job          : llm_research_model  (Sonnet 5 + web_search, 월간 배치 전용)

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
    MajorGoalDecision,
    RoadmapContext,
)

MAX_INTAKE_QUESTIONS = 12  # 비용/UX 안전판 — 종료 판단은 모델이, 이 이상만 강제 종료

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
        "briefing": {"type": "string"},
        "major_goal": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "existing_goal_id": {"type": ["integer", "null"]},
                "title": {"type": "string"},
                "context": {"type": "string"},
            },
            "required": ["existing_goal_id", "title", "context"],
        },
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "detail": {"type": "string"},
                    "due_date": {"type": "string", "format": "date"},
                },
                "required": ["title", "description", "detail", "due_date"],
            },
        },
    },
    "required": ["title", "briefing", "major_goal", "milestones"],
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

    async def chat(
        self,
        goal_raw_text: str,
        messages: list[ChatMessage],
        known_profile: str | None = None,
    ) -> ChatTurn:
        asked = sum(1 for m in messages if m.role == "assistant")
        if asked >= MAX_INTAKE_QUESTIONS:
            return ChatTurn(done=True, question=None)

        system = (
            "너는 전공 미정 대학생의 진로 코치다. 정밀하고 현실적인 로드맵을 짜려면 아래"
            " 정보가 충분히 파악돼야 한다:\n"
            "1) 현재 수준·경험 (학년, 이미 해본 것, 관련 지식)\n"
            "2) 주당 투자 가능 시간과 목표 시점\n"
            "3) 관심 세부 분야·역할 (막연하면 단서라도)\n"
            "4) 선호하는 활동 유형(혼자 학습 vs 협업/대외활동)과 제약\n"
            "규칙:\n"
            "- 위 항목 중 아직 모르는 게 있으면 done=false, 가장 중요한 것 하나만 한국어"
            " 질문으로 물어라. 질문은 짧고 하나만. 이미 답한 걸 다시 묻지 마라.\n"
            "- 네 항목이 로드맵을 짜기에 충분해졌다고 판단되면 그때 done=true로 종료하라."
            " 성급하게 일찍 끝내지 말고, 정보가 얕으면 계속 물어라.\n"
            "- 유저가 '모르겠다'고 하면 그 항목은 파악된 것으로 간주하고 넘어가라.\n"
            "- '이미 파악된 유저 정보' 블록이 주어지면 그 항목들은 답을 아는 것으로 간주하고"
            " 절대 다시 묻지 마라. 이번 목표에 특화된 질문(세부 분야, 목표 시점 등)만 물어라."
        )
        # 유저별 프로필은 캐시되는 system 블록이 아니라 user turn에 넣는다 (캐시 히트 보전).
        profile_block = (
            f"이미 파악된 유저 정보(과거 로드맵 대화에서):\n{known_profile}\n\n"
            if known_profile
            else ""
        )
        transcript = (
            profile_block
            + f"목표: {goal_raw_text}\n\n지금까지의 대화:\n"
            + "\n".join(f"{m.role}: {m.content}" for m in messages)
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

    async def extract_intent(self, goal_raw_text: str, messages: list[ChatMessage]) -> CareerIntent:
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
            " NCS 능력단위(국가직무능력표준), 직종 리서치를 근거로 마일스톤을 설계하라.\n\n"
            "가장 중요한 원칙 — 현실적인 최종 목표부터 잡아라:\n"
            "- '데이터 사이언티스트가 된다' 같은 막연한 직업 도달을 최종점으로 삼지 마라."
            " 대신 현재 수준에서 1~2학기(약 6개월) 안에 실제로 도달 가능한 '구체적 도약점'을"
            " 최종 목표로 잡아라. 예: '교내/수도권 데이터사이언스 학회 지원에 통과할 수준의"
            " 기초 역량 + 공개할 수 있는 미니 분석 프로젝트 1개'.\n\n"
            "대목표/소목표 구조:\n"
            "- 유저의 장기 지향(예: '퀀트 되기')이 대목표, 이 로드맵이 도달하려는 도약점"
            " (예: '교내 퀀트 학회 합류')이 소목표다. 로드맵 title은 대목표가 아니라 소목표"
            " 중심의 짧은 한국어 구절로 지어라.\n"
            "- major_goal: 이 로드맵이 속하는 대목표. '기존 대목표 목록'에 맞는 것이 있으면"
            " 그 id를 existing_goal_id로 지정하고 title은 그대로 써라. 없으면"
            " existing_goal_id=null, title은 짧은 명사구(예: '퀀트 되기'). context에는 이후"
            " 대화에서 재사용할 유저 프로필 요약(학년/수준/주당 시간/선호/제약)을 4~6문장으로"
            " 갱신해 써라 — 다음 로드맵 생성 때 같은 질문을 반복하지 않기 위한 것이다.\n"
            "- briefing: 로드맵을 보여주기 직전 코치가 건네는 3~5문장 한국어 브리핑."
            " (1)이 진로에 필요한 핵심 역량을 NCS 능력단위·리서치 근거로 2~3개 짚고,"
            " (2)왜 지금은 대목표 직행이 아니라 이 소목표(학회 합류, 프로젝트 완성 등)가"
            " 현실적인 첫 단계인지 설명하라. 존댓말로, 격려하되 과장 없이.\n\n"
            "마일스톤 설계:\n"
            "- 최종 목표를 8~12개의 작고 검증 가능한 마일스톤으로 세밀하게 분해하라. 각"
            " 단계는 이전 단계 위에 역량을 순차적으로 쌓아야 한다. 너무 크거나 막연한 단계"
            " (예: '실력 쌓기') 금지 — 무엇을 하면 끝나는지가 분명해야 한다.\n"
            "- 각 마일스톤은 두 필드로 쓴다:\n"
            "  · description: 콩나무 화면에 한 줄로 뜨는 핵심 프리뷰. 60자 이내, 명사형으로"
            " 간결하게. 장황한 설명 금지.\n"
            "  · detail: 클릭 시 보이는 상세 가이드. 4~8문장으로 (1)이 마일스톤이 무엇이고"
            " 왜 필요한지, (2)어떻게 달성하는지 — 구체적인 강의/책/도구/활동/산출물을 실명이나"
            " 유형으로 제시, (3)'무엇을 하면 이 단계를 완료한 것으로 보는지' 완료 기준을 명확히"
            " 써라. 관련 NCS 능력단위가 있으면 detail에 근거로 언급하라.\n"
            "- 리서치의 학회·대외활동은 detail에서 구체적으로 추천하되, 전문가는 특정인을"
            " 지목하지 말고 '이런 키워드로 현직자를 찾아 커피챗을 요청하라' 형태로 안내하라.\n"
            "- 현재 수준에 맞춰 난이도를 조정하고, due_date는 오늘로부터 2주~6개월 사이로"
            " 순서대로(겹치지 않게) 배치하라.\n"
            "- 한국어로, 대학생이 부끄럽지 않게. 근거 없는 과장 금지."
        )
        i = context.intent
        parts = [
            f"목표/의중: {i.summary}",
            f"진로 방향 키워드: {', '.join(i.direction_keywords)}",
            f"현재 수준: {i.current_level}",
            f"오늘 날짜: {date.today().isoformat()}",
        ]
        if context.existing_goals:
            parts.append(
                "기존 대목표 목록:\n"
                + "\n".join(
                    f"- id={g.id} | {g.title} | {g.context}" for g in context.existing_goals
                )
            )
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
            max_tokens=24000,
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
                detail=m["detail"],
                due_date=datetime.strptime(m["due_date"], "%Y-%m-%d").date(),
            )
            for m in data["milestones"]
        ]
        mg = data["major_goal"]
        raw_id = mg.get("existing_goal_id")
        return GeneratedRoadmap(
            title=data["title"],
            milestones=milestones,
            briefing=data["briefing"],
            major_goal=MajorGoalDecision(
                existing_goal_id=int(raw_id) if raw_id is not None else None,
                title=mg["title"],
                context=mg["context"],
            ),
        )

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
