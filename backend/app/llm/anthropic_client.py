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

import asyncio
import json
import logging
import socket
from datetime import date, datetime
from urllib.parse import urlparse

import httpx
from anthropic import APIConnectionError, AsyncAnthropic, BadRequestError
from anthropic.types import Message

from app.config import get_settings
from app.llm.base import (
    AbilityUnitRef,
    CareerIntent,
    ChatMessage,
    ChatTurn,
    ClusteredCourse,
    CourseCluster,
    CourseClusterResult,
    CourseOption,
    DraftConstellation,
    DraftResult,
    GeneratedMilestone,
    GeneratedRoadmapItem,
    GeneratedRoadmapSet,
    JobResearchResult,
    MajorGoalDecision,
    NcsJobOption,
    RoadmapContext,
    SupportBin,
    SupportBinResult,
    SupportElement,
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
_JOB_SELECT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        # 맞는 후보가 없으면 null. 억지 매칭보다 빈손이 낫다.
        "job_code": {"type": ["string", "null"]},
        "reason": {"type": "string"},
    },
    "required": ["job_code", "reason"],
}
_CHAT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "done": {"type": "boolean"},
        "question": {"type": ["string", "null"]},
        # 입력 보조 힌트 한 줄 - done=true면 null.
        "hint": {"type": ["string", "null"]},
        # 입력 보조 칩 2~4개(짧은 명사구) - done=true면 [].
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["done", "question", "hint", "options"],
}
_MILESTONE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "detail": {"type": "string"},
        "due_date": {"type": "string", "format": "date"},
    },
    "required": ["title", "description", "detail", "due_date"],
}
_ROADMAP_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
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
        "roadmaps": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    # structured outputs는 minItems로 0/1만 받는다 — 2 이상을 넣으면 요청
                    # 자체가 400으로 거부된다. 마일스톤 하한(2개)은 프롬프트로 요구하고
                    # roadmap_gen._clamp_set이 미달 로드맵을 떨어뜨려 강제한다.
                    "milestones": {"type": "array", "items": _MILESTONE_SCHEMA},
                },
                "required": ["title", "milestones"],
            },
        },
    },
    "required": ["briefing", "major_goal", "roadmaps"],
}


_DEPARTMENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"departments": {"type": "array", "items": {"type": "string"}}},
    "required": ["departments"],
}
_COURSE_CLUSTER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    # 이 군집이 왜 목표에 필요한지 코치 코멘트. 못 채우면 null.
                    "advice": {"type": ["string", "null"]},
                    "courses": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "code": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                            "required": ["code", "reason"],
                        },
                    },
                },
                "required": ["name", "advice", "courses"],
            },
        }
    },
    "required": ["clusters"],
}
_SUPPORT_ELEMENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "label": {"type": "string"},
        "type": {
            "type": "string",
            "enum": ["certification", "organization", "activity", "networking"],
        },
        "subtitle": {"type": ["string", "null"]},
        "description": {"type": ["string", "null"]},
    },
    "required": ["label", "type", "subtitle", "description"],
}
_SUPPORT_BIN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "advice": {"type": ["string", "null"]},
        "elements": {"type": "array", "items": _SUPPORT_ELEMENT_SCHEMA},
    },
    "required": ["name", "advice", "elements"],
}
_SUPPORT_ELEMENTS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"bins": {"type": "array", "items": _SUPPORT_BIN_SCHEMA}},
    "required": ["bins"],
}
_DRAFT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "tagline": {"type": "string"},
        # 개수 제약(minItems)은 프롬프트로만 요구한다 - _ROADMAP_SCHEMA 주석 참고:
        # 이 API의 structured outputs는 minItems가 0/1만 허용되고 2 이상을 넣으면
        # 요청 자체가 400으로 거부된다. edges 쌍의 길이(=2)도 같은 이유로 스키마가
        # 아니라 파싱 후 코드에서 검증한다.
        "item_ids": {"type": "array", "items": {"type": "string"}},
        "edges": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
    },
    "required": ["name", "tagline", "item_ids", "edges"],
}
_DRAFTS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"drafts": {"type": "array", "items": _DRAFT_SCHEMA}},
    "required": ["drafts"],
}


logger = logging.getLogger(__name__)


