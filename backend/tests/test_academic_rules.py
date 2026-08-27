"""학사 규정 다이제스트 상수가 프롬프트 주입에 쓸 만한 형태인지 검사한다.

**왜 필요한가**: `ACADEMIC_RULES_DIGEST`는 `data/`(gitignore 대상) 원본을 손으로
큐레이션해 코드에 고정한 상수라, 원본 파일이 없는 배포 환경에서도 값이 비어있지
않고 핵심 규정 키워드를 담고 있는지 자동으로 확인할 안전망이 없으면 조용히
망가질 수 있다. 실제 LLM 호출 없이 상수만 훑으므로 네트워크도 비용도 없다.
"""

from app.llm.academic_rules import ACADEMIC_RULES_DIGEST


def test_digest_is_non_empty() -> None:
    assert ACADEMIC_RULES_DIGEST
    assert ACADEMIC_RULES_DIGEST.strip()


def test_digest_length_within_expected_range() -> None:
    length = len(ACADEMIC_RULES_DIGEST)
    assert 8_000 <= length <= 25_000, f"digest length {length} out of expected range"


def test_digest_contains_key_markers() -> None:
    for marker in ("소속변경", "복수전공", "조기졸업", "9학점"):
        assert marker in ACADEMIC_RULES_DIGEST, f"missing marker: {marker}"
