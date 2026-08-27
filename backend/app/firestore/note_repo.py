"""Firestore 기반 노트(note) 리포지토리.

## 컬렉션 레이아웃

`constellations/{constellation_id}/notes/{note_id}` 서브컬렉션. 부모 별자리
문서 하나당 노트가 여러 개 달릴 수 있다.

## 쓰기 경합(write contention) 설계 - 이 모듈에서 가장 중요한 제약

프론트엔드 자동저장은 노트 하나당 분당 여러 번 PATCH 요청을 보낸다. Firestore
문서 하나는 초당 쓰기 약 1회가 한도이므로, update_note/delete_note/list_notes가
매번 부모 별자리 문서를 읽거나 쓰면 활발히 편집 중인 별자리에서 그 한도에
부딪힌다. 그래서:

- update_note: 노트 문서 자체만 건드린다. 소유권은 노트 문서에 비정규화해 둔
  owner_id 필드로 검증한다 (부모 문서를 전혀 읽지 않음).
- list_notes: 부모 문서를 "일반 get() 한 번"(트랜잭션 아님)만 읽어 소유권을
  확인한다. 읽기는 초당 1회 쓰기 한도와 무관하므로 문제되지 않는다.
- create_note: 유일하게 부모 문서를 "쓰는" 함수다 - 새 노드에 노트가 달렸는지
  확인(node-existence check)하고 note_count 캐시를 올려야 하기 때문이다. 노트
  생성은 자동저장처럼 분당 여러 번 일어나는 경로가 아니라 드문 이벤트이므로
  이 정도 쓰기 빈도는 문제되지 않는다.
- delete_note: 이 모듈에서 유일하게 "삭제가" 부모 문서를 건드리는 예외다.
  note_count를 감소시켜야 하기 때문인데, 삭제도 자동저장 PATCH에 비하면 드문
  이벤트라 감수할 수 있는 비용이다 (설계 의도 - 실수로 빠뜨린 게 아니다).

## 소유권 검증 재사용

constellation_repo.load_owned_in_transaction()을 create_note가 그대로
재사용한다 - "소유권 검증 로직은 그 함수 하나뿐"이라는 불변식이 이 모듈
경계를 넘어도 깨지지 않는다 (constellation_repo.py 모듈 docstring 참고).
update_note/get_note/list_notes/delete_note는 부모 문서 트랜잭션이 필요 없는
경로이므로 이 함수를 쓰지 않고, 대신 노트 문서 자체의 owner_id 필드나(update/
get/delete) 부모 문서를 한 번 읽어 얻은 owner_id(list)로 직접 비교한다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, DocumentSnapshot, Transaction

from app.domain.constellation import Constellation, Note, NoteAttachment
from app.firestore import constellation_repo
from app.firestore.constellation_repo import (
    ConstellationNotFoundError,
    ConstellationPermissionError,
    ConstellationRepoError,
    NodeNotFoundError,
)

__all__ = [
    "ConstellationNotFoundError",
    "ConstellationPermissionError",
    "NodeNotFoundError",
    "NoteNotFoundError",
    "create_note",
    "delete_note",
    "get_note",
    "list_notes",
    "update_note",
]


class NoteNotFoundError(ConstellationRepoError):
    """지정한 id의 노트 문서가 존재하지 않을 때.

    constellation_repo.py가 아니라 여기 정의하는 이유: 이 예외는 노트 전용
    개념이고 constellation_repo.py 쪽에서는 아무도 이 예외를 발생시키거나
    잡을 필요가 없다 - 노트 관련 코드를 노트 전용 예외와 한곳에 두면 imports가
    note_repo -> constellation_repo 한 방향으로만 흘러 순환 임포트가 생기지
    않는다.
    """


def _notes_collection_ref(db: Client, constellation_id: str) -> Any:
    return constellation_repo.get_doc_ref(db, constellation_id).collection(
        constellation_repo.NOTES_SUBCOLLECTION
    )


def _note_doc_ref(db: Client, constellation_id: str, note_id: str) -> Any:
    return _notes_collection_ref(db, constellation_id).document(note_id)


def _snapshot_to_note(snapshot: DocumentSnapshot) -> Note:
    data = snapshot.to_dict()
    assert data is not None  # 호출부가 snapshot.exists를 이미 확인했다는 전제
    return Note.model_validate(data)


def create_note(db: Client, constellation_id: str, note: Note, owner_id: str) -> Note:
    """새 노트를 만들고, 부모 노드의 note_count 캐시를 원자적으로 1 증가시킨다.

    note.owner_id를 그대로 신뢰하지 않는다 - 트랜잭션 안에서 읽은 부모 별자리의
    진짜 owner_id로 강제 덮어써서 저장한다(비정규화 필드가 위조/stale될 원천
    자체를 차단). node-existence 체크와 note_count 증가를 소유권 확인과 함께
    하나의 Firestore 트랜잭션으로 묶어, 없는 노드에 노트가 만들어지거나
    note_count가 경쟁 상태로 어긋나는 일이 없게 한다.
    """
    doc_ref = constellation_repo.get_doc_ref(db, constellation_id)
    note_doc_ref = _note_doc_ref(db, constellation_id, note.id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> Note:
        constellation = constellation_repo.load_owned_in_transaction(
            transaction, doc_ref, constellation_id, owner_id
        )
        node = constellation.nodes.get(note.node_id)
        if node is None:
            raise NodeNotFoundError(note.node_id)
        finalized = note.model_copy(update={"owner_id": constellation.owner_id})
        # 모든 읽기(load_owned_in_transaction의 get)가 끝난 뒤에야 쓴다
        # (Firestore 트랜잭션 규칙: 읽기는 전부 쓰기보다 먼저).
        transaction.set(note_doc_ref, finalized.model_dump())
        transaction.update(
            doc_ref, {constellation_repo.node_note_count_path(note.node_id): node.note_count + 1}
        )
        return finalized

    return _run(transaction)


def get_note(db: Client, constellation_id: str, note_id: str, owner_id: str) -> Note:
    """노트 하나를 조회한다. 순수 읽기 - updated_at을 포함해 아무 필드도 바꾸지 않는다.

    CRITICAL: updated_at은 프론트엔드의 노트 목록 정렬 키다. 읽기 경로에서
    이 필드를 건드리면 정렬이 매 조회마다 흔들리므로 절대 write를 섞지 않는다.
    """
    snapshot = _note_doc_ref(db, constellation_id, note_id).get()
    if not snapshot.exists:
        raise NoteNotFoundError(note_id)
    note = _snapshot_to_note(snapshot)
    if note.owner_id != owner_id:
        raise ConstellationPermissionError(f"{owner_id}는 노트 {note_id}의 소유자가 아닙니다.")
    return note


def update_note(
    db: Client,
    constellation_id: str,
    note_id: str,
    *,
    title: str,
    body: str,
    is_public: bool,
    attachments: list[NoteAttachment],
    owner_id: str,
) -> Note:
    """노트 내용을 갱신한다 (자동저장 hot path).

    노트 문서만 읽고 쓴다 - 부모 별자리 문서는 절대 건드리지 않는다(모듈
    docstring의 쓰기 경합 설계 참고). title/body가 빈 문자열이어도 그대로
    허용한다("빈 노트"는 정상 상태 - Note 도메인 모델 docstring 참고).
    """
    note_doc_ref = _note_doc_ref(db, constellation_id, note_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> Note:
        snapshot = note_doc_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise NoteNotFoundError(note_id)
        note = _snapshot_to_note(snapshot)
        if note.owner_id != owner_id:
            raise ConstellationPermissionError(f"{owner_id}는 노트 {note_id}의 소유자가 아닙니다.")
        updated = note.model_copy(
            update={
                "title": title,
                "body": body,
                "is_public": is_public,
                "attachments": attachments,
                "updated_at": datetime.now(UTC),
            }
        )
        transaction.set(note_doc_ref, updated.model_dump())
        return updated

    return _run(transaction)


def list_notes(db: Client, constellation_id: str, owner_id: str) -> list[Note]:
    """별자리의 모든 노트를 updated_at 내림차순(최근 수정 순)으로 반환한다.

    소유권 확인은 부모 문서를 일반 get()(트랜잭션 아님)으로 한 번만 읽어서
    한다 - 쓰기 경합 한도는 "같은 문서에 대한 동시 쓰기"에만 적용되고 읽기는
    아무리 자주 해도 그 한도와 무관하므로, 매 list_notes 호출이 부모 문서를
    읽어도 자동저장 hot path와 충돌하지 않는다. 이 함수 자체는 아무것도 쓰지
    않으므로 어떤 노트의 updated_at도 바뀌지 않는다.
    """
    constellation = constellation_repo.get_constellation(db, constellation_id)
    if constellation is None:
        raise ConstellationNotFoundError(constellation_id)
    if constellation.owner_id != owner_id:
        raise ConstellationPermissionError(
            f"{owner_id}는 별자리 {constellation_id}의 소유자가 아닙니다."
        )
    query = _notes_collection_ref(db, constellation_id).order_by(
        "updated_at", direction=gcf.Query.DESCENDING
    )
    return [_snapshot_to_note(doc) for doc in query.stream()]


def delete_note(db: Client, constellation_id: str, note_id: str, owner_id: str) -> None:
    """노트를 삭제하고, 그 노트가 달려 있던 노드의 note_count 캐시를 1 감소시킨다.

    이 함수만 예외적으로 부모 별자리 문서를 함께 건드린다(설계 의도 - 삭제는
    자동저장 PATCH처럼 분당 여러 번 일어나는 경로가 아니라 드문 이벤트라 감수할
    수 있는 비용이다. 모듈 docstring 참고). note_count는 0 밑으로 내려가지
    않도록 max(0, ...)로 바닥을 둔다. 부모 문서가 이미 없거나(별자리 자체가
    삭제된 후 남은 고아 노트) 그 노드가 이미 없으면(remove_node로 노드 자체가
    지워진 후) note_count 보정 없이 노트 문서만 지운다.
    """
    note_doc_ref = _note_doc_ref(db, constellation_id, note_id)
    parent_doc_ref = constellation_repo.get_doc_ref(db, constellation_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        note_snapshot = note_doc_ref.get(transaction=transaction)
        if not note_snapshot.exists:
            raise NoteNotFoundError(note_id)
        note = _snapshot_to_note(note_snapshot)
        if note.owner_id != owner_id:
            raise ConstellationPermissionError(f"{owner_id}는 노트 {note_id}의 소유자가 아닙니다.")
        parent_snapshot = parent_doc_ref.get(transaction=transaction)
        # 모든 읽기가 끝난 뒤에야 쓰기를 시작한다 (Firestore 트랜잭션 제약).
        transaction.delete(note_doc_ref)
        if not parent_snapshot.exists:
            return
        parent_data = parent_snapshot.to_dict()
        assert parent_data is not None
        parent = Constellation.model_validate(parent_data)
        node = parent.nodes.get(note.node_id)
        if node is None:
            return
        new_count = max(0, node.note_count - 1)
        transaction.update(
            parent_doc_ref,
            {constellation_repo.node_note_count_path(note.node_id): new_count},
        )

    _run(transaction)
