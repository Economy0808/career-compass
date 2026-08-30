"""DM(다이렉트 메시지)의 순수 도메인 모델.

## 대화 자격 = 팔로잉 OR 팔로워 (맞팔 불필요)

사용자 확정 정책: 내가 팔로우했거나(팔로잉) 나를 팔로우한(팔로워) 사람이면 대화를
시작할 수 있다 - 한쪽만 걸쳐도 되고, 맞팔일 필요는 없다. 이 판정 자체는 여기가
아니라 app/api/dm.py가 app/firestore/follow_repo.py의 list_following_ids/
list_followers_ids 두 집합의 합집합으로 계산한다(도메인 모델은 자격 판정 로직을
갖지 않는다 - Post/PostComment와 같은 층 분리).

## 대화방(thread) id = 정렬된 uid 쌍

1:1 대화라 참가자 두 uid를 사전순으로 정렬해 이어붙인 id를 쓴다(app/firestore/dm_repo.py
_thread_id 참고) - follows 컬렉션의 `{follower}_{followee}` 복합 id 관례를 따르되,
팔로우와 달리 DM은 방향이 없으므로 "누가 먼저 말을 걸었는가"와 무관하게 같은 쌍이
항상 같은 문서로 수렴해야 한다(정렬하지 않으면 A->B로 시작한 대화와 B->A로
시작한 대화가 서로 다른 두 개의 방으로 쪼개진다).

## unread: 배열이 아니라 dict(map)인 이유

Firestore는 배열 필드 안에 배열/맵의 배열을 담는 것을 거부하지만(중첩 배열
금지), 최상위 필드가 dict(맵)인 것 자체는 문제없다. 참가자가 항상 2명으로
고정이니 참가자 uid를 키로 하는 map 하나로 "각자의 안읽음 수"를 표현하면
충분하다 - 팔로우 카운트처럼 정수 필드 두 개(unread_a/unread_b)로 쪼갤 수도
있었지만, uid를 키로 쓰면 "어느 쪽이 a/b인지" 순서를 신경 쓸 필요가 없어 코드가
더 단순해진다(ponytail: 그룹 DM으로 확장되면 참가자 수가 가변이라 이 구조가
그대로 유리하다 - 정수 필드 두 개 방식은 애초에 확장이 안 됐다).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

MAX_DM_BODY_LEN = 2000
MIN_DM_BODY_LEN = 1
# 대화방 목록에 노출할 마지막 메시지 미리보기 길이 - 목록 카드 한 줄에 들어갈
# 정도면 충분하다(본문 전체는 메시지 목록 조회에서 이미 따로 내려준다).
DM_PREVIEW_LEN = 80


class DmThread(BaseModel):
    """dm_threads/{thread_id} 문서 (1:1 대화방).

    participant_uids는 항상 정렬된 2명 - 정렬 이유는 모듈 docstring 참고.
    """

    id: str
    participant_uids: list[str]
    last_message_at: int  # epoch-ms
    last_message_preview: str = ""
    unread: dict[str, int] = Field(default_factory=dict)

    def peer_uid(self, viewer_uid: str) -> str:
        """참가자 2명 중 viewer_uid가 아닌 쪽을 반환한다."""
        return next(uid for uid in self.participant_uids if uid != viewer_uid)

    def unread_for(self, uid: str) -> int:
        return self.unread.get(uid, 0)


class DmMessage(BaseModel):
    """dm_threads/{thread_id}/messages/{message_id} 서브컬렉션 문서 한 건."""

    id: str
    sender_uid: str
    body: str = Field(min_length=MIN_DM_BODY_LEN, max_length=MAX_DM_BODY_LEN)
    created_at: int  # epoch-ms
