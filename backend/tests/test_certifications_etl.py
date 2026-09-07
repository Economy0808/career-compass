"""국가자격 마스터 ETL 순수 함수 유닛 테스트 - 네트워크/Firestore 의존성 없음.

인라인 XML/JSON 픽스처로 파싱 + 조인 + cert_class + normalize를 검증한다.
"""

from __future__ import annotations

from datetime import date

from app.etl.certifications import (
    build_certification_docs,
    parse_exam_schedule_json,
    parse_jongmok_list_xml,
)
from app.services.cert_match import normalize_cert_name

_XML_FIXTURE = """<response>
  <body>
    <items>
      <item>
        <qualgbcd>T</qualgbcd>
        <qualgbnm>기술자격</qualgbnm>
        <seriescd>02</seriescd>
        <seriesnm>정보기술</seriesnm>
        <jmcd>1320</jmcd>
        <jmfldnm>정보처리기사</jmfldnm>
        <obligfldcd>02</obligfldcd>
        <obligfldnm>정보통신</obligfldnm>
        <mdobligfldcd>0203</mdobligfldcd>
        <mdobligfldnm>정보기술</mdobligfldnm>
      </item>
      <item>
        <qualgbcd>S</qualgbcd>
        <qualgbnm>전문자격</qualgbnm>
        <seriescd>05</seriescd>
        <seriesnm>법률</seriesnm>
        <jmcd>9999</jmcd>
        <jmfldnm>공인노무사</jmfldnm>
        <obligfldcd>05</obligfldcd>
        <obligfldnm>법률</obligfldnm>
        <mdobligfldcd>0501</mdobligfldcd>
        <mdobligfldnm>노무</mdobligfldnm>
      </item>
    </items>
  </body>
</response>"""


def _schedule_json(items: list[dict]) -> dict:
    # 실제 라이브 응답 모양: 최상위 header/body, body.items는 이미 리스트
    # (2026-09 Phase 3 키 검증으로 확인 - response 래핑이 아니다).
    return {
        "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
        "body": {"items": items, "totalCount": len(items)},
    }


def test_parse_jongmok_list_xml_maps_fields():
    items = parse_jongmok_list_xml(_XML_FIXTURE)
    assert len(items) == 2
    first = items[0]
    assert first["jmcd"] == "1320"
    assert first["jmfldnm"] == "정보처리기사"
    assert first["qualgbcd"] == "T"
    assert first["seriesnm"] == "정보기술"
    assert first["mdobligfldnm"] == "정보기술"


def test_parse_exam_schedule_json_handles_single_and_list_item():
    # 단건일 때 item이 dict 하나로 오는 경우도 있음 (data.go.kr 공통 관례)
    single = parse_exam_schedule_json(_schedule_json({"jmCd": "1320", "implYy": "2026"}))
    assert single == [{"jmCd": "1320", "implYy": "2026"}]

    multi = parse_exam_schedule_json(
        _schedule_json([{"jmCd": "1320", "implYy": "2026"}, {"jmCd": "1320", "implYy": "2025"}])
    )
    assert len(multi) == 2


def test_normalize_cert_name_strips_whitespace_and_punctuation():
    assert normalize_cert_name("정보처리기사") == normalize_cert_name(" 정보처리 기사 ")
    assert normalize_cert_name("정보처리기사(산업)") == "정보처리기사산업"
    assert normalize_cert_name("CPA") == "cpa"


def test_build_certification_docs_joins_by_jmcd_and_sets_cert_class():
    master_items = parse_jongmok_list_xml(_XML_FIXTURE)
    schedule_items = [
        {
            "jmCd": "1320",
            "implYy": "2026",
            "implSeq": "1",
            "docRegStartDt": "2026-01-05",
            "docRegEndDt": "2026-01-09",
            "docExamStartDt": "2026-03-07",
            "docExamEndDt": "2026-03-07",
            "docPassDt": "2026-04-01",
            "pracRegStartDt": None,
            "pracRegEndDt": None,
            "pracExamStartDt": None,
            "pracExamEndDt": None,
            "pracPassDt": None,
        }
    ]

    docs = build_certification_docs(master_items, schedule_items, today=date(2026, 1, 1))
    by_jmcd = {d["jmcd"]: d for d in docs}

    tech = by_jmcd["1320"]
    assert tech["name"] == "정보처리기사"
    assert tech["cert_class"] == "national_technical"
    assert tech["name_norm"] == normalize_cert_name("정보처리기사")
    assert tech["schedule"] is not None
    assert tech["schedule"]["impl_yy"] == "2026"
    assert tech["schedule"]["doc_exam_start"] == "2026-03-07"
    assert tech["source_type"] == "open_api"
    assert tech["source_license"] == ""

    professional = by_jmcd["9999"]
    assert professional["cert_class"] == "national_professional"
    # 시험일정이 없는 종목 - join 실패가 아니라 정상적으로 None이어야 한다
    assert professional["schedule"] is None


def test_build_certification_docs_picks_upcoming_schedule_over_past():
    master_items = [
        {"jmcd": "1320", "jmfldnm": "정보처리기사", "qualgbcd": "T", "qualgbnm": "기술자격"}
    ]
    schedule_items = [
        {"jmCd": "1320", "implYy": "2025", "implSeq": "3", "docExamStartDt": "2025-11-01"},
        {"jmCd": "1320", "implYy": "2026", "implSeq": "1", "docExamStartDt": "2026-03-07"},
        {"jmCd": "1320", "implYy": "2026", "implSeq": "2", "docExamStartDt": "2026-06-13"},
    ]

    docs = build_certification_docs(master_items, schedule_items, today=date(2026, 1, 1))
    assert docs[0]["schedule"]["impl_seq"] == "1"  # 다가오는 시험 중 가장 이른 것


def test_build_certification_docs_falls_back_to_latest_when_all_past():
    master_items = [
        {"jmcd": "1320", "jmfldnm": "정보처리기사", "qualgbcd": "T", "qualgbnm": "기술자격"}
    ]
    schedule_items = [
        {"jmCd": "1320", "implYy": "2024", "implSeq": "1", "docExamStartDt": "2024-03-07"},
        {"jmCd": "1320", "implYy": "2025", "implSeq": "3", "docExamStartDt": "2025-11-01"},
    ]

    docs = build_certification_docs(master_items, schedule_items, today=date(2026, 1, 1))
    assert docs[0]["schedule"]["impl_yy"] == "2025"
    assert docs[0]["schedule"]["impl_seq"] == "3"
