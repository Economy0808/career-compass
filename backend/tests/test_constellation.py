from datetime import datetime

import pytest
from pydantic import ValidationError

from app.domain.constellation import (
    PROFILE_TEXT_MAX_CHARS,
    Bin,
    BinItem,
    Constellation,
    Edge,
    Group,
    Node,
    NodeTypes,
    Note,
    NoteAttachment,
    Position,
    compute_interest_tags,
    compute_node_counts,
    compute_profile_text,
    compute_progress_pct,
    is_edge_lit,
    prune_orphan_edges,
)


def _make_node(
    node_id: str, *, is_completed: bool = False, node_type: str = NodeTypes.COURSE
) -> Node:
    return Node(
        id=node_id,
        label=f"노드 {node_id}",
        type=node_type,
        position=Position(x=0.0, y=0.0),
        origin="user_added",
        is_completed=is_completed,
        created_at=datetime(2026, 1, 1),
    )


def _make_edge(edge_id: str, source_id: str, target_id: str) -> Edge:
    return Edge(id=edge_id, source_node_id=source_id, target_node_id=target_id)


def _make_constellation(
    cid: str,
    *,
    node_labels: list[str],
    updated_at: datetime,
    bins: list[Bin] | None = None,
    groups: dict[str, Group] | None = None,
) -> Constellation:
    nodes = {
        f"{cid}-{i}": Node(
            id=f"{cid}-{i}",
            label=label,
            type=NodeTypes.CUSTOM,
            position=Position(x=0.0, y=0.0),
            origin="user_added",
            created_at=updated_at,
        )
        for i, label in enumerate(node_labels)
    }
    return Constellation(
        id=cid,
        owner_id="user-1",
        title=cid,
        goal_raw_text="",
        nodes=nodes,
        bins=bins or [],
        groups=groups or {},
        is_published=True,
        created_at=updated_at,
        updated_at=updated_at,
    )


def _make_bin(label: str, *, origin: str = "llm") -> Bin:
    return Bin(id=f"bin-{label}", label=label, origin=origin)


def _make_group(label: str) -> Group:
    return Group(id=f"group-{label}", label=label, position=Position(x=0.0, y=0.0))


# --- compute_progress_pct ---


def test_compute_progress_pct_empty() -> None:
    assert compute_progress_pct({}) == 0.0


def test_compute_progress_pct_all_incomplete() -> None:
    nodes = {"a": _make_node("a"), "b": _make_node("b")}
    assert compute_progress_pct(nodes) == 0.0


def test_compute_progress_pct_all_complete() -> None:
    nodes = {"a": _make_node("a", is_completed=True), "b": _make_node("b", is_completed=True)}
    assert compute_progress_pct(nodes) == 100.0


def test_compute_progress_pct_partial() -> None:
    nodes = {
        "a": _make_node("a", is_completed=True),
        "b": _make_node("b"),
        "c": _make_node("c"),
    }
    assert compute_progress_pct(nodes) == round(1 / 3 * 100, 1)


# --- compute_node_counts ---


def test_compute_node_counts_empty() -> None:
    assert compute_node_counts({}) == (0, 0)


def test_compute_node_counts_partial() -> None:
    nodes = {
        "a": _make_node("a", is_completed=True),
        "b": _make_node("b"),
        "c": _make_node("c", is_completed=True),
    }
    assert compute_node_counts(nodes) == (2, 3)


def test_compute_node_counts_full() -> None:
    nodes = {"a": _make_node("a", is_completed=True), "b": _make_node("b", is_completed=True)}
    assert compute_node_counts(nodes) == (2, 2)


# --- is_edge_lit ---


def test_is_edge_lit_both_complete() -> None:
    nodes = {"a": _make_node("a", is_completed=True), "b": _make_node("b", is_completed=True)}
    edge = _make_edge("e1", "a", "b")
    assert is_edge_lit(edge, nodes) is True


def test_is_edge_lit_one_complete() -> None:
    nodes = {"a": _make_node("a", is_completed=True), "b": _make_node("b")}
    edge = _make_edge("e1", "a", "b")
    assert is_edge_lit(edge, nodes) is False


def test_is_edge_lit_neither_complete() -> None:
    nodes = {"a": _make_node("a"), "b": _make_node("b")}
    edge = _make_edge("e1", "a", "b")
    assert is_edge_lit(edge, nodes) is False


