"""인테이크(intake) 화면 API - 목표 질답 + 원소 보관함(bin) 제안.

연세대 인증(require_yonsei_verified) 필요 - 미인증 유저는 캔버스를 로컬로만
가지고 놀 수 있고 LLM 인테이크 대화(질답/보관함 제안/선후수 추론)는 서버에서
전부 차단한다는 정책 결정(2026-08-30)에 따른다. 과거에는 익명 방문자도 렌즈
(질답) -> 대화 -> 초안 체인을 끝까지 돌려볼 수 있게 get_current_user_optional로
열어뒀었지만(uid="anon" 공유 잡), 그 정책을 이 게이트가 대체한다 - 다섯 라우트
전부 require_yonsei_verified로 통일한다.

보관함 제안은 웹서치는 아니지만 LLM 호출 + Firestore 조회가 겹쳐 수 초 걸릴 수
있어, roadmap.py의 /preview와 동일한 "접수 즉시 202 + job_id 폴링" 패턴을 그대로
따른다(app/services/bin_jobs.py가 preview_jobs.py의 의도적 복제 - 모듈 docstring
참고). 레이트리밋은 IP 기준이라 인증 여부와 무관하게 그대로 적용된다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import Client

from app.auth.deps import require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore.client import get_firestore_client
from app.llm import get_llm_client
from app.llm.base import ChatMessage, CourseOption, LLMClient
from app.schemas.constellation_intake import (
    BinFillIn,
    BinSuggestIn,
    ChatMessageOut,
    IntakeChatIn,
    IntakeChatOut,
    JobStartOut,
    JobStatusOut,
    PrereqEdgeOut,
    PrereqsIn,
    PrereqsOut,
)
from app.services import bin_jobs, bin_suggestion

router = APIRouter(prefix="/api/constellation-intake", tags=["constellation-intake"])

_JOB_NOT_FOUND = HTTPException(status_code=404, detail="작업을 찾을 수 없어요.")


@router.post("/chat", response_model=IntakeChatOut)
async def chat(
    payload: IntakeChatIn,
    user: DecodedToken = Depends(require_yonsei_verified),
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


@router.post("/prereqs", response_model=PrereqsOut)
async def infer_prereqs(
    payload: PrereqsIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    llm: LLMClient = Depends(get_llm_client),
    _: None = Depends(rate_limit("intake-prereqs", limit=30)),
) -> PrereqsOut:
    """군집(bin) 하나의 과목 목록을 받아 선후수 위계 간선을 즉시 계산해 돌려준다.

    /bins처럼 잡 폴링(202)이 아니라 즉답이다 - infer_prerequisites는 cluster_courses
    (max_tokens=20000)보다 훨씬 가벼운 호출(4000)이고, 성운을 열 때마다(군집 클릭 시)
    호출될 수 있어 폴링 왕복을 더할 이유가 없다. 프론트는 응답을 그때그때 받아
    BinItem.prereqIds에 캐시로 저장해 재사용한다.
    """
    del user  # 인증 여부와 무관하게 동작 - /chat과 동일.
    options = [
        CourseOption(
            code=item.code,
            name=item.name,
            description=None,
            level=item.level,
            years=[],
            kind=item.kind,
            department=None,
        )
        for item in payload.items
    ]
    edges = await llm.infer_prerequisites(options)
    return PrereqsOut(
        edges=[
            PrereqEdgeOut(before=f"course:{before}", after=f"course:{after}")
            for before, after in edges
        ]
    )


@router.post("/bins", status_code=202, response_model=JobStartOut)
async def suggest_bins(
    payload: BinSuggestIn,
    user: DecodedToken = Depends(require_yonsei_verified),
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
    user: DecodedToken = Depends(require_yonsei_verified),
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
    user: DecodedToken = Depends(require_yonsei_verified),
) -> JobStatusOut:
    """보관함 제안 잡 상태 폴링. 작성자 본인만 조회 가능(타인 잡은 404로 위장)."""
    job = bin_jobs.get_job(job_id, user.uid)
    if job is None:
        raise _JOB_NOT_FOUND
    return JobStatusOut(status=job.status, result=job.result, detail=job.detail)
