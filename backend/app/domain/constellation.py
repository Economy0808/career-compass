"""별자리(constellation) 로드맵의 순수 도메인 모델.

DB/Firestore 클라이언트에 대한 의존성이 전혀 없다 - 순수 데이터 구조 + 순수 함수로만
구성해 pytest만으로 단위 테스트하고, 이후 Cloud Run 핸들러에서 그대로 재사용한다.
기존 콩나무(beanstalk) 시스템(app/models/roadmap.py)과는 완전히 별개이며, 그 쪽의
마일스톤/시듦 개념을 계승하지 않는다.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 노드 종류: 알려진 값들을 상수로 노출하되 타입 자체는 permissive한 str로 둔다.
# 군집(bin)은 고정 목록이 아니라 LLM이 목표별로 즉석에서 결정하고, 유저가 직접
# 새 군집을 만들면 LLM이 그걸 리서치해서 채운다 - 즉 "새로운 노드 종류"가 언제든
# 생길 수 있는 구조다. Literal/StrEnum으로 닫힌 집합을 강제하면 LLM이 새 군집을
# 제안할 때마다 스키마 검증이 깨진다. 따라서 NodeType은 str 서브타입으로 열어두고,
# 자주 쓰이는 값들만 상수로 문서화해 오타 방지 + 자동완성 용도로 제공한다.
NodeType = str


class NodeTypes:
    """자주 쓰이는 노드 종류 상수 모음 (닫힌 집합 아님, 참고용)."""

    COURSE = "course"  # 수업
    ORGANIZATION = "organization"  # 학회/동아리
    CERTIFICATION = "certification"  # 자격증
    ACTIVITY = "activity"  # 대외활동
    NETWORKING = "networking"  # 네트워킹
    CUSTOM = "custom"  # 사용자 직접 입력


NodeOrigin = Literal["llm_suggested", "user_added"]


class Position(BaseModel):
    """캔버스 위의 좌표."""

    x: float
    y: float


class Node(BaseModel):
    """별자리의 노드 = 하나의 별."""

    id: str
    label: str
    type: NodeType
    # 참고 자료(예: 강의 코드) 문서 참조. 유저가 자유 입력한 노드는 None.
    source_ref: str | None = None
    is_completed: bool = False
    position: Position
    origin: NodeOrigin
    created_at: datetime


class Edge(BaseModel):
    """노드를 잇는 선.

    의미상 무방향(유저가 그냥 이었을 뿐, 선후관계 없음)이지만 저장 형태는
    source/target을 갖는다. type 필드는 아직 추가하지 않는다 (YAGNI - 필요해지면
    그때 추가).
    """

    id: str
    source_node_id: str
    target_node_id: str


class Constellation(BaseModel):
    """별자리 전체."""

    id: str
    owner_id: str  # Firebase Auth UID
    title: str
    goal_raw_text: str
    # dict로 저장하는 이유: Firestore는 점 표기 부분 업데이트를 지원한다
    # (예: "nodes.abc123.position"). 노드를 드래그하거나 완료 체크할 때마다
    # 그래프 전체 배열을 다시 쓰지 않고 해당 노드 하나만 갱신할 수 있다.
    nodes: dict[str, Node] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)
    is_published: bool = False
    created_at: datetime
    updated_at: datetime


def compute_progress_pct(nodes: dict[str, Node]) -> float:
    """완료된 노드 비율(0~100)을 계산한다.

    노드가 하나도 없으면 0.0을 반환한다 (ZeroDivisionError 방지).
    기존 콩나무 시스템의 progress_from_counts 관례를 따라 소수점 첫째 자리까지
    반올림한다.
    """
    if not nodes:
        return 0.0
    completed = sum(1 for n in nodes.values() if n.is_completed)
    return round(completed / len(nodes) * 100, 1)


def compute_node_counts(nodes: dict[str, Node]) -> tuple[int, int]:
    """(완료 노드 수, 전체 노드 수). 피드 카드에 진행률을 비정규화해 저장할 때 쓴다."""
    completed = sum(1 for n in nodes.values() if n.is_completed)
    return completed, len(nodes)


def is_edge_lit(edge: Edge, nodes: dict[str, Node]) -> bool:
    """인접 발광(adjacency glow) 규칙: 양 끝 노드가 모두 존재하고 모두 완료일 때만 True.

    엣지가 가리키는 노드 id가 nodes에 없어도(노드 삭제 후 엣지 정리가 안 된 과도기
    상태) 예외를 던지지 않고 False를 반환한다. 프론트엔드가 TypeScript로 이 규칙을
    다시 구현하므로, 이 함수는 백엔드 검증/테스트용이자 규칙의 정본(canonical) 역할을 한다.
    """
    source = nodes.get(edge.source_node_id)
    target = nodes.get(edge.target_node_id)
    if source is None or target is None:
        return False
    return source.is_completed and target.is_completed


def prune_orphan_edges(nodes: dict[str, Node], edges: dict[str, Edge]) -> dict[str, Edge]:
    """source/target 노드가 더 이상 존재하지 않는 엣지를 제거한 새 dict를 반환한다.

    노드 삭제 시 매달린 엣지가 남지 않도록 호출한다. 입력을 변경하지 않는 순수 함수.
    """
    return {
        edge_id: edge
        for edge_id, edge in edges.items()
        if edge.source_node_id in nodes and edge.target_node_id in nodes
    }