def test_is_edge_lit_missing_node_does_not_raise() -> None:
    nodes = {"a": _make_node("a", is_completed=True)}
    edge = _make_edge("e1", "a", "ghost")
    assert is_edge_lit(edge, nodes) is False


# --- prune_orphan_edges ---


def test_prune_orphan_edges_keeps_valid() -> None:
    nodes = {"a": _make_node("a"), "b": _make_node("b")}
    edges = {"e1": _make_edge("e1", "a", "b")}
    result = prune_orphan_edges(nodes, edges)
    assert result == edges


def test_prune_orphan_edges_drops_missing_source() -> None:
    nodes = {"b": _make_node("b")}
    edges = {"e1": _make_edge("e1", "ghost", "b")}
    result = prune_orphan_edges(nodes, edges)
    assert result == {}


def test_prune_orphan_edges_drops_missing_target() -> None:
    nodes = {"a": _make_node("a")}
    edges = {"e1": _make_edge("e1", "a", "ghost")}
    result = prune_orphan_edges(nodes, edges)
    assert result == {}


def test_prune_orphan_edges_does_not_mutate_input() -> None:
    nodes = {"a": _make_node("a")}
    edges = {
        "e1": _make_edge("e1", "a", "ghost"),
        "e2": _make_edge("e2", "a", "a"),
    }
    original_edges = dict(edges)
    prune_orphan_edges(nodes, edges)
    assert edges == original_edges


# --- Pydantic model validation ---


def test_node_round_trips_through_model_dump() -> None:
    node = _make_node("a", is_completed=True, node_type=NodeTypes.CERTIFICATION)
    dumped = node.model_dump()
    rebuilt = Node(**dumped)
    assert rebuilt == node


def test_node_default_is_completed_false() -> None:
    node = Node(
        id="a",
        label="라벨",
        type=NodeTypes.CUSTOM,
        position=Position(x=1.0, y=2.0),
        origin="llm_suggested",
        created_at=datetime(2026, 1, 1),
    )
    assert node.is_completed is False
    assert node.source_ref is None


def test_node_backward_compat_old_document_missing_new_fields() -> None:
    """새 필드(code/description/level/note_count) 도입 이전의 구 Firestore 문서도
    여전히 검증을 통과하고, 새 필드는 기본값으로 채워져야 한다."""
    old_doc = {
        "id": "a",
        "label": "구버전 노드",
        "type": NodeTypes.COURSE,
        "is_completed": True,
        "position": {"x": 0.0, "y": 0.0},
        "origin": "user_added",
        "created_at": datetime(2026, 1, 1),
    }
    node = Node.model_validate(old_doc)
    assert node.code is None
    assert node.description is None
    assert node.level is None
    assert node.note_count == 0


# --- Note / NoteAttachment ---


def _make_note(**overrides: object) -> Note:
    defaults: dict[str, object] = {
        "id": "n1",
        "node_id": "a",
        "owner_id": "user-1",
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 1),
    }
    defaults.update(overrides)
    return Note(**defaults)


def test_note_allows_empty_title_and_body() -> None:
    """빈 제목/본문은 의도적으로 지원하는 제품 기능이다 (회귀 방지)."""
    note = _make_note(title="", body="")
    assert note.title == ""
    assert note.body == ""


def test_note_defaults_is_public_false_and_no_attachments() -> None:
    note = _make_note()
    assert note.is_public is False
    assert note.attachments == []


def test_note_attachment_requires_all_fields() -> None:
    with pytest.raises(ValidationError):
        NoteAttachment(id="att1", name="파일.pdf", mime_type="application/pdf")


def test_note_round_trips_through_model_dump() -> None:
    note = _make_note(
        title="제목",
        body="본문",
        is_public=True,
        attachments=[
            NoteAttachment(
                id="att1",
                name="파일.pdf",
                mime_type="application/pdf",
                url="https://example.com/att1.pdf",
            )
        ],
    )
    dumped = note.model_dump()
    rebuilt = Note.model_validate(dumped)
    assert rebuilt == note


# --- compute_interest_tags ---


def test_compute_interest_tags_empty_constellations_returns_empty() -> None:
    assert compute_interest_tags([]) == []


def test_compute_interest_tags_ranks_by_frequency() -> None:
    constellations = [
        _make_constellation(
            "c1", node_labels=["철학개론", "철학개론", "논리학"], updated_at=datetime(2026, 1, 1)
        ),
        _make_constellation("c2", node_labels=["철학개론"], updated_at=datetime(2026, 1, 2)),
    ]
    tags = compute_interest_tags(constellations)
    assert tags[0] == "철학개론"  # 3회 > 논리학 1회
    assert "논리학" in tags


