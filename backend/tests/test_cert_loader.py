"""큐레이션 자격증 로더(scripts/load_curated_certifications.py) 순수 함수 테스트.

Q-Net 네트워크 호출도 Firestore도 건드리지 않는다 - fetch_qnet_docs/main(I/O
계층)은 대상이 아니다(scripts/consolidate_career_paths.py 테스트와 동일 관례:
importlib로 스크립트 파일을 직접 로드해 import한다, scripts/는 패키지가 아님).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "load_curated_certifications.py"
_spec = importlib.util.spec_from_file_location("load_curated_certifications", _SCRIPT)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def _qnet_doc(
    jmcd: str, name: str, official_url: str = "https://www.q-net.or.kr", schedule=None
) -> dict:
    from app.services.cert_match import normalize_cert_name

    return {
        "jmcd": jmcd,
        "name": name,
        "name_norm": normalize_cert_name(name),
        "official_url": official_url,
        "schedule": schedule,
        "cert_class": "national_technical",
        "source_type": "open_api",
    }


class TestAssertReviewed:
    def test_rejects_reviewed_false(self) -> None:
        with pytest.raises(ValueError, match="reviewed"):
            mod.assert_reviewed({"reviewed": False, "certs": []})

    def test_rejects_missing_key(self) -> None:
        with pytest.raises(ValueError, match="reviewed"):
            mod.assert_reviewed({"certs": []})

    def test_accepts_reviewed_true(self) -> None:
        mod.assert_reviewed({"reviewed": True, "certs": []})  # no raise


class TestBuildCertDoc:
    def test_national_cert_matched_sets_jmcd_and_schedule(self) -> None:
        schedule = {"impl_yy": "2026", "impl_seq": "1"}
        qnet_index = mod.build_qnet_index([_qnet_doc("1320", "정보처리기사", schedule=schedule)])
        cert = {
            "name": "정보처리기사",
            "name_norm": "정보처리기사",
            "issuer": "한국산업인력공단",
            "scope": "domestic_national",
            "cert_class": "career_credential",
            "tier": "우대",
            "official_url": "",  # curated가 비어 있음 -> Q-Net fallback을 써야 함
        }

        doc, unmatched = mod.build_cert_doc(cert, qnet_index)

        assert unmatched is False
        assert doc["jmcd"] == "1320"
        assert doc["schedule"] == schedule
        assert doc["source_type"] == "open_api"
        assert doc["official_url"] == "https://www.q-net.or.kr"
        assert doc["doc_id"] == "1320"

    def test_national_cert_prefers_curated_official_url_over_qnet(self) -> None:
        qnet_index = mod.build_qnet_index(
            [_qnet_doc("9999", "세무사", official_url="https://www.q-net.or.kr")]
        )
        cert = {
            "name": "세무사",
            "name_norm": "세무사",
            "issuer": "국세청",
            "scope": "domestic_national",
            "cert_class": "professional_license",
            "tier": "필수",
            "official_url": "https://www.q-net.or.kr/site/semu",
        }

        doc, _ = mod.build_cert_doc(cert, qnet_index)
        assert doc["official_url"] == "https://www.q-net.or.kr/site/semu"

    def test_national_cert_unmatched_keeps_curated_and_flags(self) -> None:
        qnet_index = mod.build_qnet_index([_qnet_doc("1320", "정보처리기사")])
        cert = {
            "name": "존재하지않는국가자격",
            "name_norm": "존재하지않는국가자격",
            "issuer": "발급기관",
            "scope": "domestic_national",
            "cert_class": "career_credential",
            "tier": "우대",
            "official_url": "https://curated.example",
        }

        doc, unmatched = mod.build_cert_doc(cert, qnet_index)

        assert unmatched is True
        assert doc["jmcd"] == ""
        assert doc["schedule"] is None
        assert doc["source_type"] == "curated"
        assert doc["official_url"] == "https://curated.example"
        assert doc["doc_id"] == "cert-존재하지않는국가자격"

    def test_private_cert_never_matched_even_if_name_collides(self) -> None:
        # 이름이 우연히 Q-Net 종목명과 같아도 scope가 국가자격이 아니면 매칭 시도 자체를 안 한다.
        qnet_index = mod.build_qnet_index([_qnet_doc("1320", "전산회계1급")])
        cert = {
            "name": "전산회계1급",
            "name_norm": "전산회계1급",
            "issuer": "한국세무사회",
            "scope": "domestic_private",
            "cert_class": "career_credential",
            "tier": "필수",
            "official_url": "https://kacpta.or.kr",
        }

        doc, unmatched = mod.build_cert_doc(cert, qnet_index)

        assert unmatched is False
        assert doc["jmcd"] == ""
        assert doc["source_type"] == "curated"
        assert doc["doc_id"] == "cert-전산회계1급"

    def test_international_cert_keeps_curated_fields_untouched(self) -> None:
        cert = {
            "name": "CFA",
            "name_norm": "cfa",
            "issuer": "CFA Institute",
            "scope": "international",
            "cert_class": "career_credential",
            "tier": "우대",
            "official_url": "https://www.cfainstitute.org",
        }

        doc, unmatched = mod.build_cert_doc(cert, {})

        assert unmatched is False
        assert doc["jmcd"] == ""
        assert doc["official_url"] == "https://www.cfainstitute.org"
        assert doc["source_type"] == "curated"

    def test_attaches_search_terms_from_index(self) -> None:
        qnet_index = mod.build_qnet_index([_qnet_doc("1320", "정보처리기사")])
        search_terms_index = {"정보처리기사": ["소프트웨어 개발자"]}
        cert = {
            "name": "정보처리기사",
            "name_norm": "정보처리기사",
            "issuer": "한국산업인력공단",
            "scope": "domestic_national",
            "cert_class": "career_credential",
            "tier": "우대",
            "official_url": "",
        }

        doc, _ = mod.build_cert_doc(cert, qnet_index, search_terms_index)

        assert doc["search_terms"] == ["소프트웨어 개발자"]

    def test_search_terms_defaults_to_empty_list_when_index_absent(self) -> None:
        cert = {
            "name": "CFA",
            "name_norm": "cfa",
            "issuer": "CFA Institute",
            "scope": "international",
            "cert_class": "career_credential",
            "tier": "우대",
            "official_url": "https://www.cfainstitute.org",
        }

        doc, _ = mod.build_cert_doc(cert, {})

        assert doc["search_terms"] == []


class TestBuildSearchTermsIndex:
    def test_reverses_career_cert_map_by_name_norm(self) -> None:
        career_cert_map = {
            "증권·자산운용 애널리스트/PB": [
                {"name": "투자자산운용사", "tier": "필수"},
                {"name": "금융투자분석사", "tier": "필수"},
            ],
            "퀀트·리스크/금융공학": [{"name": "CFA", "tier": "우대"}],
        }

        index = mod.build_search_terms_index(career_cert_map)

        assert index[mod.normalize_cert_name("투자자산운용사")] == ["증권·자산운용 애널리스트/PB"]
        assert index[mod.normalize_cert_name("cfa")] == ["퀀트·리스크/금융공학"]

    def test_dedupes_and_sorts_multiple_careers_for_same_cert(self) -> None:
        career_cert_map = {
            "나중 진로": [{"name": "공통자격", "tier": "우대"}],
            "먼저 진로": [{"name": "공통자격", "tier": "우대"}],
        }

        index = mod.build_search_terms_index(career_cert_map)

        assert index[mod.normalize_cert_name("공통자격")] == ["나중 진로", "먼저 진로"]


class TestDocIdFor:
    def test_uses_jmcd_when_present(self) -> None:
        assert mod.doc_id_for("1320", "정보처리기사") == "1320"

    def test_slugs_name_norm_when_no_jmcd(self) -> None:
        assert mod.doc_id_for("", "cfa") == "cert-cfa"


class TestBuildCareerPathDocs:
    def test_maps_slug_name_and_resolves_cert_id(self) -> None:
        cert_docs_by_name = {"공인회계사(CPA)": {"doc_id": "1001"}}
        career_cert_map = {"회계/세무 전문가": [{"name": "공인회계사(CPA)", "tier": "필수"}]}

        docs = mod.build_career_path_docs(career_cert_map, cert_docs_by_name)

        assert len(docs) == 1
        doc = docs[0]
        assert doc["name"] == "회계/세무 전문가"
        assert doc["slug"] == mod.normalize_cert_name("회계/세무 전문가")
        assert "/" not in doc["slug"]  # Firestore 문서 id에 '/' 금지
        assert doc["certs"] == [{"name": "공인회계사(CPA)", "tier": "필수", "cert_id": "1001"}]

    def test_missing_cert_lookup_yields_empty_cert_id(self) -> None:
        career_cert_map = {"어떤 진로": [{"name": "매칭안된자격", "tier": "유용"}]}

        docs = mod.build_career_path_docs(career_cert_map, {})

        assert docs[0]["certs"][0]["cert_id"] == ""
