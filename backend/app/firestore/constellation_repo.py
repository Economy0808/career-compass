"""Firestore 기반 별자리(constellation) 리포지토리.

## 소유권(ownership) 검증 설계 결정

브리핑의 예시 시그니처들은 owner_id 파라미터가 없지만, 이 모듈은 의도적으로
"기존 문서를 변경하는" 모든 함수에 owner_id: str을 필수 인자로 추가했다. 이유:

Cloud Run 백엔드는 Firebase Admin SDK로 Firestore에 접근하는데, Admin SDK는
firestore.rules를 완전히 우회한다 (rules는 브라우저/모바일 SDK의 직접 접근에만
적용된다). firestore.rules에 아무리 정교한 `owner_id == request.auth.uid` 검사를
넣어도, 이 백엔드 코드가 검사를 빼먹으면 그 무엇도 대신 막아주지 않는다 - 즉
소유권 검증의 유일한 실질적 방어선은 이 리포지토리 계층이다.

검증 로직을 API 핸들러 쪽 책임으로 두면, 라우터가 늘어날 때마다 "이 라우터도
소유권 체크를 넣었던가?"를 사람이 매번 기억해야 하고 하나라도 빠뜨리면 그 즉시
다른 유저 문서를 조작할 수 있는 구멍이 뚫린다. 대신 이 모듈은 기존 문서를
변경하는 모든 함수 시그니처에 owner_id: str을 필수로 박아 넣었다 - API 핸들러는
반드시 (검증된 Firebase ID 토큰에서 뽑은) 호출자 uid를 이 인자로 넘겨야 하고,
함수 내부(load_owned_in_transaction)가 Firestore에 저장된 실제 owner_id와 비교해
다르면 ConstellationPermissionError를 던진다. 타입 시그니처가 강제하는 체크이므로
인자 누락은 즉시 TypeError로 드러나고, 리뷰어도 diff만 보고 검증 여부를 알 수 있다.

읽기 전용 함수(get_constellation/list_by_owner/list_published)는 owner_id를
요구하지 않는다:
- list_by_owner(owner_id)는 owner_id 자체가 쿼리 필터라 별도 검사가 무의미하다.
- list_published는 공개 문서만 보므로 소유권 개념이 없다.
- get_constellation은 "이 문서를 이 요청자에게 보여줘도 되는가"(소유자이거나
  공개)를 판단하지 않는 순수 조회다. 그 판단은 "누가 요청했는가"라는 API 레이어의
  인증 컨텍스트가 있어야 가능하므로, 반환된 owner_id/is_published 필드를 보고
  API 핸들러가 직접 판단해야 한다 (firestore.rules의 allow read 조건을 API
  레이어에서 재현하는 셈). 읽기 전용이라 다른 유저 문서를 "변경"할 위험은 없다.

create_constellation은 owner_id 인자가 없다 - 비교할 기존 문서가 아직 없기
때문이다. 대신 constellation.owner_id 필드값을 그대로 신뢰한다: 이 필드에
클라이언트가 보낸 임의의 값이 아니라 반드시 검증된 ID 토큰의 uid가 들어있어야
한다는 책임은 API 핸들러에게 있다 (아래 함수 docstring에도 명시).

소유권 검증 로직 자체는 공개 함수 load_owned_in_transaction() 하나에만 존재한다
(_run_owned_transaction과 delete_constellation이 둘 다 이 함수를 호출해 존재/
소유권을 확인한다) - app/firestore/note_repo.py도 별자리 문서 자체를 변경할 때
(create_note, 노트 생성 시 부모의 note_count 갱신) 이 함수를 그대로 재사용해,
"소유권 검증 로직은 이 함수 하나뿐"이라는 불변식이 리포지토리 모듈 경계를 넘어도
깨지지 않는다.

## 비정규화(denormalized) 진행률 필드

completed_node_count / total_node_count / progress_pct는 도메인 모델
(app/domain/constellation.py의 Constellation)에는 없는, Firestore 문서 전용
필드다. 소셜 피드가 그래프 전체를 읽지 않고도 진행률을 그릴 수 있게 하려는
목적의 비정규화이므로, 도메인 모델을 오염시키지 않고 이 계층에서만 계산해
저장한다. Pydantic v2 BaseModel은 기본적으로 extra 필드를 무시하므로, Firestore
문서를 Constellation으로 역직렬화할 때 이 세 필드는 조용히 버려진다 (의도된
동작 - 진행률 계산 로직 자체는 여전히 도메인 계층의 compute_progress_pct /
compute_node_counts 하나뿐이다).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore as gcf
from google.cloud.firestore import Client, DocumentSnapshot, Transaction
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.field_path import FieldPath

from app.domain.constellation import (
    Bin,
    Constellation,
    Edge,
    Group,
    Node,
    Position,
    compute_node_counts,
    compute_progress_pct,
    prune_orphan_edges,
)

_COLLECTION = "constellations"

# constellations/{id}/notes/{note_id} 서브컬렉션 이름. note_repo.py가 이 상수를
# 그대로 재사용해, "notes"라는 문자열 리터럴이 두 모듈에 중복되지 않게 한다.
NOTES_SUBCOLLECTION = "notes"

# Firestore가 한 배치(WriteBatch)에 허용하는 최대 오퍼레이션 수
# (course_repo.py의 upsert_courses와 동일한 500 관례).
_BATCH_LIMIT = 500


def _node_path(node_id: str, *rest: str) -> str:
    """ "nodes.{node_id}[.rest...]" dot-notation 경로를 안전하게 이스케이프해 만든다.

    프론트엔드가 만드는 node_id는 `element:phil-101`, crypto.randomUUID()의
    하이픈, 숫자로 시작하는 hex id 등 Firestore 필드 경로 세그먼트 규칙
    (`[_a-zA-Z][_a-zA-Z0-9]*`)을 어기는 경우가 흔하다. FieldPath.to_api_repr()는
    필요한 세그먼트를 백틱으로 감싸 이런 id도 안전하게 경로 문자열로 만들어준다.
    반환값은 str이어야 한다 - transaction.update()/doc_ref.update()의 dict 키로
    FieldPath 객체를 그대로 넣으면 _helpers.py에서 TypeError가 난다.
    """
    return FieldPath("nodes", node_id, *rest).to_api_repr()


def _edge_path(edge_id: str, *rest: str) -> str:
    """ "edges.{edge_id}[.rest...]" dot-notation 경로를 안전하게 이스케이프해 만든다.

    _node_path와 동일한 이유(임의 형식의 id) 때문에 필요하다.
    """
    return FieldPath("edges", edge_id, *rest).to_api_repr()


def _group_path(group_id: str, *rest: str) -> str:
    """ "groups.{group_id}[.rest...]" dot-notation 경로를 안전하게 이스케이프해 만든다.

    _node_path/_edge_path와 동일한 이유(임의 형식의 id) 때문에 필요하다.
    """
    return FieldPath("groups", group_id, *rest).to_api_repr()


def _filter_existing_member_ids(
    constellation: Constellation, member_node_ids: list[str]
) -> list[str]:
    """존재하지 않는 node id를 조용히 걸러낸다.

    LLM 환각이나 노드 삭제와의 경합(그룹 갱신 요청이 만들어질 때는 존재했지만
    요청이 도달하기 전에 다른 요청이 그 노드를 지운 경우) 양쪽을 방어한다 - 422로
    거부하지 않고 조용히 걸러 저장하는 이유는, 존재하는 다른 멤버들의 그룹핑
    자체는 여전히 유효한 정보라 실패시킬 이유가 없기 때문이다.
    """
    return [nid for nid in member_node_ids if nid in constellation.nodes]


def node_note_count_path(node_id: str) -> str:
    """공개 버전: "nodes.{node_id}.note_count" dot-notation 경로.

    note_repo.py가 노트 생성/삭제 트랜잭션 안에서 부모 별자리 문서의 note_count
    캐시를 원자적으로 갱신할 때 쓴다. _node_path 자체는 이 모듈 전용 관례(private)로
    남겨두고, note_repo가 실제로 필요로 하는 이 한 가지 용도만 공개 API로 좁혀
    노출한다.
    """
    return _node_path(node_id, "note_count")


class ConstellationRepoError(Exception):
    """이 모듈이 던지는 모든 예외의 공통 베이스."""


class ConstellationNotFoundError(ConstellationRepoError):
    """지정한 id의 별자리 문서가 존재하지 않을 때."""


class ConstellationPermissionError(ConstellationRepoError):
    """호출자의 owner_id가 문서에 저장된 owner_id와 다를 때 (소유자가 아닌 변경 시도)."""


class NodeNotFoundError(ConstellationRepoError):
    """지정한 node_id가 별자리 안에 없을 때."""


class EdgeNotFoundError(ConstellationRepoError):
    """지정한 edge_id가 별자리 안에 없을 때."""


class GroupNotFoundError(ConstellationRepoError):
    """지정한 group_id가 별자리 안에 없을 때."""


def _doc_ref(db: Client, constellation_id: str) -> Any:
    return db.collection(_COLLECTION).document(constellation_id)


def get_doc_ref(db: Client, constellation_id: str) -> Any:
    """공개 버전의 _doc_ref.

    note_repo.py는 노트 서브컬렉션(constellations/{id}/notes)의 부모이자, 노트
    생성 시 소유권 확인 트랜잭션의 대상이기도 한 이 문서 참조가 필요하다. 컬렉션
    이름 상수(_COLLECTION)를 note_repo에 노출하는 대신, 이 접근자 하나만 공개
    API로 좁혀 노출한다.
    """
    return _doc_ref(db, constellation_id)


def _notes_collection_ref(db: Client, constellation_id: str) -> Any:
    return _doc_ref(db, constellation_id).collection(NOTES_SUBCOLLECTION)


def _batch_delete_docs(db: Client, doc_refs: list[Any]) -> None:
    """문서 참조 리스트를 500개 단위로 잘라 배치 삭제한다.

    course_repo.py의 upsert_courses와 동일한 500-청크 관례를 재사용한다. 노트
    서브컬렉션을 통째로 지우는 두 경로(remove_node의 특정 노드 노트 정리,
    delete_constellation의 전체 노트 정리) 모두 이 헬퍼 하나를 거치므로 배치
    한도 처리 로직이 중복되지 않는다.
    """
    for start in range(0, len(doc_refs), _BATCH_LIMIT):
        chunk = doc_refs[start : start + _BATCH_LIMIT]
        batch = db.batch()
        for ref in chunk:
            batch.delete(ref)
        batch.commit()


def _delete_all_notes(db: Client, constellation_id: str) -> None:
    """별자리 밑 notes 서브컬렉션 문서를 전부 삭제한다 (delete_constellation 전용)."""
    doc_refs = [doc.reference for doc in _notes_collection_ref(db, constellation_id).stream()]
    _batch_delete_docs(db, doc_refs)


def _delete_notes_for_node(db: Client, constellation_id: str, node_id: str) -> None:
    """특정 node_id에 달린 노트만 삭제한다 (remove_node의 노트 cascade 전용)."""
    query = _notes_collection_ref(db, constellation_id).where(
        filter=FieldFilter("node_id", "==", node_id)
    )
    doc_refs = [doc.reference for doc in query.stream()]
    _batch_delete_docs(db, doc_refs)


def _snapshot_to_constellation(snapshot: DocumentSnapshot) -> Constellation:
    """존재가 이미 확인된 snapshot을 Constellation으로 역직렬화한다.

    completed_node_count/total_node_count/progress_pct 등 도메인 모델에 없는
    필드는 Pydantic이 조용히 무시한다 (모듈 docstring 참고).
    """
    data = snapshot.to_dict()
    assert data is not None  # 호출부가 snapshot.exists를 이미 확인했다는 전제
    return Constellation.model_validate(data)


def create_constellation(db: Client, constellation: Constellation) -> None:
    """새 별자리 문서를 생성하고, 비정규화된 진행률 필드를 함께 계산해 저장한다.

    owner_id는 비교 대상(기존 문서)이 없으므로 이 함수는 검사하지 않는다 - 호출자
    (API 핸들러)가 constellation.owner_id에 검증된 ID 토큰의 uid를 넣었다는 것을
    전제한다. 클라이언트가 요청 본문에 보낸 owner_id를 그대로 믿고 넣으면 안 된다.
    """
    completed, total = compute_node_counts(constellation.nodes)
    data: dict[str, Any] = constellation.model_dump()
    data["completed_node_count"] = completed
    data["total_node_count"] = total
    data["progress_pct"] = compute_progress_pct(constellation.nodes)
    _doc_ref(db, constellation.id).set(data)


def get_constellation(db: Client, constellation_id: str) -> Constellation | None:
    """id로 별자리를 조회한다. 없으면 None.

    가시성(공개 여부/소유자 여부) 판단은 하지 않는 순수 조회다 - 호출자(API
    핸들러)가 반환된 owner_id/is_published를 보고 이 요청자에게 보여줘도 되는지
    스스로 판단해야 한다.
    """
    snapshot = _doc_ref(db, constellation_id).get()
    if not snapshot.exists:
        return None
    return _snapshot_to_constellation(snapshot)


def list_by_owner(db: Client, owner_id: str) -> list[Constellation]:
    """특정 유저가 소유한 모든 별자리 목록 (마이페이지용)."""
    query = db.collection(_COLLECTION).where(filter=FieldFilter("owner_id", "==", owner_id))
    return [_snapshot_to_constellation(doc) for doc in query.stream()]


def list_published(db: Client, limit: int = 20) -> list[Constellation]:
    """공개된 별자리를 최신순으로 최대 limit개 반환한다 (소셜 피드용)."""
    query = (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("is_published", "==", True))
        .order_by("created_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [_snapshot_to_constellation(doc) for doc in query.stream()]


def list_published_by_owner(db: Client, owner_id: str, limit: int = 30) -> list[Constellation]:
    """특정 유저가 발행한 별자리만 최신 수정순으로 최대 limit개 반환한다 (프로필 갤러리용).

    owner_id==X AND is_published==true 복합 등호 필터 + updated_at 정렬이라
    firestore.indexes.json에 (owner_id ASC, is_published ASC, updated_at DESC)
    복합 인덱스가 필요하다(추가해둠) - list_published(단일 등호 필터)와 달리
    등호 필터가 두 개라 기존 (owner_id, updated_at) 인덱스로는 커버되지 않는다.
    """
    query = (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("owner_id", "==", owner_id))
        .where(filter=FieldFilter("is_published", "==", True))
        .order_by("updated_at", direction=gcf.Query.DESCENDING)
        .limit(limit)
    )
    return [_snapshot_to_constellation(doc) for doc in query.stream()]


def load_owned_in_transaction(
    transaction: Transaction,
    doc_ref: Any,
    constellation_id: str,
    owner_id: str,
) -> Constellation:
    """트랜잭션 안에서 별자리 문서를 읽고 존재/소유권을 확인하는 유일한 정본 로직.

    이 모듈의 모든 변경 함수(_run_owned_transaction 경유)와 delete_constellation,
    그리고 app/firestore/note_repo.py(부모 문서를 함께 건드리는 create_note)가
    전부 이 함수 하나만 호출해 "존재 확인 -> 소유권 확인" 순서를 수행한다. 검증
    로직을 여기 하나로 모아두어야 소유권 체크를 빼먹는 새 호출부가 생길 수 없다
    (모듈 docstring의 소유권 검증 설계 결정 참고).

    호출부 책임: transaction.get()이 아니라 이 함수 안에서 doc_ref.get(transaction=...)을
    수행하므로, Firestore 트랜잭션 규칙("모든 읽기가 모든 쓰기보다 먼저")을 지키려면
    이 함수는 반드시 해당 트랜잭션의 다른 모든 쓰기보다 먼저 호출해야 한다.
    """
    snapshot = doc_ref.get(transaction=transaction)
    if not snapshot.exists:
        raise ConstellationNotFoundError(constellation_id)
    constellation = _snapshot_to_constellation(snapshot)
    if constellation.owner_id != owner_id:
        raise ConstellationPermissionError(
            f"{owner_id}는 별자리 {constellation_id}의 소유자가 아닙니다."
        )
    return constellation


def _run_owned_transaction(
    db: Client,
    constellation_id: str,
    owner_id: str,
    mutate: Callable[[Constellation], tuple[Constellation, dict[str, Any]]],
) -> Constellation:
    """읽기 -> 존재 확인 -> 소유권 확인 -> mutate()로 변경 계산 -> 원자적 부분 업데이트.

    mutate는 트랜잭션 안에서 읽어온 Constellation을 받아 (반환할 Constellation,
    Firestore에 쓸 dot-notation 업데이트 dict)를 돌려줘야 한다. 모든 변경 함수가
    이 헬퍼 하나를 거치므로, 소유권 검사를 빼먹는 것이 구조적으로 불가능하다.
    존재/소유권 확인 자체는 load_owned_in_transaction()에 위임한다(정본 하나).
    """
    doc_ref = _doc_ref(db, constellation_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> Constellation:
        constellation = load_owned_in_transaction(transaction, doc_ref, constellation_id, owner_id)
        updated, update_data = mutate(constellation)
        transaction.update(doc_ref, update_data)
        return updated

    return _run(transaction)


def update_node_position(
    db: Client,
    constellation_id: str,
    node_id: str,
    position: Position,
    owner_id: str,
) -> Constellation:
    """노드 위치만 dot-notation 부분 업데이트로 갱신한다 (드래그 앤 드롭 hot path).

    그래프 전체를 다시 쓰지 않고 "nodes.{node_id}.position" 한 필드만 갱신하므로
    같은 별자리의 다른 노드/엣지는 전혀 건드리지 않는다. 갱신된 Constellation을
    반환하므로 HTTP 라우터가 응답을 위해 별도로 다시 읽을 필요가 없다.
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        constellation.nodes[node_id].position = position
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node_id, "position"): position.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def update_node_color(
    db: Client,
    constellation_id: str,
    node_id: str,
    color: str | None,
    owner_id: str,
) -> Constellation:
    """노드 색상만 dot-notation 부분 업데이트로 갱신한다 (update_node_position과 동일 패턴)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        constellation.nodes[node_id].color = color
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node_id, "color"): color,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def update_node_glow(
    db: Client,
    constellation_id: str,
    node_id: str,
    glow_effect: str | None,
    owner_id: str,
) -> Constellation:
    """노드 달성 연출(glow effect) 프리셋만 dot-notation 부분 업데이트로 갱신한다 (update_node_color와 동일 패턴)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        constellation.nodes[node_id].glow_effect = glow_effect
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node_id, "glow_effect"): glow_effect,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def toggle_node_completion(
    db: Client,
    constellation_id: str,
    node_id: str,
    is_completed: bool,
    owner_id: str,
) -> Constellation:
    """노드 완료 상태를 토글하고 비정규화된 진행률 필드를 원자적으로 재계산한다.

    동시에 다른 노드가 토글되는 경쟁 상태에서도 진행률 카운트가 stale해지지 않도록
    읽기-계산-쓰기를 하나의 Firestore 트랜잭션으로 묶는다 (요구사항).
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        constellation.nodes[node_id].is_completed = is_completed
        completed, total = compute_node_counts(constellation.nodes)
        progress_pct = compute_progress_pct(constellation.nodes)
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node_id, "is_completed"): is_completed,
            "completed_node_count": completed,
            "total_node_count": total,
            "progress_pct": progress_pct,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def add_node(db: Client, constellation_id: str, node: Node, owner_id: str) -> Constellation:
    """새 노드를 추가한다 (dot-notation 부분 업데이트 - 기존 노드/엣지는 건드리지 않음)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.nodes[node.id] = node
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node.id): node.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def remove_node(db: Client, constellation_id: str, node_id: str, owner_id: str) -> Constellation:
    """노드를 삭제하고, 그 노드를 참조하던 엣지와 노트도 함께 정리한다.

    엣지 정리는 기존 순수 함수 prune_orphan_edges를 그대로 재사용한다 (재구현
    금지 - 규칙의 정본을 도메인 계층 하나로 유지하기 위함). 여러 엣지가 한꺼번에
    사라질 수 있어 엣지는 dot-notation이 아니라 edges 필드 전체를 교체하고,
    노드 자신은 dot-notation으로 그 키만 삭제한다.

    노트 cascade는 트랜잭션 커밋 "이후" 트랜잭션 밖에서 수행한다 - 노트가 몇 개든
    될 수 있어 배치 삭제가 500개 단위로 여러 커밋이 필요할 수 있는데, Firestore
    트랜잭션 자체의 쓰기 한도도 500이라 트랜잭션 안에 넣을 수 없다. 중간에 죽으면
    (노드는 이미 지워졌는데 노트만 남는 경우) 그 노트들은 어차피 부모 노드가 없는
    고아이므로 화면에 다시 노출될 일이 없고, 재시도 시 다시 지워질 수 있어
    안전하다 - note_count 보정도 필요 없다(노드 자체가 사라졌으므로).
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        del constellation.nodes[node_id]
        constellation.edges = prune_orphan_edges(constellation.nodes, constellation.edges)
        completed, total = compute_node_counts(constellation.nodes)
        progress_pct = compute_progress_pct(constellation.nodes)
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _node_path(node_id): gcf.DELETE_FIELD,
            "edges": {eid: e.model_dump() for eid, e in constellation.edges.items()},
            "completed_node_count": completed,
            "total_node_count": total,
            "progress_pct": progress_pct,
            "updated_at": now,
        }
        return constellation, update_data

    updated = _run_owned_transaction(db, constellation_id, owner_id, _mutate)
    _delete_notes_for_node(db, constellation_id, node_id)
    return updated


def add_edge(db: Client, constellation_id: str, edge: Edge, owner_id: str) -> Constellation:
    """새 엣지를 추가한다 (dot-notation 부분 업데이트)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.edges[edge.id] = edge
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _edge_path(edge.id): edge.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def update_edge_color(
    db: Client,
    constellation_id: str,
    edge_id: str,
    color: str | None,
    owner_id: str,
) -> Constellation:
    """엣지 색상만 dot-notation 부분 업데이트로 갱신한다 (update_node_color와 동일 패턴)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if edge_id not in constellation.edges:
            raise EdgeNotFoundError(edge_id)
        now = datetime.now(UTC)
        constellation.edges[edge_id].color = color
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _edge_path(edge_id, "color"): color,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def remove_edge(db: Client, constellation_id: str, edge_id: str, owner_id: str) -> Constellation:
    """엣지를 삭제한다 (dot-notation 부분 업데이트, 노드에는 영향 없음)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if edge_id not in constellation.edges:
            raise EdgeNotFoundError(edge_id)
        now = datetime.now(UTC)
        del constellation.edges[edge_id]
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _edge_path(edge_id): gcf.DELETE_FIELD,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def set_published(
    db: Client,
    constellation_id: str,
    is_published: bool,
    owner_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    contributors: list[str] | None = None,
) -> Constellation:
    """별자리의 공개 여부와 발행 메타(title/description/contributors)를 설정한다.

    title/description/contributors는 None이면 기존 값을 그대로 두고, 값이 온
    필드만 갱신한다(부분 갱신 의미론 - API 스키마 PublishPatchIn의 규약과 동일).
    is_published는 항상 갱신 대상이다(이 필드 자체가 이 함수의 필수 인자이므로
    "값이 왔는지"를 구분할 필요가 없다). 트랜잭션으로 원자성을 보장한다.
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.is_published = is_published
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            "is_published": is_published,
            "updated_at": now,
        }
        if title is not None:
            constellation.title = title
            update_data["title"] = title
        if description is not None:
            constellation.description = description
            update_data["description"] = description
        if contributors is not None:
            constellation.contributors = contributors
            update_data["contributors"] = contributors
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def replace_bins(
    db: Client, constellation_id: str, bins: list[Bin], owner_id: str
) -> Constellation:
    """우측 패널 보관함(bins)을 통째로 교체한다.

    nodes/edges와 달리 dot-notation 부분 업데이트를 쓰지 않는다 - 프론트엔드가
    보관함 배열 전체를 항상 자신의 상태로 들고 있다가 그대로 밀어넣는 "전체
    교체" 의미론이기 때문이다(bin 개별 추가/삭제 API는 없음, YAGNI). 즉 이
    호출 이전에 있던 bins는 이번 요청에 없으면 전부 사라진다 - 부분적으로
    합쳐지지 않는다.
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.bins = bins
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            "bins": [b.model_dump() for b in bins],
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def create_group(db: Client, constellation_id: str, group: Group, owner_id: str) -> Constellation:
    """새 성단(group)을 추가한다 (dot-notation 부분 업데이트).

    member_node_ids 중 존재하지 않는 node id는 조용히 걸러 저장한다
    (_filter_existing_member_ids 참고).
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        filtered = group.model_copy(
            update={
                "member_node_ids": _filter_existing_member_ids(constellation, group.member_node_ids)
            }
        )
        constellation.groups[filtered.id] = filtered
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _group_path(filtered.id): filtered.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def update_group(
    db: Client,
    constellation_id: str,
    group_id: str,
    owner_id: str,
    *,
    label: str | None = None,
    collapsed: bool | None = None,
    member_node_ids: list[str] | None = None,
    position: Position | None = None,
) -> Constellation:
    """성단을 부분 갱신한다 - None이 아닌 필드만 반영한다(다른 부분 갱신 함수들과 동일 의미론).

    member_node_ids가 오면 존재하지 않는 node id를 조용히 걸러 저장한다.
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if group_id not in constellation.groups:
            raise GroupNotFoundError(group_id)
        now = datetime.now(UTC)
        group = constellation.groups[group_id]
        update_data: dict[str, Any] = {"updated_at": now}
        if label is not None:
            group.label = label
            update_data[_group_path(group_id, "label")] = label
        if collapsed is not None:
            group.collapsed = collapsed
            update_data[_group_path(group_id, "collapsed")] = collapsed
        if member_node_ids is not None:
            filtered = _filter_existing_member_ids(constellation, member_node_ids)
            group.member_node_ids = filtered
            update_data[_group_path(group_id, "member_node_ids")] = filtered
        if position is not None:
            group.position = position
            update_data[_group_path(group_id, "position")] = position.model_dump()
        constellation.updated_at = now
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def delete_group(db: Client, constellation_id: str, group_id: str, owner_id: str) -> Constellation:
    """성단만 삭제한다("해제") - 멤버 노드/엣지는 전혀 건드리지 않는다."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if group_id not in constellation.groups:
            raise GroupNotFoundError(group_id)
        now = datetime.now(UTC)
        del constellation.groups[group_id]
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            _group_path(group_id): gcf.DELETE_FIELD,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def delete_constellation(db: Client, constellation_id: str, owner_id: str) -> None:
    """별자리 문서와 그 밑의 notes 서브컬렉션 전체를 삭제한다.

    Firestore는 문서를 지워도 서브컬렉션을 자동으로 지우지 않는다 - 부모 문서만
    지우면 notes/* 문서들이 도달 불가능한 고아로 영구히 남는다(부모가 없으니
    쿼리 진입점도 사라져 UI/배치 정리 어느 쪽으로도 다시 찾을 수 없다). 그래서
    반드시 노트를 먼저 전부 지우고 부모 문서를 마지막에 지운다: 순서를 반대로
    하면(부모 먼저) 삭제 도중 프로세스가 죽었을 때 get_constellation은 이미
    None을 반환해 API 상으로는 "삭제 완료"로 보이지만 실제로는 notes 서브컬렉션이
    그대로 남아있는, 더 이상 발견도 삭제도 할 수 없는 상태가 될 수 있다.

    존재/소유권 확인은 트랜잭션(load_owned_in_transaction)으로 한 번만 하고, 그
    결과를 신뢰해 노트 배치 삭제와 부모 문서 삭제를 순서대로 수행한다. 노트 배치
    삭제 자체를 이 트랜잭션 안에 넣을 수 없다 - 500개 넘는 노트는 여러 커밋이
    필요한데, 트랜잭션 자체의 쓰기 한도도 500이기 때문이다(remove_node와 동일한
    제약).
    """
    doc_ref = _doc_ref(db, constellation_id)
    transaction = db.transaction()

    @gcf.transactional
    def _check(transaction: Transaction) -> None:
        load_owned_in_transaction(transaction, doc_ref, constellation_id, owner_id)

    _check(transaction)
    _delete_all_notes(db, constellation_id)
    doc_ref.delete()
