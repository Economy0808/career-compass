"""인테이크(Anthropic 전송) 진입 게이트: 개인정보 국외이전 사전동의.

app/auth/deps.py와 별도 파일로 두는 이유: deps.py는 순수 "신원(identity)"
관심사만 다룬다(Firebase 토큰 검증, Firestore를 전혀 모른다). 이 모듈은 그
위에 "동의(consent)" 관심사를 얹는데, Firestore 조회(app/firestore/
user_private_repo.py)가 필요해 결이 다르다 - 두 파일의 책임을 섞지 않는다.

## 기능 플래그(overseas_gate_enabled)로 감싸는 이유

프론트 동의 모달이 아직 배포되지 않았다. 이 게이트를 플래그 없이 바로
켜서 배포하면, 모달을 본 적 없는 기존 유저 전원이 인테이크 대화에서
403을 받는다. 기본값 False로 배포해 기존 동작을 그대로 유지하고, 프론트
모달이 준비된 뒤 메인 세션이 OVERSEAS_GATE_ENABLED=true로 플립한다.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.config import get_settings
from app.firestore import user_private_repo
from app.firestore.client import get_firestore_client


async def require_overseas_consent(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> DecodedToken:
    """저장된 국외이전 동의 판본이 현재 판본과 같아야 통과시킨다.

    플래그가 꺼져 있으면(기본값) Firestore 조회조차 하지 않고 곧바로
    통과시킨다 - 게이트가 꺼진 상태에서 인테이크 요청마다 불필요한 조회를
    더하지 않기 위해서다. 이 의존성은 각 라우트에서 quota 차감(요청 바디
    로직)이나 rate_limit 의존성보다 앞선 파라미터 위치에 선언해야 한다 -
    미동의 요청이 크레딧이나 레이트리밋 슬롯을 먼저 소모하면 안 되므로.
    """
    settings = get_settings()
    if not settings.overseas_gate_enabled:
        return user
    stored_version = user_private_repo.get_overseas_consent_version(db, user.uid)
    if stored_version != settings.current_overseas_consent_version:
        raise HTTPException(
            status_code=403,
            detail="AI 대화를 시작하려면 개인정보 국외이전에 동의해야 해요.",
            headers={"X-Consent-Required": "overseas"},
        )
    return user
