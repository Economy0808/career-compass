"""Firebase 로그인 직후 프로필 동기화 API.

프론트엔드가 Firebase 클라이언트 SDK로 로그인/가입을 마친 뒤 이 엔드포인트를
호출해 (1) Firestore의 users/{uid} 프로필을 만들거나 갱신하고 (2) 그 시점 기준
"최종" yonsei_verified 판정값을 돌려받는다. app/api/auth.py(옛 세션 기반 인증)와는
별개의 신규 인증 경로이므로 그 라우터는 건드리지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import (
    DecodedToken,
    get_live_yonsei_verified,
    maybe_auto_grant_yonsei,
)
from app.firestore.client import get_firestore_client
from app.firestore.user_repo import upsert_user_profile
from app.schemas.auth_sync import AuthSyncIn, AuthSyncOut

router = APIRouter(prefix="/api/auth", tags=["auth-firebase"])


@router.post("/sync", response_model=AuthSyncOut)
async def sync(
    body: AuthSyncIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> AuthSyncOut:
    # yonsei_verified 3단 판정. 토큰 claim이 이미 True면 그대로 신뢰해 아래 두
    # 판정을 건너뛴다(이미 인증된 유저의 매 동기화마다 Admin SDK 왕복 2회가
    # 붙는 것을 막기 위한 가드). claim이 아직 False/누락이면 먼저
    # maybe_auto_grant_yonsei로 "학교 메일 인증 완료" 조건을 확인해 자동
    # 부여를 시도하고(경로 A), 그래도 아니면 get_live_yonsei_verified로
    # Firebase Auth의 실시간 상태를 한 번 더 조회한다(경로 B: 학생증 심사가
    # 토큰 발급 이후에 승인된 stale-claim 상황 - maybe_auto_grant_yonsei는
    # 이메일 조건만 보므로 이 경우를 놓친다).
    granted = False
    if not user.yonsei_verified:
        granted = maybe_auto_grant_yonsei(user.uid, user.email, user.email_verified)
    yonsei = user.yonsei_verified or granted or get_live_yonsei_verified(user.uid)

    profile = upsert_user_profile(
        db,
        user.uid,
        display_name=body.display_name,
        avatar_emoji=body.avatar_emoji,
        consent_at=datetime.now(UTC) if body.consent else None,
    )

    return AuthSyncOut(
        uid=user.uid,
        email=user.email,
        email_verified=user.email_verified,
        yonsei_verified=yonsei,
        display_name=profile.get("display_name"),
        avatar_emoji=profile.get("avatar_emoji"),
    )
