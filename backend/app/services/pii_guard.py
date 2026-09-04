"""자유서술 필드의 개인정보(PII)·연락처 유인 문구를 서버 측에서 걸러내는 가드.

법무 확정 요구사항(학회/동아리 크라우드소싱 제출 브리핑): 담당자 연락처 필드
자체를 스키마에 두지 않는다(설계상 부재 - app/schemas/societies.py 참고).
그것만으로는 사용자가 자유서술 필드(설명 등)에 직접 전화번호/이메일/카톡
오픈채팅을 적어 넣는 것까지는 막지 못하므로, 모든 자유서술 필드를 여기서
정규식으로 스캔해 걸리면 422로 거부한다.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

_PII_DETAIL = "담당자 연락처는 담지 마세요. 공식 링크만 남겨주세요."

_PHONE_RE = re.compile(r"01[016-9]-?\d{3,4}-?\d{4}")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_CONTACT_KEYWORD_RE = re.compile(r"카톡|카카오톡|오픈카톡|연락처|전화번호")
# 카톡/오픈채팅 ID나 번호 같은 "식별자스러운 토큰" - 영숫자가 3자 이상 연달아
# 나오는 덩어리. 한글 키워드와는 문자 집합이 겹치지 않으므로 키워드 매치 구간을
# 별도로 제거하지 않고 그대로 주변 창(window)에서 찾아도 오검출되지 않는다.
_IDENTIFIER_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{2,}")
_CONTACT_WINDOW = 15  # ponytail: 키워드 앞뒤 15자 고정 창 - 오탐/누락 여지가 있는
# 휴리스틱이다. 실제 신고 데이터가 쌓이면 창 크기 대신 형태소 분석 기반으로 승격할 것.


def _has_contact_solicitation(text: str) -> bool:
    """연락처 유인 키워드가 식별자스러운 토큰과 인접해 등장하는지 본다.

    키워드 단독 등장(예: "동문 연락처 관리 시스템 개발 동아리")까지 걸러내면
    정상적인 설명문까지 오탐하므로, 바로 옆에 아이디/번호 같은 토큰이 붙어 있을
    때만 실제 권유로 간주한다.
    """
    for match in _CONTACT_KEYWORD_RE.finditer(text):
        window = text[max(0, match.start() - _CONTACT_WINDOW) : match.end() + _CONTACT_WINDOW]
        if _IDENTIFIER_TOKEN_RE.search(window):
            return True
    return False


def assert_no_pii(*texts: str | None) -> None:
    """전달된 자유서술 필드 전부를 스캔해 PII/연락처 유인이 있으면 422를 던진다."""
    for text in texts:
        if not text:
            continue
        if _PHONE_RE.search(text) or _EMAIL_RE.search(text) or _has_contact_solicitation(text):
            raise HTTPException(status_code=422, detail=_PII_DETAIL)
