from datetime import datetime

from app.domain.constellation import (
    Edge,
    Node,
    NodeTypes,
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