def test_compute_interest_tags_caps_at_limit() -> None:
    constellations = [
        _make_constellation(
            "c1", node_labels=[f"라벨{i}" for i in range(8)], updated_at=datetime(2026, 1, 1)
        )
    ]
    tags = compute_interest_tags(constellations, limit=5)
    assert len(tags) == 5


def test_compute_interest_tags_trims_whitespace_and_drops_blank() -> None:
    constellations = [
        _make_constellation("c1", node_labels=["  철학개론  ", ""], updated_at=datetime(2026, 1, 1))
    ]
    assert compute_interest_tags(constellations) == ["철학개론"]


def test_compute_interest_tags_tie_prefers_most_recently_updated() -> None:
    constellations = [
        _make_constellation("old", node_labels=["오래된태그"], updated_at=datetime(2026, 1, 1)),
        _make_constellation("new", node_labels=["최근태그"], updated_at=datetime(2026, 6, 1)),
    ]
    tags = compute_interest_tags(constellations)
    # 둘 다 빈도 1회로 동률 - 더 최근에 갱신된 별자리의 라벨이 앞에 온다.
    assert tags[0] == "최근태그"
    assert tags[1] == "오래된태그"


def test_compute_interest_tags_prefers_bin_labels_over_node_labels() -> None:
    """bin이 있으면 노드 라벨(과목명)이 아니라 bin 라벨(의미 어휘)을 쓴다."""
    constellations = [
        _make_constellation(
            "c1",
            node_labels=["회계원리(1)"],
            bins=[_make_bin("데이터 분석 기초")],
            updated_at=datetime(2026, 1, 1),
        )
    ]
    assert compute_interest_tags(constellations) == ["데이터 분석 기초"]


def test_compute_interest_tags_uses_group_labels_when_no_bins() -> None:
    """bin은 없고 group만 있어도 group 라벨을 노드 라벨보다 우선한다."""
    constellations = [
        _make_constellation(
            "c1",
            node_labels=["회계원리(1)"],
            groups={"g1": _make_group("목표 성단")},
            updated_at=datetime(2026, 1, 1),
        )
    ]
    assert compute_interest_tags(constellations) == ["목표 성단"]


def test_compute_interest_tags_falls_back_to_node_labels_without_bin_or_group() -> None:
    """이 별자리에 bin·group이 하나도 없으면 노드 라벨로 폴백한다(별자리 단위 판단)."""
    constellations = [
        _make_constellation("c1", node_labels=["철학개론"], updated_at=datetime(2026, 1, 1))
    ]
    assert compute_interest_tags(constellations) == ["철학개론"]


def test_compute_interest_tags_fallback_is_per_constellation() -> None:
    """별자리 A는 bin이 있어 bin 라벨을, bin이 없는 별자리 B는 노드 라벨을 쓴다."""
    constellations = [
        _make_constellation(
            "a",
            node_labels=["회계원리(1)"],
            bins=[_make_bin("데이터 분석 기초")],
            updated_at=datetime(2026, 1, 1),
        ),
        _make_constellation("b", node_labels=["철학개론"], updated_at=datetime(2026, 1, 2)),
    ]
    tags = compute_interest_tags(constellations)
    assert "데이터 분석 기초" in tags
    assert "철학개론" in tags
    assert "회계원리(1)" not in tags


def test_compute_interest_tags_excludes_generic_manual_courses_bin_label() -> None:
    """frontend가 모든 별자리 맨 앞에 자동 삽입하는 고정 bin("내가 담은 수업",
    frontend/app/constellation/new/page.tsx의 ensureManualCoursesBin)은 목표와
    무관한 일반 라벨이므로 태그 후보에서 제외한다. 실제 bin은 그대로 남는다.
    """
    constellations = [
        _make_constellation(
            "c1",
            node_labels=[],
            bins=[_make_bin("내가 담은 수업", origin="user"), _make_bin("목표 관련 군집")],
            updated_at=datetime(2026, 1, 1),
        )
    ]
    assert compute_interest_tags(constellations) == ["목표 관련 군집"]


