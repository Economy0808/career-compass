"""인테이크(intake) 화면 - 목표 질답 + 원소 보관함(bin) 제안 API 스키마.

와이어 포맷 규약은 app/schemas/constellation.py와 동일하다(모듈 docstring 참고):
camelCase 키, `_CamelModel`(alias_generator=to_camel + populate_by_name=True).
이 모듈은 그 `_CamelModel`을 그대로 재사용한다 - 별도로 복제하지 않는다.

JobStatusOut.result는 app/services/bin_suggestion.py가 만드는 이미 wire-ready한
camelCase dict({"bins": [...]})를 그대로 통과시킨다 - bin_suggestion 모듈 docstring이
그 dict 계약을 명시하고 있으므로, 여기서 Pydantic 모델로 다시 감싸지 않는다
(재모델링하면 계약이 두 곳에 흩어져 한쪽만 갱신되는 사고가 나기 쉽다).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.constellation import _CamelModel

ChatRole = Literal["user", "assistant"]

# 질답 메시지 하나의 길이 상한 - Firebase 경로 전용(roadmap.py의 ChatMessageIn과 별개 모델).
_MAX_MESSAGE_CONTENT_LEN = 2000
# 무한 질문 루프 방지: 프론트가 보낸 히스토리가 비정상적으로 길어지는 것을 막는 상한.
_MAX_MESSAGES = 40


class ChatMessageIn(_CamelModel):
    """질답 메시지 (요청)."""

    role: ChatRole
    content: str = Field(max_length=_MAX_MESSAGE_CONTENT_LEN)


class ChatMessageOut(_CamelModel):
    """질답 메시지 (응답)."""

    role: ChatRole
    content: str = Field(max_length=_MAX_MESSAGE_CONTENT_LEN)


class IntakeChatIn(_CamelModel):
    """POST /chat 요청. Stateless - 프론트가 messages 전체 히스토리를 들고 재전송한다."""

    goal_raw_text: str = Field(min_length=1, max_length=2000)
    messages: list[ChatMessageIn] = Field(default_factory=list, max_length=_MAX_MESSAGES)


class IntakeChatOut(_CamelModel):
    """POST /chat 응답. messages는 서버가 assistant 턴을 덧붙인 갱신본이다.

    프론트는 이 messages를 그대로 들고 있다가 다음 유저 답변만 append해 재전송하면
    되므로, 클라이언트가 직접 히스토리를 조립할 필요가 없다(roadmap.py /chat과 동일한
    계약).
    """

    reply: str | None
    done: bool
    messages: list[ChatMessageOut]
    # 입력 보조 힌트/칩 (board 3) - done=true면 각각 None/[].
    hint: str | None = None
    options: list[str] = Field(default_factory=list)


class BinSuggestIn(_CamelModel):
    """POST /bins 요청 - 목표 텍스트 하나로 전체 보관함 세트를 제안받는다."""

    goal_text: str = Field(min_length=1, max_length=2000)


class BinFillIn(_CamelModel):
    """POST /bins/fill 요청 - 유저가 만든 보관함 하나를 라벨에 맞춰 채운다."""

    goal_text: str = Field(min_length=1, max_length=2000)
    bin_label: str = Field(min_length=1, max_length=60)


class JobStartOut(_CamelModel):
    """POST /bins, /bins/fill 접수 응답(202) - job_id로 GET /jobs/{job_id}를 폴링한다."""

    job_id: str
    status: str  # pending | running | done | error


class JobStatusOut(_CamelModel):
    """GET /jobs/{job_id} 폴링 응답.

    result: bin_suggestion.suggest_all_bins/fill_single_bin이 만든 wire-ready
    camelCase dict를 그대로 통과시킨다(모듈 docstring 참고) - 별도 스키마로 재모델링하지
    않는다.
    """

    status: str  # pending | running | done | error
    result: dict[str, Any] | None = None
    detail: str | None = None
