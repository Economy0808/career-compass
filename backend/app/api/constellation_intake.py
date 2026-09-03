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

from app.auth.deps import get_current_user, require_yonsei_verified
from app.auth.firebase_auth import DecodedToken
from app.core.rate_limit import rate_limit
from app.firestore import quota_repo
from app.firestore.client import get_firestore_client
from app.firestore.quota_repo import QuotaExceeded
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
    QuotaOut,
)
from app.services import bin_jobs, bin_suggestion

router = APIRouter(prefix="/api/constellation-intake", tags=["constellation-intake"])

_JOB_NOT_FOUND = HTTPException(status_code=404, detail="작업을 찾을 수 없어요.")
_NO_CREDIT = HTTPException(
    status_code=429,
    detail="무료 사용권을 다 썼어요. 요금제에서 횟수권을 구매하면 이어서 만들 수 있어요.",
    headers={"X-Quota-Reason": "no-credit"},
)


@router.post("/chat", response_model=IntakeChatOut)
async def chat(
    payload: IntakeChatIn,
    user: DecodedToken = Depends(require_yonsei_verified),
    llm: LLMClient = Depends(get_llm_client),
    db: Client = Depends(get_firestore_client),
    _: None = Depends(rate_limit("intake-chat", limit=30)),
) -> IntakeChatOut:
    """Stateless 질답 진행. 프론트가 messages 전체 히스토리를 들고 재전송한다.

    roadmap.py의 /chat과 계약이 동일하다(모델 응답을 messages에 append해 되돌려준다)
    - 다만 known_profile은 항상 None이다: 이 Firebase 경로에는 옛 Postgres
    CareerGoal 프로필에 대응하는 개념이 아직 없다(별자리 도메인은 Firestore 전용).
    messages 자체에 max_length=40 상한이 걸려 있어(스키마 참고), 무한 질문 루프가
    나더라도 요청 바디 크기가 무한정 커지지는 않는다.

    **쿼터 차감(별자리 "1사이클")**: 요청 messages에 assistant 턴이 하나도 없으면
    이 대화의 첫 엔터라는 뜻이므로 quota_repo.consume_cycle을 호출해 무료/유료
    사이클을 차감한다. 이미 사이클이 열려 있으면 consume_cycle이 무차감으로
    이어가는 멱등 함수라 매 턴 불러도 안전하지만, 불필요한 트랜잭션 왕복을 줄이려고
    첫 턴에서만 부른다. 무료도 크레딧도 없으면 429 + X-Quota-Reason 헤더로 막는다 -
    잡 실패/빈 결과·발행 시 사이클을 닫는 훅은 bins 잡 경로/publish 핸들러에 있다.
    """
    if not any(m.role == "assistant" for m in payload.messages):
        try:
            quota_repo.consume_cycle(db, user.uid)
        except QuotaExceeded as e:
            raise _NO_CREDIT from e

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
    db: Client = Depends(get_firestore_client),
) -> JobStatusOut:
    """보관함 제안 잡 상태 폴링. 작성자 본인만 조회 가능(타인 잡은 404로 위장).

    잡이 error로 끝났거나 done인데 bins가 비었으면(유저 잘못이 아니라 LLM/카탈로그
    쪽 실패), 그 잡을 만든 /chat 대화의 사이클을 환불한다(outcome="refund"). uid는
    bin_jobs.get_job이 이미 소유권을 검증했으므로 여기서 그대로 쓴다.
    close_cycle은 열린 사이클이 없으면 no-op이라(quota_repo.py 참고), 폴링이 같은
    done/error 상태를 여러 번 조회해도 중복 환불되지 않는다.
    """
    job = bin_jobs.get_job(job_id, user.uid)
    if job is None:
        raise _JOB_NOT_FOUND
    if job.status == "error" or (job.status == "done" and not (job.result or {}).get("bins")):
        quota_repo.close_cycle(db, user.uid, outcome="refund")
    return JobStatusOut(status=job.status, result=job.result, detail=job.detail)


@router.get("/quota", response_model=QuotaOut)
async def get_quota(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> QuotaOut:
    """현재 유저의 쿼터 상태(무료 잔여/크레딧/진행 중 사이클 여부)를 돌려준다.

    이 라우터의 다른 엔드포인트와 달리 require_yonsei_verified가 아니라
    get_current_user만 요구한다 - 쿼터 조회는 LLM 인테이크 대화 자체가 아니라
    "요금제/사용권" 화면 어디서든 보여줄 수 있는 정보라, 연세대 인증 전 유저도
    자기 쿼터(가입 시 지급된 무료 1회)를 볼 수 있어야 한다.
    """
    return QuotaOut(**quota_repo.get_quota(db, user.uid))


@router.post("/cycle/discard", status_code=204)
async def discard_cycle(
    user: DecodedToken = Depends(require_yonsei_verified),
    db: Client = Depends(get_firestore_client),
) -> None:
    """진행 중인 사이클을 환불 없이 닫는다 - 프론트의 "새 별자리 시작" 액션용.

    닫아두지 않으면 quota_open_cycle이 남아 있어 다음 /chat 첫 엔터가
    consume_cycle의 멱등 규칙(열린 사이클이 있으면 무차감으로 이어감)에 따라
    그 사이클을 그대로 이어받는다 - 즉 새 별자리를 시작해도 차감되지 않는
    버그가 된다. 그래서 프론트는 새 대화를 시작하기 전 반드시 이 엔드포인트를
    먼저 불러야 한다.
    """
    quota_repo.close_cycle(db, user.uid, outcome="abandoned")
