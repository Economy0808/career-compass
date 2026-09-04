"""자격증 그라운딩(post-filter 배지 매칭 + 전문직 라이선스 무게감) 테스트.

RAG가 아니라 post-filter다: LLM 프롬프트에 카탈로그를 주입하지 않고, 생성된
라벨을 사후에 certifications 마스터와 대조만 한다. Firestore를 전혀 건드리지
않는다 - certification_repo.get_by_name_norm을 통째로 모킹한다
(SAFETY: 이 세션은 네트워크/Firestore 호출 금지).
"""

from __future__ import annotations

from unittest.mock import patch

from app.llm.anthropic_client import AnthropicClaudeClient
from app.llm.base import SupportBin, SupportElement
from app.services import bin_suggestion


def _cert_element(label: str, **kwargs: object) -> SupportElement:
    return SupportElement(label=label, type="certification", **kwargs)  # type: ignore[arg-type]


@patch("app.firestore.certification_repo.get_by_name_norm")
def test_matched_cert_gets_verified_badge_from_db_not_llm(mock_get: object) -> None:
    mock_get.return_value = {  # type: ignore[attr-defined]
        "official_url": "https://official.example/q-net",
        "schedule": "2026-11-01",
        "cert_class": "national_technical",
    }
    # LLM 요소가 가짜 url을 들고 있어도(SupportElement.url) 절대 반영되면 안 된다.
    element = _cert_element("ADsP", url="https://bogus.attacker.example")

    item = bin_suggestion._support_item(element, db=None)  # type: ignore[arg-type]

    assert item["verified"] is True
    assert item["official_url"] == "https://official.example/q-net"
    assert item["schedule"] == "2026-11-01"
    assert item["cert_class"] == "national_technical"
    assert item["official_url"] != "https://bogus.attacker.example"


@patch("app.firestore.certification_repo.get_by_name_norm")
def test_unmatched_cert_is_unverified_with_no_url_or_schedule(mock_get: object) -> None:
    mock_get.return_value = None  # type: ignore[attr-defined]
    element = _cert_element("존재하지않는가짜자격증")

    item = bin_suggestion._support_item(element, db=None)  # type: ignore[arg-type]

    assert item["verified"] is False
    assert "official_url" not in item
    assert "schedule" not in item
    assert "cert_class" not in item


@patch("app.firestore.certification_repo.get_by_name_norm")
def test_professional_license_forced_class_even_without_db_match(mock_get: object) -> None:
    mock_get.return_value = None  # type: ignore[attr-defined]
    element = _cert_element("공인회계사")

    item = bin_suggestion._support_item(element, db=None)  # type: ignore[arg-type]

    assert item["verified"] is False
    assert item["cert_class"] == "professional_license"


@patch("app.firestore.certification_repo.get_by_name_norm")
def test_professional_license_reordered_to_end_not_first(mock_get: object) -> None:
    mock_get.return_value = None  # type: ignore[attr-defined]
    bin_view = SupportBin(
        name="세무/회계 자격증",
        elements=[_cert_element("공인회계사"), _cert_element("전산회계1급")],
    )

    wire_bin = bin_suggestion._support_bin(bin_view, db=None)  # type: ignore[arg-type]

    labels_in_order = [item["label"] for item in wire_bin["items"]]
    assert labels_in_order[0] == "전산회계1급"
    assert labels_in_order[-1] == "공인회계사"
    # 병기는 허용 - 제거되지 않고 여전히 둘 다 남아 있어야 한다.
    assert len(labels_in_order) == 2


def test_prompt_warns_against_professional_license_as_sole_recommendation() -> None:
    import inspect

    source = inspect.getsource(AnthropicClaudeClient.suggest_support_elements)
    assert "전문직" in source
    assert "단독" in source
