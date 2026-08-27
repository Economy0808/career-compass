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
    # code와 구분할 것: source_ref는 출처(provenance) - 이 노드 정보가 어디서
    # 왔는지 가리키는 외부 자료 링크이고, code는 그 노드 자체를 UI에 표시할 때
    # 라벨 옆에 보여주는 화면용 학정번호/코드다.
    source_ref: str | None = None
    # 표시용 학정번호/코드 (예: "PHI1001"). UI가 라벨 옆에 그대로 노출한다.
    code: str | None = None
    # 팝오버에 2~3줄로 보여줄 설명문.
    description: str | None = None
    # 학년/난이도. 프론트엔드 CanvasNode.level에 대응한다.
    level: int | None = None
    is_completed: bool = False
    position: Position
    origin: NodeOrigin
    created_at: datetime
    # notes 서브컬렉션 문서 수의 비정규화 캐시. note_repo가 노트 생성/삭제
    # 트랜잭션 안에서 함께 갱신해 정합성을 유지한다.
    note_count: int = 0


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


class NoteAttachment(BaseModel):
    """노트에 첨부된 파일 한 건."""

    id: str
    name: str
    mime_type: str
    url: str


class Note(BaseModel):
    """노드에 달리는 메모.

    Firestore 서브컬렉션 constellations/{constellation_id}/notes/{note_id}에
    저장한다.

    CRITICAL: title과 body가 빈 문자열인 것은 의도적으로 허용되는 상태다
    ("빈 노트"도 지원 대상 제품 기능) - min_length 등으로 빈 문자열을 거부하는
    검증기를 추가하지 말 것.
    """

    id: str
    node_id: str
    # 부모 별자리의 owner_id를 비정규화해 그대로 복사해둔 값. update/delete/list가
    # 매번 부모 별자리 문서를 읽지 않고도 소유권을 검증할 수 있게 한다.
    # 소유권은 노트 생성 이후 바뀌지 않으므로(불변) stale해질 위험이 없다.
    owner_id: str
    title: str = ""
    body: str = ""
    # 기본값 False: 실수로 공개되는 쪽이 실수로 비공개되는 쪽보다 더 해로우므로
    # 기본은 비공개.
    is_public: bool = False
    attachments: list[NoteAttachment] = Field(default_factory=list)
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
