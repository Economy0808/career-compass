"""로드맵 질답/생성을 담당하는 LLM 클라이언트의 공통 인터페이스.

/chat는 stateless: 프론트가 전체 대화 히스토리(messages)를 들고 있다가
매 호출마다 재전송한다. 백엔드/LLM 클라이언트는 호출 간 상태를 갖지 않는다.
"""
from dataclasses import dataclass
from datetime import date
from typing import Literal, Protocol

Role = Literal["user", "assistant"]


@dataclass
class ChatMessage:
    role: Role
    content: str


@dataclass
class ChatTurn:
    done: bool
    question: str | None  # done=True이면 None


@dataclass
class GeneratedMilestone:
    title: str
    description: str
    due_date: date


@dataclass
class GeneratedRoadmap:
    title: str
    milestones: list[GeneratedMilestone]


class LLMClient(Protocol):
    async def chat(self, goal_raw_text: str, messages: list[ChatMessage]) -> ChatTurn:
        """지금까지의 질답(messages)을 보고 다음 질문을 내거나 종료를 판단한다."""
        ...

    async def generate_roadmap(
        self, goal_raw_text: str, messages: list[ChatMessage]
    ) -> GeneratedRoadmap:
        """완료된 질답(messages)을 바탕으로 구조화된 로드맵을 생성한다."""
        ...
