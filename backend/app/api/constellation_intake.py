"""인테이크(intake) 화면 API - 목표 질답 + 원소 보관함(bin) 제안.

인증 불필요 - 렌즈(질답) -> 대화 -> 초안 체인은 방문자(로그인 전)도 끝까지
돌려볼 수 있어야 한다는 제품 결정(구조는 만들어보되, 결과를 실제로 저장/발행하려면
그때 가서 로그인을 요구한다 - 그 게이트는 이 모듈이 아니라 별자리 저장 라우터
쪽에 있다). 그래서 네 라우트 모두 get_current_user_optional을 쓰고, 비로그인
요청은 uid="anon"으로 잡을 소유한다.

# ponytail: 모든 익명 요청이 uid "anon" 하나를 공유하므로 잡 조회는 "내 uid로
# 생성됐는가"가 아니라 사실상 "익명 잡 전체"를 대상으로 한다. job_id가 uuid4라
# 추측 불가능해 실질적 위험은 낮지만, 남용 신호가 보이면 클라이언트별 익명 id
# (쿠키/디바이스 지문 등)로 승격할 것.

보관함 제안은 웹서치는 아니지만 LLM 호출 + Firestore 조회가 겹쳐 수 초 걸릴 수
있어, roadmap.py의 /preview와 동일한 "접수 즉시 202 + job_id 폴링" 패턴을 그대로
따른다(app/services/bin_jobs.py가 preview_jobs.py의 의도적 복제 - 모듈 docstring
참고). 레이트리밋은 IP 기준이라 인증 여부와 무관하게 그대로 적용된다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import get_current_user_optional
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
_ANON_UID = "anon"  # 비로그인 요청이 공유하는 잡 소유자 - 위 모듈 docstring의 ponytail 노트 참고.


def _uid(user: DecodedToken | None) -> str:
    return user.uid if user is not None else _ANON_UID


@router.post("/chat", response_model=IntakeChatOut)
async def chat(
    payload: IntakeChatIn,
    user: DecodedToken | None = Depends(get_current_user_optional),
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
    del user  # 인증 여부와 무관하게 동작 - 이 엔드포인트는 유저별 상태를 갖지 않는다.
    llm_messages = [ChatMessage(role=m.role, content=m.content) for m in payload.messages]
    turn = await llm.chat(payload.goal_raw_text, llm_messages, known_profile=None)

    updated_messages = list(payload.messages)
    if turn.question is not None:
        updated_messages.append(ChatMessageOut(role="assistant", content=turn.question))

    return IntakeChatOut(
        reply=turn.question,
        done=turn.done,
        messages=[ChatMessageOut(role=m.role, content=m.content) for m in updated_messages],
        hint=turn.hint,
        options=turn.options,
    )


@router.post("/bins", status_code=202, response_model=JobStartOut)
async def suggest_bins(
    payload: BinSuggestIn,
    user: DecodedToken | None = Depends(get_current_user_optional),
    llm: LLMClient = Depends(get_llm_client),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("intake-bins", limit=10)),
) -> JobStartOut:
    """전체 보관함 세트 제안을 백그라운드로 시작하고 job_id를 즉시 돌려준다."""
    goal_text = payload.goal_text

    async def _work() -> dict:
        return await bin_suggestion.suggest_all_bins(db, llm, goal_text)

    job = bin_jobs.create_job(_uid(user))
    bin_jobs.launch(job, _work)
    return JobStartOut(job_id=job.id, status=job.status)


@router.post("/bins/fill", status_code=202, response_model=JobStartOut)
async def fill_bin(
    payload: BinFillIn,
    user: DecodedToken | None = Depends(get_current_user_optional),
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

    job = bin_jobs.create_job(_uid(user))
    bin_jobs.launch(job, _work)
    return JobStartOut(job_id=job.id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusOut)
async def job_status(
    job_id: str,
    user: DecodedToken | None = Depends(get_current_user_optional),
) -> JobStatusOut:
    """보관함 제안 잡 상태 폴링. 작성자 본인만 조회 가능(타인 잡은 404로 위장).

    익명 요청은 전부 uid="anon"을 공유하므로, 로그인한 유저는 익명 잡을(uid가
    다르므로) 절대 조회할 수 없다 - 반대로 다른 익명 방문자의 잡은 job_id를
    알면 조회 가능하다(위 모듈 docstring의 ponytail 노트 참고).
    """
    job = bin_jobs.get_job(job_id, _uid(user))
    if job is None:
        raise _JOB_NOT_FOUND
    return JobStatusOut(status=job.status, result=job.result, detail=job.detail)
