"""Firestore 노트 리포지토리 통합 테스트 - 실제 에뮬레이터를 상대로 실행한다.

test_constellation_repo.py와 동일한 이유로 Mock을 쓰지 않는다 (에뮬레이터 스킵
가드/픽스처 스타일도 그 파일을 그대로 복사한 관례다).

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_note_repo.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
import requests
from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain.constellation import (
    Constellation,
    Node,
    NodeTypes,
    Note,
    NoteAttachment,
    Position,
)
from app.firestore import constellation_repo as repo
from app.firestore import note_repo
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


def _make_node(node_id: str, *, note_count: int = 0) -> Node:
    return Node(
        id=node_id,
        label=f"노드 {node_id}",
        type=NodeTypes.COURSE,
        position=Position(x=0.0, y=0.0),
        origin="user_added",
        is_completed=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        note_count=note_count,
    )


def _make_constellation(
    constellation_id: str,
    owner_id: str,
    *,
    nodes: dict[str, Node] | None = None,
) -> Constellation:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return Constellation(
        id=constellation_id,
        owner_id=owner_id,
        title=f"{constellation_id} 제목",
        goal_raw_text="목표 원문",
        nodes=nodes or {},
        edges={},
        is_published=False,
        created_at=now,
        updated_at=now,
    )


def _make_note(
    note_id: str,
    node_id: str,
    owner_id: str,
    *,
    title: str = "제목",
    body: str = "내용",
    is_public: bool = False,
    attachments: list[NoteAttachment] | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> Note:
    now = created_at or datetime(2026, 1, 1, tzinfo=UTC)
    return Note(
        id=note_id,
        node_id=node_id,
        owner_id=owner_id,
        title=title,
        body=body,
        is_public=is_public,
        attachments=attachments or [],
        created_at=now,
        updated_at=updated_at or now,
    )


def _raw_constellation(db: Client, constellation_id: str) -> dict:
    raw = db.collection("constellations").document(constellation_id).get().to_dict()
    assert raw is not None
    return raw


def _raw_note_doc_refs(db: Client, constellation_id: str) -> list:
    return list(
        db.collection("constellations")
        .document(constellation_id)
        .collection("notes")
        .list_documents()
    )


# --- create_note / get_note / list_notes 왕복 ---


def test_create_get_list_round_trip_preserves_fields(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    attachment = NoteAttachment(
        id="a1", name="문서.pdf", mime_type="application/pdf", url="https://x/a1"
    )
    note = _make_note(
        "note1",
        "n1",
        owner_id="ignored-should-be-overwritten",
        title="제목입니다",
        body="본문입니다",
        is_public=True,
        attachments=[attachment],
    )

    created = note_repo.create_note(db, "c1", note, owner_id="owner1")
    # create_note는 parent의 진짜 owner_id로 강제 덮어써야 한다.
    assert created.owner_id == "owner1"

    fetched = note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    assert fetched.id == "note1"
    assert fetched.node_id == "n1"
    assert fetched.owner_id == "owner1"
    assert fetched.title == "제목입니다"
    assert fetched.body == "본문입니다"
    assert fetched.is_public is True
    assert fetched.attachments == [attachment]

    listed = note_repo.list_notes(db, "c1", owner_id="owner1")
    assert [n.id for n in listed] == ["note1"]
    assert listed[0].attachments == [attachment]


def test_create_note_with_empty_title_and_body_is_allowed(db: Client) -> None:
    """빈 노트도 지원 대상 제품 기능이다 - min_length 검증기로 거부하면 안 된다."""
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note = _make_note("note1", "n1", "owner1", title="", body="")

    created = note_repo.create_note(db, "c1", note, owner_id="owner1")
    assert created.title == ""
    assert created.body == ""

    fetched = note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    assert fetched.title == ""
    assert fetched.body == ""


# --- note_count 증가/감소 ---


def test_create_note_increments_note_count(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )

    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")

    raw = _raw_constellation(db, "c1")
    assert raw["nodes"]["n1"]["note_count"] == 1

    fetched = repo.get_constellation(db, "c1")
    assert fetched is not None
    assert fetched.nodes["n1"].note_count == 1


def test_delete_note_decrements_note_count_and_floors_at_zero(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note1 = note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")
    note2 = note_repo.create_note(db, "c1", _make_note("note2", "n1", "owner1"), owner_id="owner1")
    assert _raw_constellation(db, "c1")["nodes"]["n1"]["note_count"] == 2

    note_repo.delete_note(db, "c1", note1.id, owner_id="owner1")
    assert _raw_constellation(db, "c1")["nodes"]["n1"]["note_count"] == 1

    note_repo.delete_note(db, "c1", note2.id, owner_id="owner1")
    assert _raw_constellation(db, "c1")["nodes"]["n1"]["note_count"] == 0

    # count가 이미 0인 상태에서 노트를 하나 더 지워도(직접 raw로 심어, 증가 없이
    # 만든 노트) 음수로 내려가면 안 된다.
    extra_note = _make_note("note3", "n1", "owner1")
    db.collection("constellations").document("c1").collection("notes").document("note3").set(
        extra_note.model_dump()
    )
    note_repo.delete_note(db, "c1", "note3", owner_id="owner1")
    assert _raw_constellation(db, "c1")["nodes"]["n1"]["note_count"] == 0


def test_update_note_does_not_change_note_count(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")

    note_repo.update_note(
        db,
        "c1",
        "note1",
        title="바뀐 제목",
        body="바뀐 내용",
        is_public=True,
        attachments=[],
        owner_id="owner1",
    )

    assert _raw_constellation(db, "c1")["nodes"]["n1"]["note_count"] == 1


# --- create_note 오류 케이스 ---


def test_create_note_with_unknown_node_id_raises_and_writes_nothing(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note = _make_note("note1", "ghost-node", "owner1")

    with pytest.raises(repo.NodeNotFoundError):
        note_repo.create_note(db, "c1", note, owner_id="owner1")

    with pytest.raises(note_repo.NoteNotFoundError):
        note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    assert _raw_note_doc_refs(db, "c1") == []


def test_create_note_on_someone_elses_constellation_raises(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note = _make_note("note1", "n1", "owner1")

    with pytest.raises(repo.ConstellationPermissionError):
        note_repo.create_note(db, "c1", note, owner_id="intruder")


# --- update_note ---


def test_update_note_changes_fields_and_increases_updated_at(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    old_time = datetime(2026, 1, 1, tzinfo=UTC)
    note = _make_note("note1", "n1", "owner1", created_at=old_time, updated_at=old_time)
    note_repo.create_note(db, "c1", note, owner_id="owner1")
    before = note_repo.get_note(db, "c1", "note1", owner_id="owner1")

    new_attachment = NoteAttachment(
        id="a1", name="new.png", mime_type="image/png", url="https://x/a1"
    )
    updated = note_repo.update_note(
        db,
        "c1",
        "note1",
        title="새 제목",
        body="새 본문",
        is_public=True,
        attachments=[new_attachment],
        owner_id="owner1",
    )

    assert updated.title == "새 제목"
    assert updated.body == "새 본문"
    assert updated.is_public is True
    assert updated.attachments == [new_attachment]
    assert updated.updated_at > before.updated_at


def test_get_note_and_list_notes_do_not_change_updated_at(db: Client) -> None:
    """CRITICAL 회귀 테스트: updated_at은 프론트엔드 목록 정렬 키 - 읽기가 바꾸면 안 된다."""
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    fixed_time = datetime(2026, 3, 1, tzinfo=UTC)
    note = _make_note("note1", "n1", "owner1", created_at=fixed_time, updated_at=fixed_time)
    note_repo.create_note(db, "c1", note, owner_id="owner1")

    note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    note_repo.list_notes(db, "c1", owner_id="owner1")
    note_repo.get_note(db, "c1", "note1", owner_id="owner1")

    final = note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    assert final.updated_at == fixed_time


def test_list_notes_orders_by_updated_at_desc(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    base = datetime(2026, 1, 1, tzinfo=UTC)
    note_repo.create_note(
        db,
        "c1",
        _make_note("old", "n1", "owner1", created_at=base, updated_at=base),
        owner_id="owner1",
    )
    note_repo.create_note(
        db,
        "c1",
        _make_note("new", "n1", "owner1", created_at=base, updated_at=base + timedelta(hours=1)),
        owner_id="owner1",
    )
    note_repo.create_note(
        db,
        "c1",
        _make_note("mid", "n1", "owner1", created_at=base, updated_at=base + timedelta(minutes=30)),
        owner_id="owner1",
    )

    listed = note_repo.list_notes(db, "c1", owner_id="owner1")

    assert [n.id for n in listed] == ["new", "mid", "old"]


# --- 소유권 위반 ---


def test_update_note_by_non_owner_raises(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")

    with pytest.raises(repo.ConstellationPermissionError):
        note_repo.update_note(
            db,
            "c1",
            "note1",
            title="침입",
            body="침입",
            is_public=False,
            attachments=[],
            owner_id="intruder",
        )


def test_delete_note_by_non_owner_raises(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")

    with pytest.raises(repo.ConstellationPermissionError):
        note_repo.delete_note(db, "c1", "note1", owner_id="intruder")

    # 삭제되지 않고 그대로 남아있어야 한다.
    fetched = note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    assert fetched.id == "note1"


# --- cascade: remove_node / delete_constellation ---


def test_remove_node_cascades_notes_but_spares_sibling_node_notes(db: Client) -> None:
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))
    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")
    note_repo.create_note(db, "c1", _make_note("note2", "n2", "owner1"), owner_id="owner1")

    repo.remove_node(db, "c1", "n1", owner_id="owner1")

    with pytest.raises(note_repo.NoteNotFoundError):
        note_repo.get_note(db, "c1", "note1", owner_id="owner1")
    surviving = note_repo.get_note(db, "c1", "note2", owner_id="owner1")
    assert surviving.id == "note2"


def test_delete_constellation_empties_notes_subcollection(db: Client) -> None:
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    note_repo.create_note(db, "c1", _make_note("note1", "n1", "owner1"), owner_id="owner1")
    note_repo.create_note(db, "c1", _make_note("note2", "n1", "owner1"), owner_id="owner1")

    repo.delete_constellation(db, "c1", owner_id="owner1")

    remaining = list(db.collection("constellations").document("c1").collection("notes").get())
    assert remaining == []


def _bulk_write_raw_notes(db: Client, constellation_id: str, count: int) -> None:
    """create_note를 거치지 않고 노트 문서를 직접 500개 단위 배치로 심는다.

    501개 케이스는 create_note로 하나씩 만들면 느리다 - 배치 한도 회귀
    테스트의 목적은 "삭제 쪽 배치 청크 로직"이므로, 생성은 raw batch write로
    빠르게 해치운다.
    """
    collection = db.collection("constellations").document(constellation_id).collection("notes")
    now = datetime(2026, 1, 1, tzinfo=UTC)
    ids = [f"bulk-{i}" for i in range(count)]
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        batch = db.batch()
        for note_id in chunk:
            note = Note(
                id=note_id,
                node_id="n1",
                owner_id="owner1",
                title="",
                body="",
                created_at=now,
                updated_at=now,
            )
            batch.set(collection.document(note_id), note.model_dump())
        batch.commit()


def test_delete_constellation_cascade_with_501_notes(db: Client) -> None:
    """500개 배치 한도 회귀: 501개 노트도 여러 배치로 잘려 전부 지워져야 한다."""
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={"n1": _make_node("n1")})
    )
    _bulk_write_raw_notes(db, "c1", 501)

    repo.delete_constellation(db, "c1", owner_id="owner1")

    remaining = list(db.collection("constellations").document("c1").collection("notes").get())
    assert remaining == []


def test_remove_node_cascade_with_501_notes(db: Client) -> None:
    """500개 배치 한도 회귀: remove_node의 노트 cascade도 여러 배치로 잘려야 한다."""
    nodes = {"n1": _make_node("n1"), "n2": _make_node("n2")}
    repo.create_constellation(db, _make_constellation("c1", "owner1", nodes=nodes))
    _bulk_write_raw_notes(db, "c1", 501)
    note_repo.create_note(db, "c1", _make_note("sibling-note", "n2", "owner1"), owner_id="owner1")

    repo.remove_node(db, "c1", "n1", owner_id="owner1")

    remaining_for_n1 = list(
        db.collection("constellations")
        .document("c1")
        .collection("notes")
        .where(filter=FieldFilter("node_id", "==", "n1"))
        .get()
    )
    assert remaining_for_n1 == []
    # 다른 노드의 노트는 살아남아야 한다.
    surviving = note_repo.get_note(db, "c1", "sibling-note", owner_id="owner1")
    assert surviving.id == "sibling-note"


# --- 특수 형식 node_id (FieldPath 이스케이프 회귀) ---


def test_create_and_delete_note_with_colon_node_id_updates_note_count(db: Client) -> None:
    node_id = "element:phil-101"
    repo.create_constellation(
        db, _make_constellation("c1", "owner1", nodes={node_id: _make_node(node_id)})
    )

    created = note_repo.create_note(
        db, "c1", _make_note("note1", node_id, "owner1"), owner_id="owner1"
    )
    assert created.node_id == node_id
    raw = _raw_constellation(db, "c1")
    assert raw["nodes"][node_id]["note_count"] == 1

    note_repo.delete_note(db, "c1", "note1", owner_id="owner1")
    raw = _raw_constellation(db, "c1")
    assert raw["nodes"][node_id]["note_count"] == 0
