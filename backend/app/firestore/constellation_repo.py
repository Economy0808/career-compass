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
함수 내부(_run_owned_transaction)가 Firestore에 저장된 실제 owner_id와 비교해
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

from app.domain.constellation import (
    Constellation,
    Edge,
    Node,
    Position,
    compute_node_counts,
    compute_progress_pct,
    prune_orphan_edges,
)

_COLLECTION = "constellations"


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


def _doc_ref(db: Client, constellation_id: str) -> Any:
    return db.collection(_COLLECTION).document(constellation_id)


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
    """
    doc_ref = _doc_ref(db, constellation_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> Constellation:
        snapshot = doc_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise ConstellationNotFoundError(constellation_id)
        constellation = _snapshot_to_constellation(snapshot)
        if constellation.owner_id != owner_id:
            raise ConstellationPermissionError(
                f"{owner_id}는 별자리 {constellation_id}의 소유자가 아닙니다."
            )
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
) -> None:
    """노드 위치만 dot-notation 부분 업데이트로 갱신한다 (드래그 앤 드롭 hot path).

    그래프 전체를 다시 쓰지 않고 "nodes.{node_id}.position" 한 필드만 갱신하므로
    같은 별자리의 다른 노드/엣지는 전혀 건드리지 않는다.
    """

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if node_id not in constellation.nodes:
            raise NodeNotFoundError(node_id)
        now = datetime.now(UTC)
        constellation.nodes[node_id].position = position
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            f"nodes.{node_id}.position": position.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    _run_owned_transaction(db, constellation_id, owner_id, _mutate)


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
            f"nodes.{node_id}.is_completed": is_completed,
            "completed_node_count": completed,
            "total_node_count": total,
            "progress_pct": progress_pct,
            "updated_at": now,
        }
        return constellation, update_data

    return _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def add_node(db: Client, constellation_id: str, node: Node, owner_id: str) -> None:
    """새 노드를 추가한다 (dot-notation 부분 업데이트 - 기존 노드/엣지는 건드리지 않음)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.nodes[node.id] = node
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            f"nodes.{node.id}": node.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def remove_node(db: Client, constellation_id: str, node_id: str, owner_id: str) -> None:
    """노드를 삭제하고, 그 노드를 참조하던 엣지도 함께 정리한다.

    엣지 정리는 기존 순수 함수 prune_orphan_edges를 그대로 재사용한다 (재구현
    금지 - 규칙의 정본을 도메인 계층 하나로 유지하기 위함). 여러 엣지가 한꺼번에
    사라질 수 있어 엣지는 dot-notation이 아니라 edges 필드 전체를 교체하고,
    노드 자신은 dot-notation으로 그 키만 삭제한다.
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
            f"nodes.{node_id}": gcf.DELETE_FIELD,
            "edges": {eid: e.model_dump() for eid, e in constellation.edges.items()},
            "completed_node_count": completed,
            "total_node_count": total,
            "progress_pct": progress_pct,
            "updated_at": now,
        }
        return constellation, update_data

    _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def add_edge(db: Client, constellation_id: str, edge: Edge, owner_id: str) -> None:
    """새 엣지를 추가한다 (dot-notation 부분 업데이트)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        now = datetime.now(UTC)
        constellation.edges[edge.id] = edge
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            f"edges.{edge.id}": edge.model_dump(),
            "updated_at": now,
        }
        return constellation, update_data

    _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def remove_edge(db: Client, constellation_id: str, edge_id: str, owner_id: str) -> None:
    """엣지를 삭제한다 (dot-notation 부분 업데이트, 노드에는 영향 없음)."""

    def _mutate(constellation: Constellation) -> tuple[Constellation, dict[str, Any]]:
        if edge_id not in constellation.edges:
            raise EdgeNotFoundError(edge_id)
        now = datetime.now(UTC)
        del constellation.edges[edge_id]
        constellation.updated_at = now
        update_data: dict[str, Any] = {
            f"edges.{edge_id}": gcf.DELETE_FIELD,
            "updated_at": now,
        }
        return constellation, update_data

    _run_owned_transaction(db, constellation_id, owner_id, _mutate)


def delete_constellation(db: Client, constellation_id: str, owner_id: str) -> None:
    """별자리 문서를 통째로 삭제한다.

    부분 업데이트가 아니라 문서 삭제 자체이므로 _run_owned_transaction의
    "update_data dict를 만든다"는 계약과 맞지 않아, 존재/소유권 확인 후
    transaction.delete를 직접 호출하는 전용 트랜잭션을 쓴다.
    """
    doc_ref = _doc_ref(db, constellation_id)
    transaction = db.transaction()

    @gcf.transactional
    def _run(transaction: Transaction) -> None:
        snapshot = doc_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise ConstellationNotFoundError(constellation_id)
        constellation = _snapshot_to_constellation(snapshot)
        if constellation.owner_id != owner_id:
            raise ConstellationPermissionError(
                f"{owner_id}는 별자리 {constellation_id}의 소유자가 아닙니다."
            )
        transaction.delete(doc_ref)

    _run(transaction)