def _cached_system(text: str) -> list[dict]:
    """반복 호출에서 재사용되도록 시스템 프롬프트를 캐시 블록으로 감싼다."""
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _first_text(message: Message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def _last_text(message: Message) -> str:
    """툴 사용(웹서치) 응답은 앞쪽에 진행 설명 텍스트 블록이 낄 수 있다 —
    구조화 출력 JSON은 항상 마지막 텍스트 블록에 온다."""
    for block in reversed(message.content):
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def _refused(message: Message) -> bool:
    return getattr(message, "stop_reason", None) == "refusal"


def _web_search_domains(message: Message, limit: int = 12) -> list[str]:
    """web_search 결과 블록에서 출처 URL을 도메인별 대표 1개로 수집한다.

    프리뷰의 출처 뱃지용 — 같은 도메인은 처음 본 URL만 남긴다. 저장하지 않고
    프리뷰 응답으로만 흘려보낸다 (컴플라이언스: URL만, 원문 복제·PII 저장 없음)."""
    seen: set[str] = set()
    urls: list[str] = []
    for block in message.content:
        if getattr(block, "type", None) != "web_search_tool_result":
            continue
        for item in getattr(block, "content", None) or []:
            url = getattr(item, "url", None)
            if not url:
                continue
            domain = urlparse(url).netloc.lower()
            if not domain or domain in seen:
                continue
            seen.add(domain)
            urls.append(url)
            if len(urls) >= limit:
                return urls
    return urls


class AnthropicClaudeClient:
    def __init__(self) -> None:
        settings = get_settings()
        # 웹서치가 낀 종합은 서버 처리 구간이 길어 SSE 스트림이 조용해지는 순간이
        # 생긴다. 그 사이 방화벽/NAT가 유휴 TCP를 리셋하면 httpx.ReadError가 나므로
        # SO_KEEPALIVE로 연결을 살려두고, 넉넉한 read 타임아웃을 준다. 그래도 끊기는
        # 간헐 케이스는 synthesize_roadmap의 재시도가 받는다.
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(600.0, connect=10.0),
            transport=httpx.AsyncHTTPTransport(
                retries=0,
                socket_options=[(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)],
            ),
        )
        # identity-linked 키는 anthropic-workspace-id 헤더가 필수(없으면 400) -
        # .env에 ANTHROPIC_WORKSPACE_ID가 있으면 모든 요청에 실어 보낸다.
        default_headers = (
            {"anthropic-workspace-id": settings.anthropic_workspace_id}
            if settings.anthropic_workspace_id
            else None
        )
        self._client = AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            http_client=http_client,
            default_headers=default_headers,
        )
        self._extract_model = settings.llm_extract_model
        self._synthesis_model = settings.llm_synthesis_model
        self._synthesis_web_search = settings.llm_synthesis_web_search
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
            "너는 전공 미정 대학생의 진로 코치다. 그 사람에게 딱 맞는 로드맵을 짜려면 아래를"
            " 구체적으로 파악해야 한다:\n"
            "1) 현재 수준·경험 (학년, 이미 해본 것, 관련 지식/수업, 가진 자격증·어학 성적)\n"
            "2) 주당 투자 가능 시간과 목표 시점\n"
            "3) 관심 세부 분야·역할, 그리고 그 안에서 특히 끌리는 지점\n"
            "4) 선호하는 활동 유형(혼자 학습 vs 협업/대외활동)과 제약(돈·체력·병행 일정 등)\n"
            "5) 목표로 삼는 회사·직무·시험이나 이미 그려둔 진로 이미지가 있는지\n"
            "규칙:\n"
            "- 한 번에 질문은 하나만, 짧고 구체적으로, 한국어로. 이미 답한 걸 다시 묻지 마라.\n"
            "- 답이 두루뭉술하면 표면만 확인하지 말고 그 안에서 한 번 더 파고들어 구체적"
            " 사례·수준·맥락을 끌어내라 (예: '데이터에 관심'이라 하면 어떤 데이터를 어디까지"
            " 다뤄봤는지, 통계/코딩은 어느 정도인지).\n"
            "- 최소 6번은 주고받으며 위 항목들을 두루 파악하기 전엔 done=false. 성급히 끝내지"
            " 마라 — 정보가 얕은 채 끝내는 것보다 한두 개 더 묻는 게 낫다.\n"
            "- 유저가 '모르겠다/상관없다'고 하면 그 항목은 파악된 것으로 간주하고 다음으로"
            " 넘어가라 (억지로 캐묻지 말 것).\n"
            "- 각 질문에 선택지 칩 2~4개(짧은 명사구, 마지막에 '잘 모르겠어요' 허용)와 필요"
            " 시 한 줄 힌트를 함께 제안하라 - 칩은 입력 보조일 뿐 유저는 자유롭게 타이핑해도"
            " 된다는 걸 유념하고, 질문의 답을 미리 좁히는 칩을 만들어라. done=true인 턴에서는"
            " hint를 null, options를 빈 배열로 둬라.\n"
            "- 로드맵을 짜기에 정말 충분히 구체적으로 파악됐다고 판단되면 done=true로 종료하라.\n"
            "- '이미 파악된 유저 정보' 블록이 주어지면 그 항목들은 아는 것으로 간주하고 절대"
            " 다시 묻지 마라. 이번 목표에 특화된 질문(세부 분야, 목표 시점 등)만 물어라."
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
        # 가벼운 다음-질문 판단이라 thinking 불필요 — 켜두면(기본 adaptive) thinking이
        # max_tokens를 같이 먹어 긴 대화 뒤 구조화 JSON이 잘린다. 끄면 예산 전부가 출력에
        # 가고 더 빠르다.
        resp = await self._client.messages.create(
            model=self._extract_model,
            # 칩/힌트 필드가 늘어난 만큼 출력 예산을 살짝 올린다(1024 -> 1536) -
            # thinking은 여전히 꺼서 예산 전부가 구조화 출력에 가게 한다.
            max_tokens=1536,
            thinking={"type": "disabled"},
            system=_cached_system(system),
            messages=[{"role": "user", "content": transcript}],
            output_config={"format": {"type": "json_schema", "schema": _CHAT_SCHEMA}},
        )
        if _refused(resp):
            return ChatTurn(done=True, question=None)
        try:
            data = json.loads(_first_text(resp))
            if bool(data["done"]):
                # done 턴은 프롬프트가 null/[]를 요구하지만, 모델이 안 지켜도 방어적으로 강제.
                return ChatTurn(done=True, question=None, hint=None, options=[])
            return ChatTurn(
                done=False,
                question=data.get("question") or None,
                hint=data.get("hint") or None,
                options=[str(o) for o in data.get("options", [])],
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            # 응답이 잘리거나 비면 503 대신 질답을 종료해 프리뷰로 넘긴다.
            logger.warning("chat returned unparsable JSON; ending intake")
            return ChatTurn(done=True, question=None)

    async def extract_intent(self, goal_raw_text: str, messages: list[ChatMessage]) -> CareerIntent:
        system = (
            "너는 진로 분석가다. 유저의 (두서없을 수 있는) 글과 답변에서 지향하는 진로"
            " 방향과 현재 수준을 뽑아라. direction_keywords는 NCS 직무 검색에 쓰이니"
            " 직무·역량 중심의 한국어 명사 위주로. 유저가 방향을 몰라도 단서로 추론하라."
        )
        transcript = f"유저 글/목표: {goal_raw_text}\n\n질답:\n" + "\n".join(
            f"{m.role}: {m.content}" for m in messages
        )
        # chat과 동일 이유로 thinking 비활성(가벼운 추출, JSON 잘림 방지).
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=1024,
            thinking={"type": "disabled"},
            system=_cached_system(system),
            messages=[{"role": "user", "content": transcript}],
            output_config={"format": {"type": "json_schema", "schema": _INTENT_SCHEMA}},
        )
        if _refused(resp):
            raise RuntimeError("intent extraction refused")
        try:
            data = json.loads(_first_text(resp))
            return CareerIntent(
                summary=data["summary"],
                direction_keywords=[str(k) for k in data.get("direction_keywords", [])],
                current_level=data.get("current_level", "미상"),
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            # 잘리거나 비면 목표 텍스트로 최소 폴백 — 프리뷰가 하드 실패하지 않게.
            logger.warning("intent extraction returned unparsable JSON; using goal fallback")
            return CareerIntent(
                summary=goal_raw_text, direction_keywords=[goal_raw_text], current_level="미상"
            )

    async def select_ncs_job(
        self, intent: CareerIntent, candidates: list[NcsJobOption]
    ) -> str | None:
        if not candidates:
            return None
        system = (
            "너는 NCS(국가직무능력표준) 분류 전문가다. 유저의 진로 의중을 보고 아래 후보"
            " 직무 중 **실제로 대응하는 것 하나**의 코드를 골라라.\n\n"
            "가장 중요한 규칙 — 맞는 게 없으면 job_code를 null로 둬라:\n"
            "- 후보는 유저가 고른 분야 전체라서 대부분은 무관하다. 그럴듯한 것을 억지로"
            " 고르지 마라.\n"
            "- '관련 있음'과 '이 직무임'은 다르다. 예를 들어 간호사는 NCS에 없는데"
            " '병원행정'이 관련은 있다 — 이런 경우가 정확히 null이어야 하는 경우다.\n"
            "- 고른 직무는 로드맵 생성의 근거 자료로 쓰인다. 틀린 근거는 없는 근거보다"
            " 나쁘다.\n"
            "- job_code는 반드시 후보 목록에 있는 코드를 그대로 써라."
        )
        catalog = "\n".join(f"{c.code} {c.name} ({c.sclas_name})" for c in candidates)
        user = (
            f"유저 의중: {intent.summary}\n"
            f"현재 수준: {intent.current_level}\n"
            f"방향 키워드: {', '.join(intent.direction_keywords)}\n\n"
            f"후보 직무:\n{catalog}"
        )
        resp = await self._client.messages.create(
            model=self._extract_model,
            # 이 모델은 thinking 블록을 먼저 내보내고 그게 max_tokens를 함께 쓴다.
            # 예산이 빠듯하면 JSON이 중간에 잘려 파싱이 깨지므로 넉넉히 잡는다
            # (긴 대화 뒤에는 의중이 길어져 thinking도 같이 길어진다).
            max_tokens=2048,
            system=_cached_system(system),
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": _JOB_SELECT_SCHEMA}},
        )
        if _refused(resp) or getattr(resp, "stop_reason", None) == "max_tokens":
            # 잘린 응답은 파싱할 가치가 없다 — 판정 없이 폴백시킨다.
            logger.warning("NCS job selection truncated or refused; skipping")
            return None
        try:
            code = json.loads(_first_text(resp)).get("job_code")
        except (json.JSONDecodeError, AttributeError):
            logger.warning("NCS job selection returned unparsable output; skipping")
            return None
        if not code:
            return None
        # 환각 방어: 후보에 없는 코드는 버린다 (호출자도 DB로 한 번 더 검증한다).
        return code if any(c.code == code for c in candidates) else None

    async def synthesize_roadmap(self, context: RoadmapContext) -> GeneratedRoadmapSet:
        system = (
            "너는 전공 미정 대학생을 위한 진로 로드맵 설계자다. 주어진 의중·현재수준과"
            " NCS 능력단위(국가직무능력표준), 직종 리서치를 근거로 소분류 로드맵 세트를"
            " 설계하라.\n\n"
            "가장 중요한 원칙 — 현실적인 목표부터 잡아라:\n"
            "- '데이터 사이언티스트가 된다' 같은 막연한 직업 도달을 목표로 삼지 마라."
            " 대신 현재 수준에서 1~2학기(약 6개월) 안에 실제로 도달 가능한 '구체적 도약점'"
            " (예: 학회 지원 통과 역량, 미니 프로젝트 완성, 커피챗 3회)을 목표로 잡아라.\n\n"
            "대목표/소목표 구조 — 로드맵을 필요한 만큼 여러 개로 분리하라:\n"
            "- 유저의 장기 지향(예: '퀀트 되기')이 대목표, 각 로드맵은 그 아래의 독립적인"
            " 소목표다. 목표가 여러 역량 축(예: 수학 기초 / 통계 / 프로그래밍 / 프로젝트 /"
            " 네트워킹)에 걸치면 하나에 몰아넣지 말고 축별로 로드맵을 분리하라. 개수 제한은"
            " 없다 — 정말 필요한 만큼만, 각 로드맵은 한 주제에 집중해야 한다.\n"
            "- 각 로드맵은 '그대로 따라할 수 있는' 수준이어야 한다: 학습 로드맵이면 주차·챕터·"
            " 구체적 강의/책 단위로, '커피챗 3회' 같은 활동 로드맵이면 회차별 목표와 물어볼"
            " 질문 목록까지 detail에 구조화하라. '개념 익히기' 한 덩어리로 뭉개지 마라.\n"
            "- 로드맵 title은 소목표 명사구(예: '금융수학 기초 완성', '현직자 커피챗 3회')."
            " 대목표 문구('퀀트 되기')와 동일하거나 비슷하게 짓지 마라. 번호는 붙이지 마라"
            " (서버가 #1, #2를 붙인다).\n"
            "- major_goal: 이 세트가 속하는 대목표. '기존 대목표 목록'에 맞는 것이 있으면"
            " 그 id를 existing_goal_id로 지정하고 title은 그대로 써라. 없으면"
            " existing_goal_id=null, title은 짧은 명사구(예: '퀀트 되기'). context에는 이후"
            " 대화에서 재사용할 유저 프로필 요약(학년/수준/주당 시간/선호/제약)을 4~6문장으로"
            " 갱신해 써라 — 다음 로드맵 생성 때 같은 질문을 반복하지 않기 위한 것이다.\n"
            "- briefing: 로드맵을 보여주기 직전 코치가 건네는 2~3문장의 짧은 한국어 브리핑."
            " 왜 지금 대목표 직행이 아니라 이 소목표들이 현실적인 첫 단계인지 핵심만 짚어라."
            " 장황한 설명·나열은 금지 — 유저는 긴 글을 원하지 않는다. NCS 능력단위 이름 같은"
            " 전문용어도 브리핑엔 노출하지 마라(근거는 마일스톤 detail에만). 존댓말로,"
            " 격려하되 과장·군더더기 없이 간결하게.\n\n"
            "마일스톤 설계 (각 로드맵마다):\n"
            "- 로드맵당 4~10개의 작고 검증 가능한 마일스톤으로 분해하라. 각 단계는 이전 단계"
            " 위에 역량을 순차적으로 쌓아야 한다. 너무 크거나 막연한 단계(예: '실력 쌓기')"
            " 금지 — 무엇을 하면 끝나는지가 분명해야 한다.\n"
            "- 각 마일스톤은 두 필드로 쓴다:\n"
            "  · description: 콩나무 화면에 한 줄로 뜨는 핵심 프리뷰. 60자 이내, 명사형으로"
            " 간결하게. 장황한 설명 금지.\n"
            "  · detail: 클릭 시 보이는 상세 가이드. 4~8문장으로 (1)이 마일스톤이 무엇이고"
            " 왜 필요한지, (2)어떻게 달성하는지 — 구체적인 강의/책/도구/자격증·시험/활동/"
            "산출물을 실명이나 유형으로 제시(챕터·주차·질문 목록 등 실행 단위까지), (3)'무엇을"
            " 하면 이 단계를"
            " 완료한 것으로 보는지' 완료 기준을 명확히 써라. 관련 NCS 능력단위가 있으면"
            " detail에 근거로 언급하라.\n"
            "- 리서치의 학회·대외활동은 detail에서 구체적으로 추천하되, 전문가는 특정인을"
            " 지목하지 말고 '이런 키워드로 현직자를 찾아 커피챗을 요청하라' 형태로 안내하라.\n"
            "- 개인 맞춤 딥리서치(웹 검색): 이 유저의 분야·현재 수준·목표 시점에 맞춰 실제로"
            " 존재하는 구체적 자원을 검색해 실명으로 로드맵에 녹여라 — 특히 ①관련 자격증·"
            "공인/어학 시험(정확한 명칭, 난이도, 다음 응시 시기나 준비 기간, 이 유저 수준에서"
            " 지금 현실적인지), ②최신 강의·교재, ③학회·동아리, ④공모전·대회, ⑤인턴/대외활동"
            " 공고 유형, ⑥장학금·부트캠프·정부지원 프로그램. 유저 수준에 안 맞는 것(너무 높은"
            " 자격증 등)은 넣지 말고 단계적으로 밟을 수 있게 배치하라. 검색으로 확인되지 않는"
            " 것은 실명 대신 유형으로만 제시하고 절대 지어내지 마라.\n"
            "- 현장 신호(웹 검색 — 최소 1회는 반드시 여기에 배정하라): 자원(자격증·강의) 검색과"
            " 별개로, 이 직무의 '실제 현실'을 **공개 색인된 현직자 후기**에서 검색해 로드맵에"
            " 반영하라. 로그인 벽 뒤라 검색이 얕은 곳(LinkedIn·블라인드 비공개)에 매달리지 말고,"
            " 실제로 검색되는 공개 소스를 우선하라 — 잡플래닛·블라인드 공개글·인디드/글래스도어"
            " 리뷰·링크드인 공개글·현직자 블로그. 이 직무로 진입한 사람들이 공통적으로 말하는 준비"
            " 방향, 실무에서 진짜 요구되는 역량, 흔한 후회·조언, 변별력 없는 흔한 실수(예: 남들 다"
            " 하는 튜토리얼식 포트폴리오)를 파악해 마일스톤 설계에 녹여라. 컴플라이언스: 공개 색인된"
            " 페이지의 익명 요지만 요약하고 원문을 복제하지 마라. 특정 개인을 지목·저장하지 말고"
            " 개인정보는 저장하지 마라. 확인 안 되면 지어내지 마라.\n"
            "- 현재 수준에 맞춰 난이도를 조정하고, due_date는 오늘로부터 2주~6개월 사이로"
            " 로드맵 내에서 순서대로(겹치지 않게) 배치하라. 서로 다른 로드맵은 병행 가능하므로"
            " 기간이 겹쳐도 된다.\n"
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

        async def _run(with_tools: bool) -> Message:
            kwargs: dict = {}
            if with_tools:
                # 7 = 자원(자격증·강의·공모전·공고) 검색 5회분 + 현장 신호(현직자 후기)
                # 검색 여유 2회분. 5로는 자원 검색이 예산을 다 먹어 현장 신호가 밀렸다.
                kwargs["tools"] = [
                    {"type": "web_search_20260209", "name": "web_search", "max_uses": 7}
                ]
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
                **kwargs,
            ) as stream:
                return await stream.get_final_message()

        async def _run_resilient(with_tools: bool) -> Message:
            """스트림이 중간에 끊기는(httpx.ReadError = 연결 리셋, 타임아웃 아님)
            간헐적 전송 오류를 짧은 백오프로 재시도한다. SDK 자동 재시도는 스트리밍
            시작 후의 중단을 커버하지 않으므로 여기서 직접 감싼다."""
            last_exc: Exception | None = None
            for attempt in range(3):
                try:
                    return await _run(with_tools)
                except (APIConnectionError, httpx.HTTPError) as exc:
                    last_exc = exc
                    logger.warning(
                        "synthesize stream dropped (attempt %d/3, tools=%s): %s",
                        attempt + 1,
                        with_tools,
                        exc,
                    )
                    await asyncio.sleep(1.5 * (attempt + 1))
            assert last_exc is not None
            raise last_exc

        # 웹서치는 실험 설정(LLM_SYNTHESIS_WEB_SEARCH)일 때만. 구조화 출력과의
        # 조합이 거부되면(400) 툴 없이 폴백 — 품질 저하일 뿐 실패는 아니다.
        # 웹서치가 연결을 계속 끊는 경우(재시도 소진)도 툴 없이 강등해 로드맵은 낸다.
        if self._synthesis_web_search:
            try:
                message = await _run_resilient(with_tools=True)
            except BadRequestError:
                message = await _run_resilient(with_tools=False)
            except (APIConnectionError, httpx.HTTPError):
                logger.warning("web search kept dropping the stream; degrading to no-tools")
                message = await _run_resilient(with_tools=False)
        else:
            message = await _run_resilient(with_tools=False)

        if _refused(message):
            raise RuntimeError("roadmap synthesis refused")
        raw = _last_text(message)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = _lenient_json(raw)
            if not data:
                raise RuntimeError("roadmap synthesis returned non-JSON output") from None
        items = [
            GeneratedRoadmapItem(
                title=r["title"],
                milestones=[
                    GeneratedMilestone(
                        title=m["title"],
                        description=m["description"],
                        detail=m["detail"],
                        due_date=datetime.strptime(m["due_date"], "%Y-%m-%d").date(),
                    )
                    for m in r["milestones"]
                ],
            )
            for r in data["roadmaps"]
        ]
        mg = data["major_goal"]
        raw_id = mg.get("existing_goal_id")
        return GeneratedRoadmapSet(
            briefing=data["briefing"],
            major_goal=MajorGoalDecision(
                existing_goal_id=int(raw_id) if raw_id is not None else None,
                title=mg["title"],
                context=mg["context"],
            ),
            items=items,
            source_urls=_web_search_domains(message),
        )

    async def select_relevant_departments(self, goal_text: str) -> list[str]:
        """진로 목표를 보고 관련 단과대/학과를 고른다 (수업 후보 좁히기 1단계).

        임베딩 유사도는 쓰지 않는다 — "관련 있어 보임"과 "실제 그 학과 수업이 필요함"을
        구분 못 해 이전 NCS 매칭에서 폐기된 접근이다. 대신 넓게 카테고리를 좁힌 뒤
        cluster_courses에서 실제 과목 단위로 다시 판단한다.
        """
        system = (
            "너는 연세대학교 교과과정 전문가다. 학생의 진로 목표를 보고, 관련 수업이"
            " 있을 만한 단과대학/학과 이름을 한국어로 나열하라 (예: '경영대학',"
            " '문과대학 사회학과', 'Underwood International College'). 실제로 관련"
            " 수업이 있을 만한 곳은 폭넓게 포함하되, 명백히 무관한 곳은 넣지 마라."
            " 목표가 너무 막연하거나 어떤 학과와도 관련짓기 어려우면 빈 배열을"
            " 반환하라 — 억지로 채우지 마라."
        )
        # 가벼운 카테고리 판단이라 thinking 불필요(다른 경량 호출과 동일 이유 — 잘림 방지).
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=1024,
            thinking={"type": "disabled"},
            system=_cached_system(system),
            messages=[{"role": "user", "content": f"진로 목표: {goal_text}"}],
            output_config={"format": {"type": "json_schema", "schema": _DEPARTMENT_SCHEMA}},
        )
        if _refused(resp):
            return []
        try:
            data = json.loads(_first_text(resp))
            return [str(d) for d in data.get("departments", [])]
        except (json.JSONDecodeError, KeyError, TypeError):
            logger.warning("department selection returned unparsable JSON; returning empty")
            return []

    async def cluster_courses(
        self,
        goal_text: str,
        courses: list[CourseOption],
        rules_context: str | None = None,
    ) -> CourseClusterResult:
        """좁혀진 후보 과목 중 목표에 맞는 것을 골라 이름 붙인 군집으로 묶는다."""
        if not courses:
            return CourseClusterResult(clusters=[])
        system = (
            "너는 연세대학교 커리큘럼 어드바이저다. 학생의 진로 목표와 아래 후보 수업"
            " 목록을 보고, 목표 달성에 실제로 도움이 되는 수업만 골라 의미 있는 이름의"
            " 군집(cluster)으로 묶어라.\n\n"
            "규칙:\n"
            "- 군집 이름은 목표에 맞춰 즉석에서 지어라(예: '재무·회계 기초', '데이터"
            " 분석'). 고정된 이름을 쓰지 마라.\n"
            "- 각 과목의 code는 후보 목록에 있는 그대로 정확히 써라(지어내지 마라).\n"
            "- '관련 있어 보임'이 아니라 실제로 이 목표에 필요한 수업만 골라라. 정말"
            " 무관한 후보는 아예 빼도 된다 — 억지로 다 채우지 마라.\n"
            "- reason은 이 과목이 왜 이 목표에 맞는지 한 줄로.\n"
            "- level은 과목의 계층(1000~4000)이고 years는 수강 가능 학년이다 — 서로"
            " 다른 개념이니 혼동하지 마라. 1학년 수준의 목표라면 4000단위 수업으로"
            " 시작을 이끌지 마라(도약이 너무 크다) — 단, 아예 배제하라는 뜻은 아니다.\n"
            "- advice: 이 군집 전체가 왜 이 목표에 필요한지 한국어 2~4문장으로 구체적"
            " 근거를 들어 설명하라. 참고 규정이 주어지면(전과 선이수 학점, 복수전공"
            " 정원 등) 그 내용을 근거로 활용하라. 못 채우겠으면 null로 둬라."
        )
        catalog = "\n".join(
            f"{c.code} | {c.name} | level={c.level} | years={c.years} | kind={c.kind}"
            f" | {c.department or ''} | {(c.description or '')[:200]}"
            for c in courses
        )
        user = f"진로 목표: {goal_text}\n\n후보 수업 목록:\n{catalog}"
        system_blocks = _cached_system(system)
        if rules_context:
            system_blocks.append(
                {
                    "type": "text",
                    "text": f"참고 규정(학사 정보):\n{rules_context}",
                    "cache_control": {"type": "ephemeral"},
                }
            )
        # 후보가 많을 수 있는 판단이라 출력 예산을 넉넉히 잡는다(advice 필드가 늘어난 만큼
        # ~700~1200 토큰 여유를 더 둔다). thinking은 끈다 — 이 코드베이스에서 세 번
        # 반복된 함정(작은 max_tokens + thinking = JSON 잘림), 절대 건드리지 말 것.
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=12000,
            thinking={"type": "disabled"},
            system=system_blocks,
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": _COURSE_CLUSTER_SCHEMA}},
        )
        if _refused(resp) or getattr(resp, "stop_reason", None) == "max_tokens":
            logger.warning("course clustering truncated or refused; returning empty")
            return CourseClusterResult(clusters=[])
        try:
            data = json.loads(_first_text(resp))
        except json.JSONDecodeError:
            logger.warning("course clustering returned unparsable JSON; returning empty")
            return CourseClusterResult(clusters=[])

        by_code = {c.code: c for c in courses}
        clusters: list[CourseCluster] = []
        for raw_cluster in data.get("clusters", []):
            clustered: list[ClusteredCourse] = []
            for raw_course in raw_cluster.get("courses", []):
                code = raw_course.get("code")
                course = by_code.get(code)
                if course is None:
                    continue  # 환각 방어: 후보에 없는 코드는 버린다.
                clustered.append(
                    ClusteredCourse(
                        code=course.code,
                        name=course.name,
                        level=course.level,
                        reason=str(raw_course.get("reason", "")),
                    )
                )
            if clustered:
                clusters.append(
                    CourseCluster(
                        name=str(raw_cluster.get("name", "")),
                        courses=clustered,
                        advice=raw_cluster.get("advice") or None,
                    )
                )
        return CourseClusterResult(clusters=clusters)

    async def suggest_support_elements(
        self, goal_text: str, rules_context: str | None = None
    ) -> SupportBinResult:
        """수업이 아닌 비교과 준비 요소(자격증/학회/대외활동/네트워킹)를 군집으로 제안한다.

        cluster_courses는 code가 후보 목록에 있는지로 환각을 걸러내지만(by_code
        검증), 이 요소들은 애초에 고정 카탈로그가 없어 같은 방어를 적용할 수 없다.
        그래서 별도의 가벼운 구조화 출력 호출로 분리한다 — 결과는 어디까지나 AI
        제안이며 카탈로그 그라운딩이 없다는 점을 프롬프트에서도 못박는다.
        """
        if not goal_text.strip():
            return SupportBinResult(bins=[])
        system = (
            "너는 대학생 진로 코치다. 아래 목표를 이루기 위한 '수업 외' 준비 요소를"
            " 제안하라 — 자격증, 학회/동아리, 대외활동/공모전, 네트워킹(현직자 접촉 등)"
            " 네 종류만 다룬다(수업은 별도 파이프라인이 처리하니 여기서 다루지 마라).\n\n"
            "규칙:\n"
            "- 2~4개의 군집(bin)으로 묶어라. 군집 이름은 목표에 맞춰 즉석에서 지어라"
            "(예: '데이터 분석 자격증', '금융권 네트워킹'). 고정된 이름을 쓰지 마라.\n"
            "- 군집마다 3~6개의 항목(element)을 담아라.\n"
            "- 각 항목의 type은 certification/organization/activity/networking 중"
            " 정확히 하나여야 한다.\n"
            "- label: 항목 이름(예: 'ADsP', '금융공학회'). subtitle: 팝오버 위에 뜨는"
            " 짧은 부제(예: '데이터분석 준전문가', '학내 학회'). description: 팝오버 안에"
            " 보이는 2~3줄 설명 — 왜 필요한지, 어떻게 준비/참여하는지.\n"
            "- 군집마다 advice: 이 군집이 목표에 왜 필요한지 한국어 2~4문장으로 구체적"
            " 근거를 들어 설명하라. 참고 규정이 주어지면(전과 선이수 학점, 복수전공"
            " 정원 등) 그 내용을 근거로 활용하라.\n"
            "- 이 결과는 AI 제안일 뿐 공식 카탈로그 그라운딩이 없다는 점을 감안해라."
            " 실명 단체·자격증은 국내에 널리 알려진 것만 제시하고, 확신이 없는 것은"
            " 유형으로만 제시하고 절대 지어내지 마라."
        )
        system_blocks = _cached_system(system)
        if rules_context:
            system_blocks.append(
                {
                    "type": "text",
                    "text": f"참고 규정(학사 정보):\n{rules_context}",
                    "cache_control": {"type": "ephemeral"},
                }
            )
        # 가벼운 판단이라 thinking 비활성(다른 경량 호출과 동일 이유 — JSON 잘림 방지).
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=2000,
            thinking={"type": "disabled"},
            system=system_blocks,
            messages=[{"role": "user", "content": f"진로 목표: {goal_text}"}],
            output_config={"format": {"type": "json_schema", "schema": _SUPPORT_ELEMENTS_SCHEMA}},
        )
        if _refused(resp) or getattr(resp, "stop_reason", None) == "max_tokens":
            logger.warning("support element suggestion truncated or refused; returning empty")
            return SupportBinResult(bins=[])
        try:
            data = json.loads(_first_text(resp))
        except json.JSONDecodeError:
            logger.warning("support element suggestion returned unparsable JSON; returning empty")
            return SupportBinResult(bins=[])

        bins: list[SupportBin] = []
        for raw_bin in data.get("bins", []):
            elements = [
                SupportElement(
                    label=str(raw_el.get("label", "")),
                    type=str(raw_el.get("type", "")),
                    subtitle=raw_el.get("subtitle") or None,
                    description=raw_el.get("description") or None,
                )
                for raw_el in raw_bin.get("elements", [])
                if raw_el.get("label")
            ]
            if elements:
                bins.append(
                    SupportBin(
                        name=str(raw_bin.get("name", "")),
                        advice=raw_bin.get("advice") or None,
                        elements=elements,
                    )
                )
        return SupportBinResult(bins=bins)

    async def suggest_draft_constellations(
        self, goal_text: str, bins_payload: list[dict]
    ) -> DraftResult:
        """bins의 실제 item id로만 별자리 초안 3개를 구성한다.

        cluster_courses의 by_code 검증과 동일한 이유로 여기서도 파싱 후 한 번 더
        검증한다: bins에 없는 item_id는 버리고, 버려진 id를 참조하는 edge도 함께
        버린다. 방어 후 항목이 3개 미만으로 줄어든 초안은 아예 버린다(호출자인
        bin_suggestion이 wire dict로 바꾸기도 전에 여기서 먼저 걸러 둔다).
        """
        all_ids = {item["id"] for b in bins_payload for item in b.get("items", [])}
        if not all_ids:
            return DraftResult(drafts=[])
        system = (
            "너는 진로 탐색 별자리 설계자다. 아래 '원소 보관함(bins)' 안의 항목들로"
            " 사용자가 고를 수 있는 별자리 초안 3개를 구성하라.\n\n"
            "규칙:\n"
            "- 각 초안 = name(짧은 은유형 이름, 예: '관찰하는 사람'), tagline(한 줄"
            " 설명), item_ids(제공된 bins의 item id 중 4~7개), edges(그 item_ids"
            " 사이의 연결 4~7쌍, 대체로 하나로 이어진 경로 형태).\n"
            "- item_ids는 반드시 아래 카탈로그에 있는 id를 정확히 그대로 써라 - 절대"
            " 지어내지 마라.\n"
            "- edges의 각 쌍은 반드시 그 초안의 item_ids 안에 있는 두 id로만"
            " 구성하라.\n"
            "- 세 안은 서로 다른 **수업 트랙**으로 구분하라 - 같은 수업(item_ids 중"
            " type이 course인 항목)이 두 안에 두 번 이상 등장하지 않게 하라(지원"
            " 요소/비교과는 트랙과 무관하니 여러 안에 공유해도 된다). 예를 들어 한"
            " 안은 마케팅 계열 수업 위주, 다른 안은 전략/경영 계열 수업 위주로"
            " 짜는 식이다 - 페르소나 이름만 다르고 실제로는 같은 수업을 재포장한"
            " 안이 되지 않게 하라.\n"
            "- 안의 name/tagline은 그 안의 실제 수업 트랙 내용을 반영하라(예:"
            " '마케팅 중심', '전략 중심') - 막연한 은유가 아니라 트랙이 무엇인지"
            " 드러나야 한다."
        )
        catalog = "\n".join(
            f"[보관함: {b.get('label', '')}] "
            + ", ".join(f"{item['id']}={item['label']}" for item in b.get("items", []))
            for b in bins_payload
        )
        user = f"진로 목표: {goal_text}\n\n원소 보관함:\n{catalog}"
        # 가벼운 구성 판단이라 다른 경량 호출과 동일하게 thinking 비활성(JSON 잘림 방지).
        resp = await self._client.messages.create(
            model=self._extract_model,
            max_tokens=3000,
            thinking={"type": "disabled"},
            system=_cached_system(system),
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": _DRAFTS_SCHEMA}},
        )
        if _refused(resp) or getattr(resp, "stop_reason", None) == "max_tokens":
            logger.warning("draft constellation suggestion truncated or refused; returning empty")
            return DraftResult(drafts=[])
        try:
            data = json.loads(_first_text(resp))
        except json.JSONDecodeError:
            logger.warning(
                "draft constellation suggestion returned unparsable JSON; returning empty"
            )
            return DraftResult(drafts=[])

        drafts: list[DraftConstellation] = []
        for raw in data.get("drafts", []):
            item_ids = [i for i in raw.get("item_ids", []) if i in all_ids]  # 환각 방어
            item_id_set = set(item_ids)
            edges = [
                (pair[0], pair[1])
                for pair in raw.get("edges", [])
                if len(pair) == 2 and pair[0] in item_id_set and pair[1] in item_id_set
            ]
            if len(item_ids) < 3:
                continue
            drafts.append(
                DraftConstellation(
                    name=str(raw.get("name", "")),
                    tagline=str(raw.get("tagline", "")),
                    item_ids=item_ids,
                    edges=edges,
                )
            )
        return DraftResult(drafts=drafts)

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
            "4) 현직자 현장 신호 — 공개 색인된 현직자 후기(잡플래닛·블라인드 공개글·인디드/"
            "글래스도어 리뷰·링크드인 공개글·현직자 블로그)에서 이 직무 진입자들이 공통적으로"
            " 말하는 실무 요구 역량·흔한 후회·조언·변별력 없는 흔한 실수. 특정 개인 지목·개인정보"
            " 저장 금지, 익명 요지만.\n"
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
