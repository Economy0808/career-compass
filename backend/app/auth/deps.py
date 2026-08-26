"""FastAPI 인증 의존성: Firebase ID 토큰(Authorization: Bearer) → DecodedToken, 권한 게이트.

옛 app/core/deps.py(세션 쿠키 기반)와 계약의 "형태"(선택적 조회 -> 필수 조회 ->
쓰기 게이트, 3단 구성)는 동일하게 유지하되, 자격 증명의 위치가 쿠키에서
Authorization 헤더로 바뀌었으므로 완전히 새 모듈로 작성한다. 프론트엔드에는 이제
쿠키가 없으므로(브리핑 참고) 옛 Origin/CSRF 미들웨어에 대응하는 개념도 여기 없다 -
Bearer 토큰은 브라우저가 자동으로 실어 보내지 않으므로 CSRF의 전제 자체가 없다.

에러 응답은 항상 {"detail": "..."} 형태를 유지한다 - FastAPI의 HTTPException 기본
직렬화가 이미 이 형태이고, 프론트엔드의 ApiError가 detail 필드를 읽으므로 그대로
따르면 프론트 변경이 필요 없다.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from app.auth.firebase_auth import (
    DecodedToken,
    InvalidTokenError,
    get_live_yonsei_verified,
    verify_id_token,
)

_BEARER_SCHEME = "bearer"


def _extract_bearer_token(request: Request) -> str | None:
    """Authorization 헤더에서 Bearer 토큰 문자열만 뽑아낸다.

    스킴은 대소문자 무관("Bearer", "bearer", "BEARER" 모두 허용 - RFC 7235상
    auth-scheme은 대소문자를 구분하지 않는다). 헤더 자체가 없거나, "Bearer" 스킴이
    아니거나, 토큰 부분이 비어 있으면 None을 반환한다. 이 함수는 "형식이 올바른
    토큰 문자열을 뽑아냈는가"만 판단하고, 그 토큰이 실제로 유효한지(서명/만료)는
    판단하지 않는다 - 그건 firebase_auth.verify_id_token의 책임이다.
    """
    header = request.headers.get("Authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != _BEARER_SCHEME or not token.strip():
        return None
    return token.strip()


async def get_current_user_optional(request: Request) -> DecodedToken | None:
    """Authorization 헤더가 없거나, 형식이 잘못됐거나, 토큰이 무효/만료면 None.

    옛 get_current_user_optional과 동일한 설계 의도를 따른다: "이 요청에 유효한
    신원이 없다"는 사실 자체는 에러가 아니다(공개 열람 엔드포인트가 이 의존성을
    쓴다). 헤더 누락, 스킴 오타, 토큰 만료/위조를 모두 "익명 요청"으로 뭉뚱그려
    None을 반환하고, "인증이 필수인가"의 판단과 그에 따른 401 응답은 아래
    get_current_user 하나가 전담한다 - 검증 실패 사유별로 이 함수와
    get_current_user 양쪽에 에러 처리를 중복 작성하지 않기 위한 선택이다.
    """
    token = _extract_bearer_token(request)
    if token is None:
        return None
    try:
        return verify_id_token(token)
    except InvalidTokenError:
        return None


async def get_current_user(
    user: DecodedToken | None = Depends(get_current_user_optional),
) -> DecodedToken:
    """헤더 누락/형식 오류/토큰 무효/만료 - 이유를 불문하고 신원이 없으면 401."""
    if user is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user


async def require_yonsei_verified(
    user: DecodedToken = Depends(get_current_user),
) -> DecodedToken:
    """쓰기 행동 게이트: 연세대 인증(학교메일 자동 부여 또는 학생증 승인)까지 끝난 유저만.

    설계 결정 - 클레임 신선도(staleness) 문제:
    커스텀 클레임(yonsei_verified)은 클라이언트가 ID 토큰을 갱신할 때(최대 약 1시간
    주기)까지 전파되지 않는다. 옛 시스템은 매 요청마다 Postgres를 직접 읽어 항상
    최신 상태를 봤으므로, 이는 실질적인 동작 변화다 - 아무 조치도 안 하면 방금 학교
    메일 인증/학생증 승인을 받은 유저가 새 토큰을 받아올 때까지 최대 1시간 동안
    계속 403을 보게 된다.

    선택: 토큰 안의 claim이 이미 True면 그대로 신뢰하고 추가 조회 없이 통과시킨다
    (빠른 경로 - 이미 인증된 유저의 모든 쓰기 요청마다 네트워크 호출을 추가하고
    싶지 않다, 이 경로가 압도적 다수다). claim이 False/누락이면 곧바로 403을 내지
    않고 firebase_auth.get_live_yonsei_verified로 Firebase Auth의 현재 상태를 한
    번 더 실시간 조회한다. 이 폴백은 "아직 미인증으로 보일 때"만 실행되므로 이미
    인증된 유저의 요청 빈도에는 영향이 없고, 실시간 조회 결과도 False면 여전히
    안전 측(거부)으로 fail한다 - "잘못 승인"이 아니라 "일시적으로 늦게 승인"만
    허용하는 방향이므로 보안적으로 더 관대해지는 방향이 아니다.
    """
    if user.yonsei_verified:
        return user
    if get_live_yonsei_verified(user.uid):
        return user.model_copy(update={"yonsei_verified": True})
    raise HTTPException(status_code=403, detail="연세대 학부생 인증이 필요합니다.")
