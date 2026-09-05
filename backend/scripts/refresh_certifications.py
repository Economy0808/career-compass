"""국가자격 마스터(certifications 컬렉션) 갱신 배치 (운영자용).

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/refresh_certifications.py

DATA_GO_KR_SERVICE_KEY가 .env에 있어야 한다. Firestore Admin SDK를 통해
certifications/{jmcd}를 upsert한다 - 이 스크립트를 이 세션에서 실행하지 말 것
(에뮬레이터/운영 데이터 오염 방지, 작업 브리핑의 하드 안전 규칙).

Firestore Admin SDK는 동기(sync) 클라이언트이고 시험일정 API 호출도 가벼우므로
asyncio 없이 동기로 작성했다(refresh_job_research.py와 달리 async SQLAlchemy
엔진에 얽혀 있지 않음).
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.etl.certifications import (  # noqa: E402
    build_certification_docs,
    fetch_all_exam_schedule,
    fetch_jongmok_list_xml,
    parse_jongmok_list_xml,
)
from app.etl.sources import SourceGateError, assert_source_allowed  # noqa: E402
from app.firestore.certification_repo import upsert_certifications  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="refresh certifications master")
    parser.parse_args()

    settings = get_settings()
    if not settings.data_go_kr_service_key:
        print("에러: DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.")
        raise SystemExit(1)

    # 네트워크 호출 전에 출처 레지스트리 게이트를 통과해야 한다(보안 하드
    # 게이트) - sources.yml의 kogl_type이 미확인/2/4유형이면 여기서 즉시
    # 실패하고, Q-Net API 요청은 한 건도 나가지 않는다.
    try:
        assert_source_allowed("data_go_kr_15003024_jongmok_list", for_llm=False)
        assert_source_allowed("data_go_kr_15074408_exam_schedule", for_llm=False)
    except SourceGateError as exc:
        print(f"에러: 소스 게이트 실패 - {exc}")
        raise SystemExit(1) from exc

    this_year = str(datetime.now().year)
    next_year = str(datetime.now().year + 1)

    with httpx.Client(timeout=30.0) as client:
        xml_text = fetch_jongmok_list_xml(client, settings.data_go_kr_service_key)
        master_items = parse_jongmok_list_xml(xml_text)
        print(f"종목 목록 {len(master_items)}건 수신")

        schedule_items = []
        for yy in (this_year, next_year):
            try:
                items = fetch_all_exam_schedule(client, settings.data_go_kr_service_key, impl_yy=yy)
                schedule_items.extend(items)
                print(f"{yy}년 시험일정 {len(items)}건 수신")
            except httpx.HTTPError as exc:
                # 시험일정은 없어도 마스터 적재 자체는 계속 진행한다 (브리핑 지시).
                print(f"경고: {yy}년 시험일정 호출 실패({exc}) - 해당 연도 없이 계속 진행")

    docs = build_certification_docs(master_items, schedule_items)
    db = get_firestore_client()
    written = upsert_certifications(db, docs)
    print(f"certifications {written}건 upsert 완료")


if __name__ == "__main__":
    main()
