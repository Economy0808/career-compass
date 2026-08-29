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

# 노드 커스텀 색상 hex 패턴. 프론트 팔레트가 "#RRGGBB" 형식만 보내므로 그 외
# 형식(짧은 hex, 색상명, alpha 채널 등)은 422로 거부한다. 스키마 계층(NodeCreateIn/
# ColorPatchIn)과 이 도메인 모델 양쪽에 동일 패턴을 걸어둔다 - 스키마 쪽이 실제
# HTTP 422 응답을 만들어내는 지점이고, 도메인 쪽은 Node를 직접 생성하는 다른
# 호출부(테스트 등)에도 같은 불변식을 강제하기 위한 이중 방어선이다.
NODE_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"

# 노드 달성 연출(glow effect) 프리셋 id 패턴. 서버는 프리셋의 의미(어떤 애니메이션인지)를
# 전혀 모른다 - 프론트가 정의한 프리셋 id 문자열을 그대로 저장/반환할 뿐이다. 형식만
# "소문자로 시작하는 소문자/숫자/하이픈 슬러그"로 검증해 임의 문자열 주입을 막는다.
# 길이 제한(1~24자)은 NodeCreateIn/GlowPatchIn의 min_length/max_length와 함께 건다.
NODE_GLOW_PATTERN = r"^[a-z][a-z0-9-]*$"

# 군집(bin)의 출처. NodeOrigin("llm_suggested"/"user_added")과는 값 집합이 다르다 -
# 프론트엔드 Bin.origin 계약("llm"|"user")을 그대로 따른다. 두 Literal을 하나로
# 합치면 안 된다: 노드와 빈은 서로 다른 프론트엔드 타입이고, 값 문자열 자체가
# 다르므로(예: "llm" vs "llm_suggested") 혼용하면 와이어 포맷이 깨진다.
BinOrigin = Literal["llm", "user"]


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
    # 프론트 팔레트에서 고른 커스텀 색상. None이면 프론트가 타입별 기본 색을 쓴다.
    color: str | None = Field(default=None, pattern=NODE_COLOR_PATTERN)
    # 달성 연출(glow effect) 프리셋 id. None이면 프론트가 기본 연출을 쓴다.
    # 서버는 프리셋 문자열의 의미를 모르며 형식(NODE_GLOW_PATTERN)만 검증한다.
    glow_effect: str | None = Field(
        default=None, pattern=NODE_GLOW_PATTERN, min_length=1, max_length=24
    )


class Edge(BaseModel):
    """노드를 잇는 선.

    의미상 무방향(유저가 그냥 이었을 뿐, 선후관계 없음)이지만 저장 형태는
    source/target을 갖는다. type 필드는 아직 추가하지 않는다 (YAGNI - 필요해지면
    그때 추가).
    """

    id: str
    source_node_id: str
    target_node_id: str
    # 프론트 팔레트에서 고른 커스텀 색상. Node.color와 동일 규칙(None이면 프론트 기본색).
    color: str | None = Field(default=None, pattern=NODE_COLOR_PATTERN)


class BinItem(BaseModel):
    """군집(bin) 안에 담긴 아이템 한 건.

    아이템 id 규약: 수업은 "course:{학정번호}", 비수업(자격증/대외활동 등 유저가
    직접 추가하거나 LLM이 제안한 항목)은 "support:{uuid}". 이 규약은 프론트엔드와
    합의된 것으로, 백엔드는 값을 그대로 통과시킬 뿐 강제 검증하지 않는다(형식이
    바뀌어도 이 스키마가 깨지지 않도록 str로만 취급).
    """

    id: str
    label: str
    type: NodeType
    level: int | None = None
    subtitle: str | None = None
    description: str | None = None


class Bin(BaseModel):
    """우측 패널 보관함(bin) 한 칸.

    LLM이 목표 분석 시 제안하거나("llm") 유저가 직접 만든("user") 군집이다.
    캔버스에 아직 배치하지 않은 후보 아이템들을 여기 모아두었다가, 유저가
    끌어다 놓으면 실제 Node로 승격된다(그 변환 로직은 이 모듈이 아니라 API
    레이어의 책임).
    """

    id: str
    label: str
    origin: BinOrigin
    advice: str | None = None
    items: list[BinItem] = Field(default_factory=list)


