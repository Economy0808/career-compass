"""DM(다이렉트 메시지) API - 팔로잉/팔로워면 맞팔 없이도 대화 가능 (prefix /api/dm).

## 대화 자격: 팔로잉 OR 팔로워 (맞팔 불필요)

사용자 확정 정책(브리핑 원문): "DM팔로워, 팔로잉 한 사람들이랑 대화가능한
다이렉트메세지 기능" - 내가 팔로우했거나(팔로잉) 나를 팔로우한(팔로워) 사람이면
대화를 시작할 수 있다. app/firestore/follow_repo.py의 list_following_ids/
list_followers_ids 두 집합의 합집합으로 판정한다(어느 한쪽 함수만 쓰면 "상대가
나를 팔로우했지만 나는 상대를 팔로우하지 않은" 절반의 관계를 놓친다).

## 실시간이 아니라 알림과 동일한 폴링

확인 방식은 사용자 확정대로 실시간(웹소켓 등)이 아니다 - 열 때마다 조회하는
폴링/새로고침 모델이다(app/api/notifications.py와 동일 설계 수준).

## 인증: 전부 require_yonsei_verified

읽기(목록/메시지 조회)까지 포함해 전부 연세대 인증 게이트를 건다 - DM은
인증된 유저 간에만 여는 기능이라는 브리핑 지시를 그대로 따른다(다른 라우터
대부분이 "쓰기만 인증 필수, 읽기는 로그인만 필수"인 것과 다른 지점이니 유의).

## 알림 생성 실패가 메시지 전송을 막지 않는다

app/api/posts.py의 _notify와 동일한 관례 - 알림 생성은 부가 효과라 실패해도
메시지 자체는 이미 저장된 뒤이므로 로그만 남기고 삼킨다.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.domain.dm import DmMessage
from app.firestore import dm_repo, follow_repo, notification_repo, user_repo
from app.firestore.client import get_firestore_client
from app.schemas.dm import (
    DmMessageCreateIn,
    DmMessageOut,
    DmPartnerOut,
    DmPeerOut,
    DmThreadListOut,
    DmThreadOut,
)

router = APIRouter(prefix="/api/dm", tags=["dm"])
logger = logging.getLogger(__name__)

# follow_repo.list_following_ids/list_followers_ids 호출 시 명시적으로 줄 상한.
# 기본값(100)을 그대로 쓰면 팔로잉/팔로워가 그 수를 넘는 유저의 101번째부터
# 자격 판정이 거짓 False가 된다 - app/api/explore.py의 _FOLLOWING_SCAN_LIMIT과
# 동일한 함정이라 동일한 근거로 동일한 값을 쓴다(ponytail: 유저 수만 명 규모가
# 되면 페이지네이션으로 승격할 것).
_ELIGIBILITY_SCAN_LIMIT = 10_000

# GET /partners는 "새 대화를 시작할 상대를 고르는" 표시용 목록이라 대화방
# 목록(_THREAD_LIST_LIMIT=30)과 달리 활동 빈도가 아니라 팔로잉/팔로워 규모에
# 비례해 커진다 - 팔로워가 아주 많은 유저가 한 화면에 감당 못 할 만큼 긴 목록을
# 받지 않도록 표시 상한을 둔다(ponytail: 검색/페이지네이션이 필요해지면 승격할 것).
_PARTNERS_DISPLAY_LIMIT = 100

_MESSAGES_NOT_FOUND = HTTPException(status_code=404, detail="대화방을 찾을 수 없어요.")
_MESSAGES_FORBIDDEN = HTTPException(status_code=403, detail="이 대화방의 참가자가 아니에요.")
_SELF_DM_FORBIDDEN = HTTPException(status_code=400, detail="자기 자신에게 쪽지를 보낼 수 없어요.")
_NOT_ELIGIBLE = HTTPException(
    status_code=403, detail="팔로우하거나 나를 팔로우한 사람에게만 쪽지를 보낼 수 있어요."
)


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _is_eligible_peer(db: Client, uid: str, peer_uid: str) -> bool:
    """peer_uid가 uid의 팔로잉 또는 팔로워인지 확인한다(맞팔 불필요, 한쪽만 걸쳐도 됨)."""
    following = follow_repo.list_following_ids(db, uid, limit=_ELIGIBILITY_SCAN_LIMIT)
    if peer_uid in following:
        return True
    followers = follow_repo.list_followers_ids(db, uid, limit=_ELIGIBILITY_SCAN_LIMIT)
    return peer_uid in followers


def _to_message_out(message: DmMessage) -> DmMessageOut:
    return DmMessageOut(
        id=message.id,
        sender_uid=message.sender_uid,
        body=message.body,
        created_at=message.created_at,
    )


def _notify_dm(db: Client, *, recipient_uid: str, actor_uid: str) -> None:
    """DM 수신 알림 생성 - 실패해도 메시지 전송 자체를 막지 않는다(로그만 남기고 삼킨다)."""
    try:
        notification_repo.create_notification(
            db,
            recipient_uid=recipient_uid,
            actor_uid=actor_uid,
            type="dm",
            created_at=_now_ms(),
        )
    except Exception:  # 알림 생성 실패가 DM 전송 자체를 막으면 안 된다.
        logger.warning("dm notification 생성 실패", exc_info=True)


@router.get("", response_model=DmThreadListOut, response_model_exclude_none=True)
async def list_threads(
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> DmThreadListOut:
    """내 대화방 목록을 최신 메시지순으로 최대 30개 반환한다. 각 항목에 상대 프로필 동봉.

    상대 프로필은 user_repo.get_profiles로 배치 조회한다 - 대화방 개수만큼
    개별 조회하는 N+1을 피한다(app/api/notifications.py의 actor 프로필 배치 조회와
    동일한 관례).
    """
    threads = dm_repo.list_threads_for(db, user.uid)
    peer_uids = [t.peer_uid(user.uid) for t in threads]
    profiles = user_repo.get_profiles(db, peer_uids)
    items = []
    for thread in threads:
        peer_uid = thread.peer_uid(user.uid)
        profile = profiles.get(peer_uid)
        items.append(
            DmThreadOut(
                id=thread.id,
                peer=DmPeerOut(
                    uid=peer_uid,
                    display_name=(profile or {}).get("display_name"),
                    avatar_emoji=(profile or {}).get("avatar_emoji"),
                ),
                last_message_at=thread.last_message_at,
                last_message_preview=thread.last_message_preview,
                unread=thread.unread_for(user.uid),
            )
        )
    unread_total = sum(item.unread for item in items)
    return DmThreadListOut(items=items, unread_total=unread_total)


@router.get("/partners", response_model=list[DmPartnerOut], response_model_exclude_none=True)
async def list_partners(
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> list[DmPartnerOut]:
    """새로 대화를 시작할 수 있는 상대 목록 = 내 팔로잉 ∪ 내 팔로워(중복 제거, 본인 제외).

    /{thread_id}/messages보다 먼저 선언한다 - 이 라우터 모듈 docstring이 설명하는
    "고정 경로를 파라미터 경로보다 먼저 선언" 관례(app/api/posts.py의 /feed vs
    /{post_id} 사고 전례와 동일한 함정 회피)를 그대로 따른다. 실제로는 이 경로가
    두 세그먼트짜리 /{thread_id}/messages와 세그먼트 수가 달라 충돌하지 않지만,
    나중에 GET /{peer_uid} 같은 한 세그먼트 경로가 추가될 때를 대비해 미리
    안전한 위치에 둔다.

    자격 판정은 _is_eligible_peer와 동일한 두 집합(팔로잉/팔로워)을 쓰되, 여기서는
    "상대 한 명이 자격 있는가"가 아니라 "자격 있는 상대 전원"이 필요하므로 합집합을
    직접 구성한다. 프로필은 user_repo.get_profiles로 배치 조회한다(app/api/notifications.py와
    동일한 N+1 회피 관례 - 후보 수만큼 개별 조회하지 않는다).

    hasThread는 이미 이 상대와 대화방이 있는지를 나타낸다. 새 dm_repo 함수를
    추가하는 대신 기존 list_threads_for(자격 판정과 같은 상한 _ELIGIBILITY_SCAN_LIMIT로
    호출)가 돌려주는 내 전체 대화방에서 상대 uid 집합을 뽑아 재사용한다.

    정렬은 "대화가 아직 없는 상대도 나와야 한다"는 이 목록의 성격상 최신
    메시지순이 맞지 않아, 표시 이름 기준 오름차순(이름 없는 유저는 뒤로, 동명이인은
    uid로 재정렬)으로 안정적인 순서를 준다.
    """
    following = follow_repo.list_following_ids(db, user.uid, limit=_ELIGIBILITY_SCAN_LIMIT)
    followers = follow_repo.list_followers_ids(db, user.uid, limit=_ELIGIBILITY_SCAN_LIMIT)
    candidate_uids = {uid for uid in (*following, *followers) if uid != user.uid}
    if not candidate_uids:
        return []

    profiles = user_repo.get_profiles(db, list(candidate_uids))
    threads = dm_repo.list_threads_for(db, user.uid, limit=_ELIGIBILITY_SCAN_LIMIT)
    peers_with_thread = {thread.peer_uid(user.uid) for thread in threads}

    items = [
        DmPartnerOut(
            uid=uid,
            display_name=(profiles.get(uid) or {}).get("display_name"),
            avatar_emoji=(profiles.get(uid) or {}).get("avatar_emoji"),
            has_thread=uid in peers_with_thread,
        )
        for uid in candidate_uids
    ]
    items.sort(key=lambda item: (item.display_name is None, item.display_name or "", item.uid))
    return items[:_PARTNERS_DISPLAY_LIMIT]


@router.get(
    "/{thread_id}/messages", response_model=list[DmMessageOut], response_model_exclude_none=True
)
async def list_messages(
    thread_id: str,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> list[DmMessageOut]:
    """대화방의 메시지를 최신순으로 최대 50개 반환한다. 조회 시 내 안읽음을 0으로 리셋한다.

    대화방이 없으면 404, 참가자가 아니면 403(제3자가 남의 대화를 엿보는 것을 막는다).
    """
    thread = dm_repo.get_thread(db, thread_id)
    if thread is None:
        raise _MESSAGES_NOT_FOUND
    if user.uid not in thread.participant_uids:
        raise _MESSAGES_FORBIDDEN
    dm_repo.mark_read(db, thread_id, user.uid)
    messages = dm_repo.list_messages(db, thread_id)
    return [_to_message_out(m) for m in messages]


@router.post("/{peer_uid}/messages", response_model=DmMessageOut, status_code=201)
async def send_message(
    peer_uid: str,
    payload: DmMessageCreateIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> DmMessageOut:
    """peer_uid에게 쪽지를 보낸다. 팔로잉/팔로워가 아니면 403, 자기 자신이면 400.

    방이 없으면 새로 만들고, 있으면 이어붙인다(app/firestore/dm_repo.py 참고).
    """
    if peer_uid == user.uid:
        raise _SELF_DM_FORBIDDEN
    if not _is_eligible_peer(db, user.uid, peer_uid):
        raise _NOT_ELIGIBLE
    message = dm_repo.send_message(
        db, sender_uid=user.uid, peer_uid=peer_uid, body=payload.body, created_at=_now_ms()
    )
    _notify_dm(db, recipient_uid=peer_uid, actor_uid=user.uid)
    return _to_message_out(message)
