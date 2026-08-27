from datetime import datetime

import pytest
from pydantic import ValidationError

from app.domain.constellation import (
    Edge,
    Node,
    NodeTypes,
    Note,
    NoteAttachment,
    Position,
    compute_node_counts,
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