class Group(BaseModel):
    """캔버스 성단(cluster) - 노드 여러 개를 묶어 접힌 상태로 표시하는 그룹.

    요소가 너무 많아지면 프론트가 이걸 노드 하나처럼 렌더한다(접힘=collapsed).
    클릭하면 펼쳐지며 member_node_ids가 가리키는 실제 노드/엣지가 드러난다 -
    그 펼침 애니메이션과 레이아웃은 순전히 프론트 책임이고, 서버는 멤버십과
    접힘 상태만 영속화한다.
    """

    id: str
    label: str = Field(max_length=60)
    member_node_ids: list[str] = Field(default_factory=list)
    collapsed: bool = True
    # 접힌 성단이 노드 하나처럼 캔버스에 놓일 좌표. Node.position과 동일한 타입.
    position: Position


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
    # 우측 패널 보관함 영속화. list인 이유: 프론트엔드가 순서를 의미 있게 다루고
    # (드래그로 재배열), bin 자체의 개수도 nodes/edges에 비해 훨씬 적어(<=30)
    # dict의 부분 업데이트 이점이 크지 않다 - 그래서 nodes/edges와 달리 항상
    # 배열 전체를 교체하는 의미론을 쓴다(app/firestore/constellation_repo.py의
    # replace_bins 참고). 기본값을 Field(default_factory=list)로 둔 이유: 이
    # 필드 도입 이전에 저장된 구 문서는 bins 키 자체가 없으므로, 역직렬화 시
    # Pydantic 기본값으로 빈 리스트가 채워져야 한다(회귀 방지 - CRITICAL).
    bins: list[Bin] = Field(default_factory=list)
    # 캔버스 성단(group). dict인 이유는 nodes/edges와 동일 - Firestore 점 표기
    # 부분 업데이트("groups.{gid}.collapsed")로 그룹 하나만 갱신하기 위함이다.
    # 기본값 default_factory=dict: 이 필드 도입 이전 구 문서는 groups 키 자체가
    # 없으므로, 역직렬화 시 빈 dict로 채워져야 한다(bins와 동일한 역호환 이유).
    groups: dict[str, Group] = Field(default_factory=dict)
    is_published: bool = False
    # 발행 시 부가 메타. 둘 다 이 필드 도입 이전 구 문서에는 키 자체가 없으므로
    # 기본값(None/빈 리스트)으로 흡수되어야 한다(bins와 동일한 역호환 이유).
    description: str | None = None
    contributors: list[str] = Field(default_factory=list)
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


# 관심사 태그 상위 몇 개를 users.interest_tags에 비정규화할지 (탐색 API 브리핑 명시).
INTEREST_TAG_LIMIT = 5


def compute_interest_tags(
    constellations: list[Constellation], *, limit: int = INTEREST_TAG_LIMIT
) -> list[str]:
    """발행된 별자리 전체의 노드 라벨 빈도 상위 limit개를 관심사 태그로 계산한다.

    호출부(app/api/constellation.py의 publish 핸들러)가 발행 상태가 바뀔 때마다
    해당 owner의 list_published_by_owner 결과를 그대로 넘긴다 - 이 함수는
    Firestore를 전혀 모르는 순수 함수라 단위 테스트만으로 규칙을 검증할 수 있다.

    규칙 (단순하게 - 과설계 금지):
    - 라벨은 앞뒤 공백만 트림해 집계한다. code(학정번호 등)는 Node에서 이미
      별도 필드로 분리돼 있으므로 라벨 문자열에서 따로 벗겨낼 게 없다.
    - 트림 후 빈 문자열인 라벨은 집계에서 제외한다.
    - 동률(빈도 동일)은 그 라벨을 가진 별자리 중 가장 최근에 갱신된
      (updated_at 최댓값) 쪽을 우선한다 - "최근 관심사"를 더 대표한다고 보는
      단순 규칙.
    - 별자리가 하나도 없으면(발행 0개) 빈 리스트.
    """
    frequency: dict[str, int] = {}
    latest_updated_at: dict[str, datetime] = {}
    for constellation in constellations:
        for node in constellation.nodes.values():
            label = node.label.strip()
            if not label:
                continue
            frequency[label] = frequency.get(label, 0) + 1
            if (
                label not in latest_updated_at
                or constellation.updated_at > latest_updated_at[label]
            ):
                latest_updated_at[label] = constellation.updated_at

    ranked = sorted(
        frequency,
        key=lambda label: (-frequency[label], -latest_updated_at[label].timestamp()),
    )
    return ranked[:limit]
