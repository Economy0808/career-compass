"""개인정보 국외이전(overseas transfer) 동의 API - prefix /api/consents.

인테이크 대화(app/api/constellation_intake.py)가 Anthropic(미국)으로 데이터를
보내기 전에 PIPA 국외이전 사전동의를 판본과 함께 기록/조회한다. 이 라우터는
그 상태를 읽고 쓰는 CRUD만 다루고, 실제로 대화를 막는 강제 게이트는
app/auth/consent_deps.py의 require_overseas_consent가 별도로 담당한다(둘을
분리한 이유는 그 모듈 docstring 참고).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.config import get_settings
from app.firestore import user_private_repo
from app.firestore.client import get_firestore_client
from app.schemas.consents import OverseasConsentIn, OverseasConsentStatusOut

router = APIRouter(prefix="/api/consents", tags=["consents"])


def _status_out(stored_version: str | None) -> OverseasConsentStatusOut:
    current = get_settings().current_overseas_consent_version
    return OverseasConsentStatusOut(consented=stored_version == current, current_version=current)


@router.get("/overseas", response_model=OverseasConsentStatusOut)
async def get_overseas_consent(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> OverseasConsentStatusOut:
    """본인의 국외이전 동의 상태를 조회한다."""
    stored = user_private_repo.get_overseas_consent_version(db, user.uid)
    return _status_out(stored)


@router.post("/overseas", response_model=OverseasConsentStatusOut)
async def post_overseas_consent(
    payload: OverseasConsentIn,
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> OverseasConsentStatusOut:
    """국외이전 동의를 기록한다.

    프론트가 보낸 판본이 현재 판본과 다르면 422로 거부한다 - 유저가 화면을
    오래 띄워둔 사이 문구가 개정됐을 수 있으므로, 최신 문구에 대한 동의만
    유효한 동의로 인정한다(프론트는 이 경우 모달을 새로고침해 재시도해야 한다).
    """
    current = get_settings().current_overseas_consent_version
    if payload.version != current:
        raise HTTPException(status_code=422, detail="동의 판본이 만료됐어요. 다시 시도해주세요.")
    user_private_repo.set_overseas_consent(db, user.uid, payload.version)
    return _status_out(payload.version)
