"""알림함(Notification) 순수 도메인 모델.

새 팔로워·좋아요·댓글 3종만 다룬다. 사용자 확정 스펙 원문: "알림함에 새 로드맵
발행 알림은 넣지마. 넣으면 사람들 안쓴다" - 발행 알림은 의도적으로 추가하지
않는다. actor_uid만 담아두면 충분하다 - 프로필은 이미 로그인 사용자에게 공개돼
있으므로(app/api/profiles.py) 프론트가 미팔로우 상태에서도 actor_uid로 바로
상대 프로필로 이동할 수 있다(사용자 원문: "알림오면 미팔로우 상태여도 들어가서
상대 프로필 볼 수 있게").
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

NotificationType = Literal["follow", "like", "comment"]


class Notification(BaseModel):
    """알림 한 건. Firestore 최상위 `notifications` 컬렉션 문서 (app/firestore/notification_repo.py)."""

    id: str
    recipient_uid: str
    actor_uid: str
    type: NotificationType
    post_id: str | None = None  # 팔로우 알림이면 None (게시물과 무관)
    created_at: int  # epoch-ms
    read: bool = False
