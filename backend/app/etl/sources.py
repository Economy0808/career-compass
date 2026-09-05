"""데이터 출처 레지스트리(sources.yml) 로더 + 보안 게이트.

## KOGL(공공누리) 유형 의미
- 1유형: 출처표시만 하면 자유이용 (제약 없음)
- 2유형: 출처표시 + 상업적 이용 금지
- 3유형: 출처표시 + 변경 금지 (원문 그대로만 게시 가능 - LLM이 재작성/요약하면 안 됨)
- 4유형: 출처표시 + 상업적 이용 금지 + 변경 금지

우리 자격증 데이터는 표시(display) 전용이라 1/3유형은 화면 노출 게이트를
통과한다. 다만 3유형은 "변경 금지"이므로 LLM에 넣어 재작성시키는 용도로는
쓸 수 없다(for_llm=True면 거부). 2/4유형은 상업적 이용 금지라 우리 서비스
(유료 플랜 존재)에서는 아예 쓸 수 없다.

crowdsource(사용자 제보) 소스는 정부 라이선스 체계 밖이라 이 게이트를
면제한다 - 대신 별도 모더레이션 절차(moderate_societies.py)로 검증한다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_DEFAULT_SOURCES_PATH = Path(__file__).resolve().parent / "sources.yml"

# 화면 표시(display)까지는 허용되는 KOGL 유형. LLM 재사용까지 허용되는 유형은
# 이 중 "변경 금지"가 아닌 것만(1유형) - assert_source_allowed에서 별도 체크.
_DISPLAY_ALLOWED_KOGL_TYPES = {1, 3}
_LLM_ALLOWED_KOGL_TYPES = {1}


class SourceGateError(RuntimeError):
    """등록되지 않았거나 라이선스 조건을 만족하지 못하는 소스를 사용하려 할 때."""


def load_sources(path: Path | None = None) -> dict[str, dict[str, Any]]:
    """sources.yml을 읽어 source id -> 항목 dict 매핑으로 반환한다."""
    yaml_path = path or _DEFAULT_SOURCES_PATH
    raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    entries = raw.get("sources", [])
    return {entry["id"]: entry for entry in entries}


def assert_source_allowed(
    source_id: str,
    *,
    for_llm: bool = False,
    sources: dict[str, dict[str, Any]] | None = None,
) -> None:
    """source_id가 네트워크 호출/LLM 투입을 해도 되는 소스인지 검사한다.

    통과 조건을 만족하지 못하면 SourceGateError를 던진다 - 호출부는 이 예외를
    잡지 말고 그대로 실패시켜(fail fast) 잘못된 소스로 API를 호출하는 일을
    막아야 한다.
    """
    registry = sources if sources is not None else load_sources()

    entry = registry.get(source_id)
    if entry is None:
        raise SourceGateError(f"등록되지 않은 소스입니다: {source_id!r} (sources.yml에 추가 필요)")

    if entry.get("source_type") == "crowdsource":
        return

    kogl_type = entry.get("kogl_type")
    if not isinstance(kogl_type, int):
        raise SourceGateError(
            f"소스 {source_id!r}의 KOGL 유형이 미확인({kogl_type!r})입니다 - "
            "data.go.kr 데이터셋 페이지에서 공공누리 유형(1~4)을 확인해 "
            "sources.yml을 채우기 전에는 이 소스를 사용할 수 없습니다."
        )

    if kogl_type not in _DISPLAY_ALLOWED_KOGL_TYPES:
        raise SourceGateError(
            f"소스 {source_id!r}는 KOGL {kogl_type}유형이라 사용할 수 없습니다 "
            "(2/4유형은 상업적 이용 금지 - 유료 서비스에 반영 불가)."
        )

    if for_llm and kogl_type not in _LLM_ALLOWED_KOGL_TYPES:
        raise SourceGateError(
            f"소스 {source_id!r}는 KOGL {kogl_type}유형(변경 금지)이라 "
            "LLM 재작성/요약에 투입할 수 없습니다 - 원문 그대로 표시만 가능합니다."
        )
