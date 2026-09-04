"""국가자격 명칭 매칭 유틸리티.

LLM이 자유 텍스트로 제안한 자격명("정보처리기사(2급)" 등)을 certifications
컬렉션의 name_norm과 대조하기 위한 순수 함수. 그라운딩(별도 작업)이 이 모듈을
import해서 쓴다 - Firestore/네트워크 의존성이 전혀 없어야 한다.
"""

from __future__ import annotations

import re

# 소문자화 후 공백/문장부호/괄호류를 전부 제거해 "collapse"한다. 한글 완성형
# 음절, 영문 소문자, 숫자만 남긴다 - 나머지는 전부 구분자/노이즈로 간주.
_STRIP_RE = re.compile(r"[^0-9a-z가-힣]")


def normalize_cert_name(name: str) -> str:
    """자격명을 매칭용으로 정규화한다: 소문자화 + 공백/문장부호/괄호 제거."""
    return _STRIP_RE.sub("", name.lower())


# 전문직 라이선스 - 그 자체로 평생 직업이 되는 자격이라, 목표의 "대표" 추천으로
# 단독 제시되면 안 된다(bin_suggestion의 무게감 규칙이 이 집합을 참조한다).
# 확장 가능한 목록: 새 전문자격이 생기면 여기에 추가.
PROFESSIONAL_LICENSE_NAMES: frozenset[str] = frozenset(
    normalize_cert_name(name)
    for name in (
        "변호사",
        "공인회계사",
        "세무사",
        "공인노무사",
        "변리사",
        "법무사",
        "보험계리사",
        "감정평가사",
        "관세사",
        "행정사",
        "의사",
        "치과의사",
        "한의사",
        "약사",
        "수의사",
        "건축사",
    )
)


def is_professional_license(label: str) -> bool:
    """라벨(정규화 전)이 전문직 라이선스 목록에 해당하는지 판정한다."""
    return normalize_cert_name(label) in PROFESSIONAL_LICENSE_NAMES
