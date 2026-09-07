"""국가자격 마스터 ETL (Q-Net 공공데이터포털 API 2종).

## 소스

1. 종목 목록 (InquiryListNationalQualifcationSVC/getList) - XML 응답, 자격증
   스펙의 뼈대(spine). 종목코드(jmcd)가 4자리 PRIMARY KEY.
2. 시험일정 (qualExamSchd/getQualExamSchdList) - JSON 응답, jmCd로 조인한다.
   종목명이 없으므로 반드시 1번과 join해야 의미가 생긴다.

## 설계

파싱(parse_*)과 결합(build_certification_docs)은 순수 함수 - 네트워크/Firestore
의존성이 없어 유닛 테스트가 가능하다. 실제 API 호출(fetch_*)은 얇은 함수로
분리해뒀다 - 이 모듈을 import해도 httpx 호출이 실행되지 않는다.

시험일정은 종목당 여러 회차가 있을 수 있어(implYy/implSeq), 가장 관련성 높은
회차(다가오는 시험 중 가장 이른 것, 없으면 최신 회차) 하나만 골라 붙인다.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime
from typing import Any

import httpx

from app.services.cert_match import normalize_cert_name

JONGMOK_LIST_URL = (
    "http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList"
)
EXAM_SCHEDULE_URL = "https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList"

# qualgbcd -> cert_class. 전문자격 세부 목록(변호사/의사 등 별도 배지 처리)은
# 그라운딩 작업(bin_suggestion.py)의 관심사이지 이 마스터 DB의 관심사가 아니다.
_CERT_CLASS_BY_QUAL_GB = {
    "T": "national_technical",
    "S": "national_professional",
}

# 종목별 딥링크를 신뢰성 있게 검증하지 못했으므로(마스터 API가 URL을 안 준다),
# Q-Net 대문에 jmcd만 붙여 "깨지지 않는" canonical 링크로 둔다. TODO(사용자):
# 실제 자격정보 상세 페이지 URL 패턴이 확인되면 jmcd 기반 딥링크로 교체할 것.
_OFFICIAL_URL_FALLBACK = "https://www.q-net.or.kr"

_DATE_FORMATS = ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d")


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_jongmok_list_xml(xml_text: str) -> list[dict[str, str]]:
    """종목 목록 API의 XML 응답을 파싱해 item별 dict 리스트로 반환한다.

    필드명은 API 원본 그대로(qualgbcd, jmcd, jmfldnm 등) 유지한다 - 매핑은
    build_certification_docs에서만 한다.
    """
    root = ET.fromstring(xml_text)
    items: list[dict[str, str]] = []
    for item in root.iter("item"):
        items.append({child.tag: (child.text or "").strip() for child in item})
    return items


def parse_exam_schedule_json(json_obj: dict[str, Any]) -> list[dict[str, Any]]:
    """시험일정 API의 JSON 응답을 파싱해 item별 dict 리스트로 반환한다.

    실제 라이브 응답은 response 래핑이 아니라 최상위에 header/body가 오고,
    body.items는 이미 리스트다(2026-09 Phase 3 키 검증으로 확인 - 이전 구현은
    response.body.items.item을 가정했는데 틀렸다). 단건 응답이 dict 하나로
    오는 경우도 방어적으로 리스트로 감싼다.
    """
    body = json_obj.get("body", {})
    items = body.get("items", [])
    if isinstance(items, dict):
        items = [items]
    return items


def _to_schedule_dict(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "impl_yy": item.get("implYy"),
        "impl_seq": item.get("implSeq"),
        "doc_reg_start": item.get("docRegStartDt"),
        "doc_reg_end": item.get("docRegEndDt"),
        "doc_exam_start": item.get("docExamStartDt"),
        "doc_exam_end": item.get("docExamEndDt"),
        "doc_pass": item.get("docPassDt"),
        "prac_reg_start": item.get("pracRegStartDt"),
        "prac_reg_end": item.get("pracRegEndDt"),
        "prac_exam_start": item.get("pracExamStartDt"),
        "prac_exam_end": item.get("pracExamEndDt"),
        "prac_pass": item.get("pracPassDt"),
    }


def _exam_date(item: dict[str, Any]) -> date | None:
    return _parse_date(item.get("docExamStartDt")) or _parse_date(item.get("pracExamStartDt"))


def _pick_schedule(items: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    """가장 관련성 높은 회차를 고른다: 다가오는 시험 중 가장 이른 것 우선,
    없으면 (implYy, implSeq) 최신 회차."""
    if not items:
        return None

    upcoming = [i for i in items if (d := _exam_date(i)) is not None and d >= today]
    if upcoming:
        chosen = min(upcoming, key=lambda i: _exam_date(i))
    else:
        chosen = max(items, key=lambda i: (str(i.get("implYy") or ""), str(i.get("implSeq") or "")))
    return _to_schedule_dict(chosen)


def build_certification_docs(
    master_items: list[dict[str, str]],
    schedule_items: list[dict[str, Any]],
    *,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """마스터(종목 목록)를 spine으로 시험일정을 jmCd로 join하고, 저장용 문서를 만든다."""
    today = today or date.today()

    by_jmcd: dict[str, list[dict[str, Any]]] = {}
    for s in schedule_items:
        jm_cd = s.get("jmCd")
        if jm_cd:
            by_jmcd.setdefault(jm_cd, []).append(s)

    docs: list[dict[str, Any]] = []
    for m in master_items:
        jmcd = m.get("jmcd", "")
        qual_gb = m.get("qualgbcd", "")
        name = m.get("jmfldnm", "")
        docs.append(
            {
                "jmcd": jmcd,
                "name": name,
                "name_norm": normalize_cert_name(name),
                "qual_gb": qual_gb,
                "qual_gb_name": m.get("qualgbnm", ""),
                "series_name": m.get("seriesnm", ""),
                "oblig_field": m.get("obligfldnm", ""),
                "mid_oblig_field": m.get("mdobligfldnm", ""),
                "cert_class": _CERT_CLASS_BY_QUAL_GB.get(qual_gb, ""),
                "official_url": _OFFICIAL_URL_FALLBACK,
                "schedule": _pick_schedule(by_jmcd.get(jmcd, []), today),
                "source_type": "open_api",
                "source_url": JONGMOK_LIST_URL,
                # TODO(사용자): 공공누리 유형(1~4유형)을 데이터셋 페이지에서 확인해 채울 것.
                "source_license": "",
            }
        )
    return docs


# --- 얇은 네트워크 I/O (여기부터는 유닛 테스트 대상이 아님) ---------------------


def fetch_jongmok_list_xml(client: httpx.Client, service_key: str) -> str:
    """종목 목록 XML을 그대로 가져온다."""
    resp = client.get(JONGMOK_LIST_URL, params={"serviceKey": service_key})
    resp.raise_for_status()
    return resp.text


def fetch_exam_schedule_page(
    client: httpx.Client,
    service_key: str,
    *,
    impl_yy: str,
    page_no: int = 1,
    num_of_rows: int = 50,
    qualgb_cd: str | None = None,
    jm_cd: str | None = None,
) -> dict[str, Any]:
    """시험일정 API를 1페이지 호출한다. totalCount로 페이지네이션은 호출부가 반복한다.

    numOfRows 기본값 50 - 이 API는 페이지당 최대 50건만 허용한다(2026-09 라이브
    검증 - 100을 넘기면 header.resultCode="930"과 함께 body 자체가 없는 응답이
    와서 items가 조용히 0건이 된다, 예외가 아니라 그냥 빈 리스트로 보이는
    함정이었다).
    """
    params: dict[str, Any] = {
        "serviceKey": service_key,
        "numOfRows": num_of_rows,
        "pageNo": page_no,
        "dataFormat": "json",
        "implYy": impl_yy,
    }
    if qualgb_cd:
        params["qualgbCd"] = qualgb_cd
    if jm_cd:
        params["jmCd"] = jm_cd
    resp = client.get(EXAM_SCHEDULE_URL, params=params)
    resp.raise_for_status()
    return resp.json()


def fetch_all_exam_schedule(
    client: httpx.Client, service_key: str, *, impl_yy: str, num_of_rows: int = 50
) -> list[dict[str, Any]]:
    """implYy 한 해 전체 시험일정을 페이지네이션해 모두 가져온다."""
    all_items: list[dict[str, Any]] = []
    page_no = 1
    while True:
        raw = fetch_exam_schedule_page(
            client, service_key, impl_yy=impl_yy, page_no=page_no, num_of_rows=num_of_rows
        )
        items = parse_exam_schedule_json(raw)
        all_items.extend(items)
        total_count = raw.get("body", {}).get("totalCount", 0)
        if len(all_items) >= total_count or not items:
            break
        page_no += 1
    return all_items