def test_compute_interest_tags_generic_only_bin_falls_back_to_nodes() -> None:
    """고정 일반 bin("내가 담은 수업") 하나만 있는 별자리는(다른 bin·group 없음)
    노드 라벨로 폴백한다 - 폴백 판정이 "raw bin 존재"가 아니라 "필터 후 의미
    라벨이 남는가"이기 때문이다. 프론트가 모든 별자리에 이 고정 빈을 자동
    삽입하므로, 만약 raw 존재로 판단하면 노드 폴백이 절대 안 터지고 이런
    별자리는 검색에서 사라진다(2026-09-03 실측 발견). 과목명 태그가 이상적이진
    않지만 '태그 0개 = 검색에서 소멸'보다는 낫다는 판단이다.
    """
    constellations = [
        _make_constellation(
            "a",
            node_labels=["회계원리(1)"],
            bins=[_make_bin("내가 담은 수업", origin="user")],
            updated_at=datetime(2026, 1, 1),
        )
    ]
    assert compute_interest_tags(constellations) == ["회계원리(1)"]


# --- compute_profile_text ---


def _make_profile_constellation(
    cid: str,
    *,
    title: str = "",
    goal_raw_text: str = "",
    updated_at: datetime,
    bins: list[Bin] | None = None,
    nodes: dict[str, Node] | None = None,
) -> Constellation:
    return Constellation(
        id=cid,
        owner_id="user-1",
        title=title,
        goal_raw_text=goal_raw_text,
        nodes=nodes or {},
        bins=bins or [],
        groups={},
        is_published=True,
        created_at=updated_at,
        updated_at=updated_at,
    )


def test_compute_profile_text_no_constellations_no_tags_no_bio_returns_empty() -> None:
    assert compute_profile_text([], bio=None, interest_tags=[]) == ""


def test_compute_profile_text_no_constellations_bio_only() -> None:
    text = compute_profile_text([], bio="철학 전공 1학년", interest_tags=[])
    assert text == "소개: 철학 전공 1학년"


def test_compute_profile_text_orders_tags_before_constellations_before_bio() -> None:
    constellations = [
        _make_profile_constellation(
            "c1", title="데이터 분석가", goal_raw_text="목표 원문", updated_at=datetime(2026, 1, 1)
        )
    ]
    text = compute_profile_text(constellations, bio="자기소개", interest_tags=["빅데이터"])
    lines = text.split("\n")
    assert lines[0] == "관심사: 빅데이터"
    assert lines[1] == "목표: 데이터 분석가 - 목표 원문"
    assert lines[-1] == "소개: 자기소개"


def test_compute_profile_text_truncates_tail_keeping_front() -> None:
    """상한을 넘으면 뒤(여기서는 소개)가 잘리고, 앞(관심사)은 그대로 남는다."""
    long_bio = "가" * 3000
    text = compute_profile_text([], bio=long_bio, interest_tags=["철학"])
    assert len(text) == PROFILE_TEXT_MAX_CHARS
    assert text.startswith("관심사: 철학")


def test_compute_profile_text_excludes_generic_bin_label() -> None:
    constellations = [
        _make_profile_constellation(
            "c1",
            title="목표",
            bins=[
                Bin(id="bin-generic", label="내가 담은 수업", origin="user"),
                Bin(id="bin-x", label="데이터 분석", origin="llm"),
            ],
            updated_at=datetime(2026, 1, 1),
        )
    ]
    text = compute_profile_text(constellations, bio=None, interest_tags=[])
    assert "내가 담은 수업" not in text
    assert "군집: 데이터 분석" in text


def test_compute_profile_text_includes_non_course_support_labels() -> None:
    """수업이 아닌 bin 아이템·노드 라벨만 준비 요소로 들어가고 course는 빠진다."""
    bin_with_items = Bin(
        id="bin-x",
        label="자격증",
        origin="llm",
        items=[
            BinItem(id="support:1", label="정보처리기사", type=NodeTypes.CERTIFICATION),
            BinItem(id="course:PHI1001", label="철학개론", type=NodeTypes.COURSE),
        ],
    )
    node = Node(
        id="n1",
        label="토익 900+",
        type=NodeTypes.CERTIFICATION,
        position=Position(x=0.0, y=0.0),
        origin="user_added",
        created_at=datetime(2026, 1, 1),
    )
    constellations = [
        _make_profile_constellation(
            "c1",
            title="목표",
            bins=[bin_with_items],
            nodes={"n1": node},
            updated_at=datetime(2026, 1, 1),
        )
    ]
    text = compute_profile_text(constellations, bio=None, interest_tags=[])
    assert "준비 요소: 정보처리기사, 토익 900+" in text
    assert "철학개론" not in text
