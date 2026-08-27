"""Firestore 별자리 리포지토리 통합 테스트 - 실제 에뮬레이터를 상대로 실행한다.

Mock을 쓰지 않는 이유: 이 테스트들의 핵심 목적 자체가 "Firestore의 실제 동작"
(dot-notation 부분 업데이트가 정말로 다른 필드를 안 건드리는지, 트랜잭션이 정말로
원자적인지)을 검증하는 것이다. Firestore 클라이언트를 Mock으로 대체하면 검증하려는
대상 자체가 사라진다.

FIRESTORE_EMULATOR_HOST가 설정돼 있지 않거나 에뮬레이터가 응답하지 않으면 이
파일의 모든 테스트를 스킵한다 (실패가 아니라 스킵 - "에뮬레이터를 안 띄웠다"는
것과 "코드가 깨졌다"는 것은 다른 신호이기 때문).

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_constellation_repo.py -q"
FIRESTORE_EMULATOR_HOST=localhost:8080 이 emulators:exec에 의해 자동으로 export된다.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import requests
from google.cloud.firestore import Client

from app.domain.constellation import (
    Constellation,
    Edge,
    Node,
    NodeTypes,
    Position,
    compute_progress_pct,
)
from app.firestore import constellation_repo as repo
from app.firestore.client import get_firestore_client


def _emulator_available() -> bool:
    """FIRESTORE_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture
def db() -> Iterator[Client]:
    yield get_firestore_client()


