"""인테이크(intake) 화면 API - 목표 질답 + 원소 보관함(bin) 제안.

Firebase Bearer 토큰 인증만 요구한다(app/api/constellation.py와 동일하게 연세 인증
게이트 없음). 보관함 제안은 웹서치는 아니지만 LLM 호출 + Firestore 조회가 겹쳐 수 초
걸릴 수 있어, roadmap.py의 /preview와 동일한 "접수 즉시 202 + job_id 폴링" 패턴을
그대로 따른다(app/services/bin_jobs.py가 preview_jobs.py의 의도적 복제 - 모듈
docstring 참고).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore.client import get_firestore_client
from app.llm import get_llm_client
from app.llm.base import ChatMessage, LLMClient
from app.schemas.constellation_intake import (
    BinFillIn,
    BinSuggestIn,
    ChatMessageOut,
    IntakeChatIn,
    IntakeChatOut,
    JobStartOut,
    JobStatusOut,
)
from app.services import bin_jobs, bin_suggestion

router = APIRouter(prefix="/api/constellation-intake", tags=["constellation-intake"])

_JOB_NOT_FOUND = HTTPException(status_code=404, detail="작업을 찾을 수 없어요.")


@router.post("/chat", response_model=IntakeChatOut)
async def chat(
    payload: IntakeChatIn,
    user: DecodedToken = Depends(get_current_user),
    llm: LLMClient = Depends(get_llm_client),
    _: None = Depends(rate_limit("intake-chat", limit=30)),
) -> IntakeChatOut:
    """Stateless 질답 진행. 프론트가 messages 전체 히스토리를 들고 재전송한다.

    roadmap.py의 /chat과 계약이 동일하다(모델 응답을 messages에 append해 되돌려준다)
    - 다만 known_profile은 항상 None이다: 이 Firebase 경로에는 옛 Postgres
    CareerGoal 프로필에 대응하는 개념이 아직 없다(별자리 도메인은 Firestore 전용).
    messages 자체에 max_length=40 상한이 걸려 있어(스키마 참고), 무한 질문 루프가
    나더라도 요청 바디 크기가 무한정 커지지는 않는다.
    """
    del user  # 인증 게이트로만 쓰인다 - 이 엔드포인트는 유저별 상태를 갖지 않는다.
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in payload.messages]
    turn = await llm.chat(payload.goal_raw_text, llm_messages, known_profile=None)

    updated_messages = list(payload.messages)
    if turn.question is not None:
        updated_messages.append(ChatMessageOut(role="assistant", content=turn.question))

    return IntakeChatOut(
        reply=turn.question,
        done=turn.done,
        messages=[ChatMessageOut(role=m.role, content=m.content) for m in updated_messages],
    )


@router.post("/bins", status_code=202, response_model=JobStartOut)
async def suggest_bins(
    payload: BinSuggestIn,
    user: DecodedToken = Depends(get_current_user),
    llm: LLMClient = Depends(get_llm_client),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("intake-bins", limit=10)),
) -> JobStartOut:
    """전체 보관함 세트 제안을 백그라운드로 시작하고 job_id를 즉시 돌려준다."""
    goal_text = payload.goal_text

    async def _work() -> dict:
        return await bin_suggestion.suggest_all_bins(db, llm, goal_text)

    job = bin_jobs.create_job(user.uid)
    bin_jobs.launch(job, _work)
    return JobStartOut(job_id=job.id, status=job.status)


@router.post("/bins/fill", status_code=202, response_model=JobStartOut)
async def fill_bin(
    payload: BinFillIn,
    user: DecodedToken = Depends(get_current_user),
    llm: LLMClient = Depends(get_llm_client),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("intake-bins", limit=10)),
) -> JobStartOut:
    """유저가 만든 보관함 하나를 LLM 제안으로 채우는 작업을 백그라운드로 시작한다."""
    goal_text = payload.goal_text
    bin_label = payload.bin_label

    async def _work() -> dict:
        # 프론트 폴링 계약은 suggest job과 동일한 {"bins": [...]} 형태 하나뿐이다 -
        # fill_single_bin은 bin 하나를 돌려주므로 여기서 감싸 정규화한다.
        filled = await bin_suggestion.fill_single_bin(db, llm, goal_text, bin_label)
        return {"bins": [filled]}

    job = bin_jobs.create_job(user.uid)
    bin_jobs.launch(job, _work)
    return JobStartOut(job_id=job.id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusOut)
async def job_status(
    job_id: str,
    user: DecodedToken = Depends(get_current_user),
) -> JobStatusOut:
    """보관함 제안 잡 상태 폴링. 작성자 본인만 조회 가능(타인 잡은 404로 위장)."""
    job = bin_jobs.get_job(job_id, user.uid)
    if job is None:
        raise _JOB_NOT_FOUND
    return JobStatusOut(status=job.status, result=job.result, detail=job.detail)
