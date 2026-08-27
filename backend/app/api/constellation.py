"""별자리(constellation) API.

Firebase Bearer 토큰 인증만 요구한다(연세 인증 게이트 없음 - 브리핑 명시).
리포지토리 계층(app/firestore/constellation_repo.py, note_repo.py)이 소유권
검증의 유일한 실질적 방어선이므로, 이 라우터는 리포지토리가 던지는 예외를
HTTP 상태코드로 옮기는 얇은 어댑터 역할만 한다 - 소유권 로직을 여기서
재구현하지 않는다.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import ParamSpec, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.domain.constellation import Constellation, Note, Position
from app.firestore import constellation_repo, note_repo, user_repo
from app.firestore.client import get_firestore_client
from app.firestore.constellation_repo import (
    ConstellationNotFoundError,
    ConstellationPermissionError,
    EdgeNotFoundError,
    NodeNotFoundError,
)
from app.firestore.note_repo import NoteNotFoundError
from app.schemas.constellation import (
    BinsPutIn,
    CompletionPatchIn,
    ConstellationCreateIn,
    ConstellationOut,
    EdgeCreateIn,
    FeedAuthorOut,
    FeedItemOut,
    NodeCreateIn,
    NoteCreateIn,
    NoteOut,
    NotePatchIn,
    PositionPatchIn,
    PublishPatchIn,
    attachment_from_in,
    bin_from_in,
    constellation_to_out,
    edge_from_create_in,
    node_from_create_in,
    note_to_out,
)

router = APIRouter(prefix="/api/constellations", tags=["constellations"])

_P = ParamSpec("_P")
_R = TypeVar("_R")


def _translate_repo_errors(fn: Callable[_P, _R]) -> Callable[_P, _R]:
    """리포지토리 예외(*NotFoundError/*PermissionError)를 HTTP 404/403으로 옮긴다.

    12개 엔드포인트마다 동일한 try/except를 반복하지 않기 위한 얇은 데코레이터.
    ConstellationRepoError 서브클래스가 늘어나도(예: 새 리소스 종류) 이 한 곳만
    갱신하면 된다.
    """

    def _wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        try:
            return fn(*args, **kwargs)
        except (
            ConstellationNotFoundError,
            NodeNotFoundError,
            EdgeNotFoundError,
            NoteNotFoundError,
        ) as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ConstellationPermissionError as e:
            raise HTTPException(status_code=403, detail=str(e)) from e

    return _wrapper


@_translate_repo_errors
def _get_owned_or_published(db: Client, constellation_id: str, uid: str) -> ConstellationOut:
    """조회 전용 가시성 판단: 소유자이거나 공개된 별자리만 볼 수 있다.

    get_constellation 자체는 가시성을 판단하지 않는 순수 조회이므로(리포지토리
    docstring 참고), 이 API 레이어가 firestore.rules의 allow read 조건을 재현한다.
    """
    constellation = constellation_repo.get_constellation(db, constellation_id)
    if constellation is None:
        raise ConstellationNotFoundError(constellation_id)
    if constellation.owner_id != uid and not constellation.is_published:
        raise ConstellationPermissionError(
            f"{uid}는 별자리 {constellation_id}를 열람할 수 없습니다."
        )
    return constellation_to_out(constellation)


@router.post("", status_code=201, response_model=ConstellationOut, response_model_exclude_none=True)
async def create_constellation(
    payload: ConstellationCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    """새 별자리를 만든다. 초기 nodes/edges를 함께 받아 한 번에 저장할 수 있다."""
    now = datetime.now(UTC)
    nodes = {n.id: node_from_create_in(n, created_at=now) for n in payload.nodes}
    edges = {e.id: edge_from_create_in(e) for e in payload.edges}
    bins = [bin_from_in(b) for b in payload.bins]
    constellation = Constellation(
        id=str(uuid.uuid4()),
        owner_id=user.uid,
        title=payload.title,
        goal_raw_text=payload.goal_raw_text,
        nodes=nodes,
        edges=edges,
        bins=bins,
        is_published=False,
        created_at=now,
        updated_at=now,
    )
    constellation_repo.create_constellation(db, constellation)
    return constellation_to_out(constellation)


@router.get("", response_model=list[ConstellationOut], response_model_exclude_none=True)
async def list_my_constellations(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[ConstellationOut]:
    """내가 소유한 모든 별자리 목록 (마이페이지용)."""
    constellations = constellation_repo.list_by_owner(db, user.uid)
    return [constellation_to_out(c) for c in constellations]


@router.get("/feed", response_model=list[FeedItemOut], response_model_exclude_none=True)
async def get_feed(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[FeedItemOut]:
    """공개된 별자리 피드 (최신 수정순, 최대 20개).

    ROUTE ORDER: 반드시 GET /{constellation_id}보다 먼저 선언해야 한다 -
    그렇지 않으면 FastAPI가 "feed"를 constellation_id 경로 파라미터로 매칭한다.

    항목마다 작성자 프로필을 추가로 조회한다(N+1) - limit 20 상한이 있어
    허용되는 수준이다. 피드 규모가 커지면 배치 조회로 바꿔야 한다.
    """
    constellations = constellation_repo.list_published(db, limit=20)
    constellations.sort(key=lambda c: c.updated_at, reverse=True)
    items = []
    for c in constellations:
        profile = user_repo.get_user_profile(db, c.owner_id)
        author = FeedAuthorOut(
            display_name=profile.get("display_name") if profile else None,
            avatar_emoji=profile.get("avatar_emoji") if profile else None,
        )
        items.append(FeedItemOut(constellation=constellation_to_out(c), author=author))
    return items


@router.get(
    "/{constellation_id}", response_model=ConstellationOut, response_model_exclude_none=True
)
async def get_constellation(
    constellation_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    """별자리 하나를 조회한다. 소유자이거나 공개된 별자리만 허용한다."""
    return _get_owned_or_published(db, constellation_id, user.uid)


@router.delete("/{constellation_id}", status_code=204)
async def delete_constellation(
    constellation_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    _translate_repo_errors(constellation_repo.delete_constellation)(db, constellation_id, user.uid)


@router.patch(
    "/{constellation_id}/publish",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def set_published(
    constellation_id: str,
    payload: PublishPatchIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    updated = _translate_repo_errors(constellation_repo.set_published)(
        db, constellation_id, payload.is_published, user.uid
    )
    return constellation_to_out(updated)


@router.put(
    "/{constellation_id}/bins",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def replace_bins(
    constellation_id: str,
    payload: BinsPutIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    """우측 패널 보관함을 통째로 교체한다. 요청에 없는 기존 bin은 사라진다."""
    bins = [bin_from_in(b) for b in payload.bins]
    updated = _translate_repo_errors(constellation_repo.replace_bins)(
        db, constellation_id, bins, user.uid
    )
    return constellation_to_out(updated)


@router.post(
    "/{constellation_id}/nodes",
    status_code=201,
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def add_node(
    constellation_id: str,
    payload: NodeCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    node = node_from_create_in(payload, created_at=datetime.now(UTC))
    updated = _translate_repo_errors(constellation_repo.add_node)(
        db, constellation_id, node, user.uid
    )
    return constellation_to_out(updated)


@router.delete(
    "/{constellation_id}/nodes/{node_id}",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def remove_node(
    constellation_id: str,
    node_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    updated = _translate_repo_errors(constellation_repo.remove_node)(
        db, constellation_id, node_id, user.uid
    )
    return constellation_to_out(updated)


@router.patch(
    "/{constellation_id}/nodes/{node_id}/position",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def update_node_position(
    constellation_id: str,
    node_id: str,
    payload: PositionPatchIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    position = Position(x=payload.position.x, y=payload.position.y)
    updated = _translate_repo_errors(constellation_repo.update_node_position)(
        db, constellation_id, node_id, position, user.uid
    )
    return constellation_to_out(updated)


@router.patch(
    "/{constellation_id}/nodes/{node_id}/completion",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def toggle_node_completion(
    constellation_id: str,
    node_id: str,
    payload: CompletionPatchIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    updated = _translate_repo_errors(constellation_repo.toggle_node_completion)(
        db, constellation_id, node_id, payload.is_completed, user.uid
    )
    return constellation_to_out(updated)


@router.post(
    "/{constellation_id}/edges",
    status_code=201,
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def add_edge(
    constellation_id: str,
    payload: EdgeCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    edge = edge_from_create_in(payload)
    updated = _translate_repo_errors(constellation_repo.add_edge)(
        db, constellation_id, edge, user.uid
    )
    return constellation_to_out(updated)


@router.delete(
    "/{constellation_id}/edges/{edge_id}",
    response_model=ConstellationOut,
    response_model_exclude_none=True,
)
async def remove_edge(
    constellation_id: str,
    edge_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> ConstellationOut:
    updated = _translate_repo_errors(constellation_repo.remove_edge)(
        db, constellation_id, edge_id, user.uid
    )
    return constellation_to_out(updated)


@router.post("/{constellation_id}/notes", status_code=201, response_model=NoteOut)
async def create_note(
    constellation_id: str,
    payload: NoteCreateIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> NoteOut:
    """노트를 만든다. id가 없으면 서버가 uuid4를 생성해 응답에 반드시 포함한다.

    owner_id는 요청자 값을 임시로 넣어두지만, note_repo.create_note가 트랜잭션
    안에서 부모 별자리의 진짜 owner_id로 강제 덮어쓴다(리포지토리 docstring
    참고) - 여기서 위조 owner_id를 걱정할 필요가 없다.
    """
    now = datetime.now(UTC)
    note = Note(
        id=payload.id or str(uuid.uuid4()),
        node_id=payload.node_id,
        owner_id=user.uid,
        title=payload.title,
        body=payload.body,
        is_public=payload.is_public,
        attachments=[attachment_from_in(a) for a in payload.attachments],
        created_at=now,
        updated_at=now,
    )
    created = _translate_repo_errors(note_repo.create_note)(db, constellation_id, note, user.uid)
    return note_to_out(created)


@router.get("/{constellation_id}/notes", response_model=list[NoteOut])
async def list_notes(
    constellation_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[NoteOut]:
    notes = _translate_repo_errors(note_repo.list_notes)(db, constellation_id, user.uid)
    return [note_to_out(n) for n in notes]


@router.patch("/{constellation_id}/notes/{note_id}", response_model=NoteOut)
async def update_note(
    constellation_id: str,
    note_id: str,
    payload: NotePatchIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> NoteOut:
    updated = _translate_repo_errors(note_repo.update_note)(
        db,
        constellation_id,
        note_id,
        title=payload.title,
        body=payload.body,
        is_public=payload.is_public,
        attachments=[attachment_from_in(a) for a in payload.attachments],
        owner_id=user.uid,
    )
    return note_to_out(updated)


@router.delete("/{constellation_id}/notes/{note_id}", status_code=204)
async def delete_note(
    constellation_id: str,
    note_id: str,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> None:
    _translate_repo_errors(note_repo.delete_note)(db, constellation_id, note_id, user.uid)