def _make_node(node_id: str, *, is_completed: bool = False, x: float = 0.0, y: float = 0.0) -> Node:
    return Node(
        id=node_id,
        label=f"노드 {node_id}",
        type=NodeTypes.COURSE,
        position=Position(x=x, y=y),
        origin="user_added",
        is_completed=is_completed,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _make_edge(edge_id: str, source_id: str, target_id: str) -> Edge:
    return Edge(id=edge_id, source_node_id=source_id, target_node_id=target_id)


def _make_constellation(
    constellation_id: str,
    owner_id: str,
    *,
    nodes: dict[str, Node] | None = None,
    edges: dict[str, Edge] | None = None,
    is_published: bool = False,
    created_at: datetime | None = None,
) -> Constellation:
    now = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    return Constellation(
        id=constellation_id,
        owner_id=owner_id,
        title=f"{constellation_id} 제목",
        goal_raw_text="목표 원문",
        nodes=nodes or {},
        edges=edges or {},
        is_published=is_published,
        created_at=now,
        updated_at=now,
    )


# --- create_constellation / get_constellation ---


def test_create_and_get_round_trip(db: Client) -> None:
    node = _make_node("n1")
    constellation = _make_constellation("c1", "owner1", nodes={"n1": node})

    repo.create_constellation(db, constellation)
    fetched = repo.get_constellation(db, "c1")

    assert fetched is not None
    assert fetched.id == "c1"
    assert fetched.owner_id == "owner1"
    assert fetched.nodes["n1"].label == "노드 n1"


def test_get_missing_returns_none(db: Client) -> None:
    assert repo.get_constellation(db, "no-such-id") is None


# --- list_by_owner / list_published ---


def test_list_by_owner_returns_only_that_owner(db: Client) -> None:
    repo.create_constellation(db, _make_constellation("c1", "owner_a"))
    repo.create_constellation(db, _make_constellation("c2", "owner_a"))
    repo.create_constellation(db, _make_constellation("c3", "owner_b"))

    result = repo.list_by_owner(db, "owner_a")

    assert {c.id for c in result} == {"c1", "c2"}


def test_list_published_excludes_unpublished(db: Client) -> None:
    repo.create_constellation(db, _make_constellation("pub1", "owner_a", is_published=True))
    repo.create_constellation(db, _make_constellation("priv1", "owner_a", is_published=False))

    result = repo.list_published(db)
    ids = {c.id for c in result}

    assert "pub1" in ids
    assert "priv1" not in ids


def test_list_published_orders_newest_first(db: Client) -> None:
    early = datetime(2026, 1, 1, tzinfo=UTC)
    later = datetime(2026, 6, 1, tzinfo=UTC)
    repo.create_constellation(
        db, _make_constellation("old", "owner_a", is_published=True, created_at=early)
    )
    repo.create_constellation(
        db, _make_constellation("new", "owner_a", is_published=True, created_at=later)
    )

    result = repo.list_published(db)
    ids = [c.id for c in result if c.id in ("old", "new")]

    assert ids == ["new", "old"]


# --- update_node_position ---


def test_update_node_position_touches_only_that_node(db: Client) -> None:
    n1 = _make_node("n1", x=1.0, y=1.0)
    n2 = _make_node("n2", x=2.0, y=2.0, is_completed=True)
    edge = _make_edge("e1", "n1", "n2")
    constellation = _make_constellation(
        "c1", "owner1", nodes={"n1": n1, "n2": n2}, edges={"e1": edge}
    )
    repo.create_constellation(db, constellation)

    repo.update_node_position(db, "c1", "n1", Position(x=9.0, y=9.0), owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert fetched.nodes["n1"].position == Position(x=9.0, y=9.0)
    # 형제 노드는 그대로여야 한다 (부분 업데이트 검증의 핵심)
    assert fetched.nodes["n2"].position == Position(x=2.0, y=2.0)
    assert fetched.nodes["n2"].is_completed is True
    assert fetched.nodes["n1"].is_completed is False
    # 엣지도 그대로여야 한다
    assert fetched.edges["e1"].source_node_id == "n1"
    assert fetched.edges["e1"].target_node_id == "n2"


def test_update_node_position_missing_node_raises(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )

    with pytest.raises(repo.NodeNotFoundError):
        repo.update_node_position(db, "c1", "ghost", Position(x=0.0, y=0.0), owner_id="owner1")


def test_update_node_position_wrong_owner_raises(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )

    with pytest.raises(repo.ConstellationPermissionError):
        repo.update_node_position(db, "c1", "n1", Position(x=1.0, y=1.0), owner_id="intruder")


# --- toggle_node_completion ---


def test_toggle_node_completion_updates_progress(db: Client) -> None:
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    updated = repo.toggle_node_completion(db, "c1", "n1", True, owner_id="owner1")

    assert updated.nodes["n1"].is_completed is True
    assert compute_progress_pct(updated.nodes) == 50.0

    raw = db.collection("constellations").document("c1").get().to_dict()
    assert raw is not None
    assert raw["completed_node_count"] == 1
    assert raw["total_node_count"] == 2
    assert raw["progress_pct"] == 50.0


def test_denormalized_progress_matches_domain_function(db: Client) -> None:
    nodes = {
        "n1": _make_node("n1", is_completed=True),
        "n2": _make_node("n2", is_completed=False),
        "n3": _make_node("n3", is_completed=True),
    }
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    raw = db.collection("constellations").document("c1").get().to_dict()
    assert raw is not None
    assert raw["progress_pct"] == compute_progress_pct(nodes)


# --- add_node / remove_node ---


def test_add_node(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )

    repo.add_node(db, "c1", _make_node("n2"), owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert set(fetched.nodes) == {"n1", "n2"}


def test_remove_node_drops_orphan_edges(db: Client) -> None:
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2"), "n3": _make_node("n3")}
    edges = {
        "e1": _make_edge("e1", "n1", "n2"),  # n1 삭제되면 매달릴 예정
        "e2": _make_edge("e2", "n2", "n3"),  # 살아남아야 함
    }
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes, edges=edges))

    repo.remove_node(db, "c1", "n1", owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert "n1" not in fetched.nodes
    assert "e1" not in fetched.edges
    assert "e2" in fetched.edges


# --- add_edge / remove_edge ---


def test_add_edge_and_remove_edge(db: Client) -> None:
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    repo.add_edge(db, "c1", _make_edge("e1", "n1", "n2"), owner_id="owner1")
    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert "e1" in fetched.edges

    repo.remove_edge(db, "c1", "e1", owner_id="owner1")
    fetched_after = repo.get_constellation(db, "c1")
    assert fetched_after is not None
    assert "e1" not in fetched_after.edges


# --- 특수 형식 id (dot-notation 이스케이프 회귀 테스트) ---
#
# 프론트엔드가 만드는 id는 Firestore 필드 경로 세그먼트 규칙
# (`[_a-zA-Z][_a-zA-Z0-9]*`)을 어기는 경우가 흔하다 (콜론, 하이픈, 숫자로 시작).
# FieldPath.to_api_repr()로 이스케이프하지 않으면 update()가 ValueError를 던진다.


def test_add_node_and_update_and_toggle_with_colon_id(db: Client) -> None:
    node_id = "element:phil-101"
    repo.create_constellation(db, _make_constellation("c1", "owner1"))

    repo.add_node(db, "c1", _make_node(node_id), owner_id="owner1")
    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert node_id in fetched.nodes

    repo.update_node_position(db, "c1", node_id, Position(x=5.0, y=5.0), owner_id="owner1")
    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert fetched.nodes[node_id].position == Position(x=5.0, y=5.0)

    updated = repo.toggle_node_completion(db, "c1", node_id, True, owner_id="owner1")
    assert updated.nodes[node_id].is_completed is True


def test_add_edge_and_remove_edge_with_hyphenated_id(db: Client) -> None:
    edge_id = "edge-local-1"
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    repo.add_edge(db, "c1", _make_edge(edge_id, "n1", "n2"), owner_id="owner1")
    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert edge_id in fetched.edges

    repo.remove_edge(db, "c1", edge_id, owner_id="owner1")
    fetched_after = repo.get_constellation(db, "c1")
    assert fetched_after is not None
    assert edge_id not in fetched_after.edges


def test_remove_node_with_uuid_id(db: Client) -> None:
    node_id = str(uuid4())
    nodes = {node_id: _make_node(node_id), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    repo.remove_node(db, "c1", node_id, owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert node_id not in fetched.nodes
    assert "n2" in fetched.nodes


def test_add_node_with_leading_digit_id(db: Client) -> None:
    node_id = "7d3fa1e2"
    repo.create_constellation(db, _make_constellation("c1", "owner1"))

    repo.add_node(db, "c1", _make_node(node_id), owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert node_id in fetched.nodes


def test_update_special_id_node_leaves_sibling_node_intact(db: Client) -> None:
    special_id = "element:phil-101"
    sibling = _make_node("n2", x=3.0, y=3.0, is_completed=True)
    nodes = {special_id: _make_node(special_id), "n2": sibling}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))

    repo.update_node_position(db, "c1", special_id, Position(x=9.0, y=9.0), owner_id="owner1")

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert fetched.nodes[special_id].position == Position(x=9.0, y=9.0)
    # 형제 노드는 부분 업데이트로부터 완전히 보호되어야 한다
    assert fetched.nodes["n2"].position == Position(x=3.0, y=3.0)
    assert fetched.nodes["n2"].is_completed is True


# --- delete_constellation ---


def test_delete_constellation_removes_doc(db: Client) -> None:
    repo.create_constellation(db, _make_constellation("c1", "owner1"))

    repo.delete_constellation(db, "c1", owner_id="owner1")

    assert repo.get_constellation(db, "c1") is None


def test_delete_missing_constellation_raises(db: Client) -> None:
    with pytest.raises(repo.ConstellationNotFoundError):
        repo.delete_constellation(db, "no-such-id", owner_id="owner1")
