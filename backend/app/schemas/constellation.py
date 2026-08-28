"""별자리(constellation) API 요청/응답 스키마.

## 와이어 포맷 규약 (프론트엔드 계약 - 반드시 고정)

프론트엔드는 이미 구현되어 있고 아래 두 규약을 그대로 기대한다:

1. JSON 키는 camelCase다. 모든 요청/응답 모델에 `alias_generator=to_camel` +
   `populate_by_name=True`를 건다 - 파이썬 쪽 필드명은 snake_case로 그대로
   유지하면서 와이어 포맷만 camelCase로 바뀐다.
2. 시간은 epoch 밀리초 정수다. 프론트엔드가 `b.updatedAt - a.updatedAt`처럼
   산술 비교로 정렬하므로 ISO 문자열을 절대 내보내면 안 된다. `to_epoch_ms`
   헬퍼로 변환한다.

`note_count`는 0이면 응답에서 아예 빼야 한다(프론트엔드가 "undefined = 노트
없음(빈 상태 UI)"과 "0 = 노트 0개"를 구분한다) - NodeOut.note_count를
`int | None`로 두고 변환 헬퍼에서 0을 None으로 바꾼 뒤, 라우터가
`response_model_exclude_none=True`를 켜서 None 필드를 통째로 지운다.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.domain.constellation import (
    NODE_COLOR_PATTERN,
    NODE_GLOW_PATTERN,
    Bin,
    BinItem,
    BinOrigin,
    Constellation,
    Edge,
    Node,
    NodeOrigin,
    NodeType,
    Note,
    NoteAttachment,
    Position,
)

# BinsPutIn 용량 제한 - 보관함이 무한정 커지는 것을 막는다(프론트 UI도 이 정도
# 규모를 벗어나면 성능이 저하된다).
_MAX_BINS = 30
_MAX_ITEMS_PER_BIN = 50

# PublishPatchIn.contributors 용량 제한 - 닉네임 문자열 항목당 40자, 최대 10개.
_MAX_CONTRIBUTORS = 10
_MAX_CONTRIBUTOR_LEN = 40

# NoteAttachment.url이 허용하는 스킴. 저장된 노트가 나중에 공개될 수 있으므로
# javascript: 등 위험한 스킴은 거부한다.
_ALLOWED_URL_SCHEMES = ("https:", "blob:")


def to_epoch_ms(dt: datetime) -> int:
    """datetime을 epoch 밀리초 정수로 변환한다 (와이어 포맷 규약)."""
    return int(dt.timestamp() * 1000)


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Position ---


class PositionIn(_CamelModel):
    """캔버스 좌표 (요청)."""

    x: float
    y: float


class PositionOut(_CamelModel):
    """캔버스 좌표 (응답)."""

    x: float
    y: float


def position_to_out(position: Position) -> PositionOut:
    return PositionOut(x=position.x, y=position.y)


# --- Attachment ---


class AttachmentIn(_CamelModel):
    """노트 첨부파일 (요청). id는 클라이언트 생성."""

    id: str = Field(min_length=1, max_length=200)
    name: str = Field(max_length=300)
    mime_type: str = Field(max_length=200)
    url: str = Field(max_length=2000)

    @field_validator("url")
    @classmethod
    def _check_url_scheme(cls, v: str) -> str:
        if not v.lower().startswith(_ALLOWED_URL_SCHEMES):
            raise ValueError(f"url scheme must be one of {_ALLOWED_URL_SCHEMES}")
        return v


class AttachmentOut(_CamelModel):
    """노트 첨부파일 (응답)."""

    id: str
    name: str
    mime_type: str
    url: str


def attachment_to_out(attachment: NoteAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id, name=attachment.name, mime_type=attachment.mime_type, url=attachment.url
    )


def attachment_from_in(attachment: AttachmentIn) -> NoteAttachment:
    return NoteAttachment(
        id=attachment.id, name=attachment.name, mime_type=attachment.mime_type, url=attachment.url
    )


# --- Node ---


class NodeCreateIn(_CamelModel):
    """노드 생성 요청. id는 클라이언트 생성(예: "element:phil-101")."""

    id: str = Field(min_length=1, max_length=200)
    label: str
    type: NodeType
    code: str | None = None
    description: str | None = None
    level: int | None = None
    source_ref: str | None = None
    position: PositionIn
    color: str | None = Field(default=None, pattern=NODE_COLOR_PATTERN)
    glow_effect: str | None = Field(
        default=None, pattern=NODE_GLOW_PATTERN, min_length=1, max_length=24
    )


class NodeOut(_CamelModel):
    """노드 응답. note_count가 0이면 라우터가 response_model_exclude_none으로 뺀다."""

    id: str
    label: str
    type: NodeType
    code: str | None = None
    description: str | None = None
    level: int | None = None
    source_ref: str | None = None
    is_completed: bool
    position: PositionOut
    origin: NodeOrigin
    created_at: int
    note_count: int | None = None
    color: str | None = None
    glow_effect: str | None = None


def node_to_out(node: Node) -> NodeOut:
    return NodeOut(
        id=node.id,
        label=node.label,
        type=node.type,
        code=node.code,
        description=node.description,
        level=node.level,
        source_ref=node.source_ref,
        is_completed=node.is_completed,
        position=position_to_out(node.position),
        origin=node.origin,
        created_at=to_epoch_ms(node.created_at),
        # 0이면 응답에서 아예 빼야 하므로 None으로 치환한다 (모듈 docstring 참고).
        note_count=node.note_count or None,
        color=node.color,
        glow_effect=node.glow_effect,
    )


def node_from_create_in(payload: NodeCreateIn, *, created_at: datetime) -> Node:
    """origin은 항상 서버가 "user_added"로 정한다 (LLM 제안 노드는 별도 경로)."""
    return Node(
        id=payload.id,
        label=payload.label,
        type=payload.type,
        code=payload.code,
        description=payload.description,
        level=payload.level,
        source_ref=payload.source_ref,
        is_completed=False,
        position=Position(x=payload.position.x, y=payload.position.y),
        origin="user_added",
        created_at=created_at,
        note_count=0,
        color=payload.color,
        glow_effect=payload.glow_effect,
    )


# --- Edge ---


class EdgeCreateIn(_CamelModel):
    """엣지 생성 요청. id는 클라이언트 생성."""

    id: str = Field(min_length=1, max_length=200)
    source_node_id: str = Field(min_length=1, max_length=200)
    target_node_id: str = Field(min_length=1, max_length=200)
    color: str | None = Field(default=None, pattern=NODE_COLOR_PATTERN)


class EdgeOut(_CamelModel):
    id: str
    source_node_id: str
    target_node_id: str
    color: str | None = None


def edge_to_out(edge: Edge) -> EdgeOut:
    return EdgeOut(
        id=edge.id,
        source_node_id=edge.source_node_id,
        target_node_id=edge.target_node_id,
        color=edge.color,
    )


def edge_from_create_in(payload: EdgeCreateIn) -> Edge:
    return Edge(
        id=payload.id,
        source_node_id=payload.source_node_id,
        target_node_id=payload.target_node_id,
        color=payload.color,
    )


# --- Bin ---


class BinItemIn(_CamelModel):
    """보관함 아이템 (요청). id는 클라이언트 생성(아이템 id 규약은 도메인 모델 docstring 참고)."""

    id: str = Field(min_length=1, max_length=200)
    label: str
    type: NodeType
    level: int | None = None
    subtitle: str | None = None
    description: str | None = None


class BinItemOut(_CamelModel):
    """보관함 아이템 (응답)."""

    id: str
    label: str
    type: NodeType
    level: int | None = None
    subtitle: str | None = None
    description: str | None = None


def bin_item_to_out(item: BinItem) -> BinItemOut:
    return BinItemOut(
        id=item.id,
        label=item.label,
        type=item.type,
        level=item.level,
        subtitle=item.subtitle,
        description=item.description,
    )


def bin_item_from_in(payload: BinItemIn) -> BinItem:
    return BinItem(
        id=payload.id,
        label=payload.label,
        type=payload.type,
        level=payload.level,
        subtitle=payload.subtitle,
        description=payload.description,
    )


class BinIn(_CamelModel):
    """보관함 (요청). id는 클라이언트 생성."""

    id: str = Field(min_length=1, max_length=200)
    label: str
    origin: BinOrigin
    advice: str | None = None
    items: list[BinItemIn] = Field(default_factory=list, max_length=_MAX_ITEMS_PER_BIN)


class BinOut(_CamelModel):
    """보관함 (응답). advice가 None이어도 그대로 내보낸다 - note_count와 달리

    "advice 없음"과 "advice 빈 문자열"을 구분할 필요가 없고(빈 조언이라는 개념
    자체가 없음), 라우터의 response_model_exclude_none이 켜져 있으면 advice가
    None일 때 키 자체가 자동으로 빠진다(NodeOut.note_count와 동일한 방식).
    """

    id: str
    label: str
    origin: BinOrigin
    advice: str | None = None
    items: list[BinItemOut] = Field(default_factory=list)


def bin_to_out(bin_: Bin) -> BinOut:
    return BinOut(
        id=bin_.id,
        label=bin_.label,
        origin=bin_.origin,
        advice=bin_.advice,
        items=[bin_item_to_out(i) for i in bin_.items],
    )


def bin_from_in(payload: BinIn) -> Bin:
    return Bin(
        id=payload.id,
        label=payload.label,
        origin=payload.origin,
        advice=payload.advice,
        items=[bin_item_from_in(i) for i in payload.items],
    )


# --- Constellation ---


class ConstellationCreateIn(_CamelModel):
    """별자리 생성 요청.

    프론트엔드가 이미 완성된 로컬 그래프를 갖고 있는 첫 저장 시나리오를 위해
    초기 nodes/edges를 한 번에 함께 받을 수 있다. edges의 source/target은 같은
    요청 안의 nodes id를 참조해야 한다(모델 검증기가 확인).
    """

    title: str
    goal_raw_text: str
    nodes: list[NodeCreateIn] = Field(default_factory=list)
    edges: list[EdgeCreateIn] = Field(default_factory=list)
    # CRITICAL: 반드시 edges 다음에 선언한다. _check_edge_endpoints가
    # info.data["nodes"]를 읽는 field_validator이므로, Pydantic v2는 필드
    # "선언 순서대로" info.data를 채운다 - bins를 edges보다 앞에 두면
    # _check_edge_endpoints가 호출되는 시점에 아직 없는 필드라 문제없지만,
    # 반대로 향후 bins에 nodes/edges를 참조하는 검증기를 추가한다면 반드시
    # 이 순서(nodes -> edges -> bins) 뒤에 와야 info.data에 잡힌다.
    bins: list[BinIn] = Field(default_factory=list)

    @field_validator("edges")
    @classmethod
    def _check_edge_endpoints(cls, edges: list[EdgeCreateIn], info: object) -> list[EdgeCreateIn]:
        # Pydantic v2에서 다른 필드(nodes) 값을 함께 봐야 하므로 model_validator가
        # 아니라 field_validator + info.data를 쓴다. info는 ValidationInfo.
        data = getattr(info, "data", {})
        node_ids = {n.id for n in data.get("nodes", [])}
        for edge in edges:
            if edge.source_node_id not in node_ids or edge.target_node_id not in node_ids:
                raise ValueError(
                    f"edge {edge.id}의 endpoint는 같은 요청의 nodes id를 참조해야 합니다."
                )
        return edges


class ConstellationOut(_CamelModel):
    id: str
    owner_id: str
    title: str
    goal_raw_text: str
    nodes: dict[str, NodeOut]
    edges: dict[str, EdgeOut]
    bins: list[BinOut]
    is_published: bool
    description: str | None = None
    contributors: list[str] = Field(default_factory=list)
    created_at: int
    updated_at: int


def constellation_to_out(constellation: Constellation) -> ConstellationOut:
    return ConstellationOut(
        id=constellation.id,
        owner_id=constellation.owner_id,
        title=constellation.title,
        goal_raw_text=constellation.goal_raw_text,
        nodes={nid: node_to_out(n) for nid, n in constellation.nodes.items()},
        edges={eid: edge_to_out(e) for eid, e in constellation.edges.items()},
        bins=[bin_to_out(b) for b in constellation.bins],
        is_published=constellation.is_published,
        description=constellation.description,
        contributors=constellation.contributors,
        created_at=to_epoch_ms(constellation.created_at),
        updated_at=to_epoch_ms(constellation.updated_at),
    )


# --- 피드 (공개 별자리 목록) ---


class FeedAuthorOut(_CamelModel):
    """피드 항목의 작성자 표시 정보. users 문서가 없으면 필드가 전부 None."""

    display_name: str | None = None
    avatar_emoji: str | None = None


class FeedItemOut(_CamelModel):
    constellation: ConstellationOut
    author: FeedAuthorOut


# --- 부분 갱신 요청 ---


class PositionPatchIn(_CamelModel):
    position: PositionIn


class CompletionPatchIn(_CamelModel):
    is_completed: bool


class ColorPatchIn(_CamelModel):
    """노드 색상 갱신 요청. 빈 문자열/색상명이 아니라 "#RRGGBB" hex만 허용한다."""

    color: str = Field(pattern=NODE_COLOR_PATTERN)


class EdgeColorPatchIn(_CamelModel):
    """엣지 색상 갱신 요청. ColorPatchIn(노드)과 달리 null을 허용한다 - null이면
    커스텀 색을 지우고 프론트 기본색으로 되돌린다는 뜻이다."""

    color: str | None = Field(default=None, pattern=NODE_COLOR_PATTERN)


class GlowPatchIn(_CamelModel):
    """노드 달성 연출(glow effect) 프리셋 갱신 요청. null이면 기본 연출로 되돌린다."""

    glow_effect: str | None = Field(
        default=None, pattern=NODE_GLOW_PATTERN, min_length=1, max_length=24
    )


class PublishPatchIn(_CamelModel):
    """발행 상태 + 메타 갱신 요청. title/description/contributors는 값이 온 필드만
    반영한다 - None이면 기존 값을 그대로 유지한다(부분 갱신 의미론)."""

    is_published: bool
    title: str | None = None
    description: str | None = None
    contributors: list[str] | None = Field(default=None, max_length=_MAX_CONTRIBUTORS)

    @field_validator("contributors")
    @classmethod
    def _check_contributor_length(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for name in v:
            if len(name) > _MAX_CONTRIBUTOR_LEN:
                raise ValueError(f"contributor 이름은 {_MAX_CONTRIBUTOR_LEN}자를 넘을 수 없습니다.")
        return v


class BinsPutIn(_CamelModel):
    """보관함 전체 교체 요청 (PUT /{constellation_id}/bins).

    부분 갱신이 아니라 배열 전체 교체 의미론이다 - 프론트엔드가 보관함 상태를
    통째로 들고 있다가 그대로 밀어넣는다(repo.replace_bins 참고). max_length로
    개수 상한을 걸어 무한정 커지는 것을 막는다.
    """

    bins: list[BinIn] = Field(default_factory=list, max_length=_MAX_BINS)


# --- Note ---


class NoteCreateIn(_CamelModel):
    """노트 생성 요청. id는 선택 - 없으면 서버가 uuid4를 생성한다.

    title/body는 빈 문자열을 허용해야 한다("빈 노트" 제품 기능) - min_length를
    걸면 안 된다.
    """

    id: str | None = Field(default=None, min_length=1, max_length=200)
    node_id: str = Field(min_length=1, max_length=200)
    title: str = ""
    body: str = ""
    is_public: bool = False
    attachments: list[AttachmentIn] = Field(default_factory=list, max_length=20)


class NotePatchIn(_CamelModel):
    """노트 갱신 요청 (자동저장 hot path). title/body 빈 문자열 허용."""

    title: str = ""
    body: str = ""
    is_public: bool = False
    attachments: list[AttachmentIn] = Field(default_factory=list, max_length=20)


class NoteOut(_CamelModel):
    id: str
    node_id: str
    owner_id: str
    title: str
    body: str
    is_public: bool
    attachments: list[AttachmentOut]
    created_at: int
    updated_at: int


def note_to_out(note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        node_id=note.node_id,
        owner_id=note.owner_id,
        title=note.title,
        body=note.body,
        is_public=note.is_public,
        attachments=[attachment_to_out(a) for a in note.attachments],
        created_at=to_epoch_ms(note.created_at),
        updated_at=to_epoch_ms(note.updated_at),
    )
