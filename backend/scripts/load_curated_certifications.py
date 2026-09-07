"""큐레이션 자격증(app/etl/seeds/certifications_curated.json)을 Firestore
certifications/career_paths 컬렉션에 적재한다 (Phase 3 로더).

## 설계

순수 함수(assert_reviewed, build_qnet_index, build_cert_doc, build_career_path_docs)와
네트워크/Firestore I/O(fetch_qnet_docs, main)를 분리했다 - app/etl/certifications.py와
동일한 패턴. 순수 함수만 유닛 테스트 대상이다(tests/test_cert_loader.py).

국가자격(scope=domestic_national)만 Q-Net 종목 목록으로 보강한다: curated의
name_norm으로 Q-Net 종목명(name_norm 기준)과 매칭해 jmcd·시험일정을 붙인다.
매칭에는 app.etl.certifications.build_certification_docs를 그대로 재사용한다
(종목목록+시험일정 join, cert_class 매핑, 시험일정 회차 선택 로직을 다시
구현하지 않기 위함) - 그 결과를 name_norm으로 인덱싱해 curated 쪽에서 조회만
한다. 민간(domestic_private)/국제(international) 자격은 API가 없으므로 curated
필드를 그대로 쓴다.

## 안전 규칙 (이 세션 하드 요구사항)

기본은 dry-run이다 - `--commit`을 명시적으로 줘야만 실제로 Firestore에 쓴다.
이 세션에서는 `--commit`을 절대 넘기지 않는다(운영/에뮬레이터 데이터 오염 방지).
Q-Net 두 API 호출(읽기 전용)은 dry-run에서도 실행된다 - 매칭률을 실측하려면
실제 API 응답이 필요하기 때문이다. 네트워크 호출 전에 sources.yml 게이트를
통과해야 한다(assert_source_allowed) - refresh_certifications.py와 동일.

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/load_curated_certifications.py             # dry-run (기본)
    python scripts/load_curated_certifications.py --dry-run   # 명시적 동의어
    python scripts/load_curated_certifications.py --commit    # 실제 upsert (이 세션 금지)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from google.cloud import firestore  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.etl.certifications import (  # noqa: E402
    build_certification_docs,
    fetch_all_exam_schedule,
    fetch_jongmok_list_xml,
    parse_jongmok_list_xml,
)
from app.etl.sources import SourceGateError, assert_source_allowed  # noqa: E402
from app.firestore.certification_repo import (  # noqa: E402
    upsert_career_paths,
    upsert_certifications,
)
from app.firestore.client import get_firestore_client  # noqa: E402
from app.services.cert_match import normalize_cert_name  # noqa: E402

CURATED_PATH = (
    Path(__file__).resolve().parents[1] / "app" / "etl" / "seeds" / "certifications_curated.json"
)


def assert_reviewed(data: dict[str, Any]) -> None:
    """reviewed:true가 아니면 즉시 실패한다 - 미검수 데이터 적재를 막는 보안 게이트."""
    if data.get("reviewed") is not True:
        raise ValueError(
            "certifications_curated.json이 reviewed=true가 아닙니다 - "
            "검수 완료 전 데이터는 적재할 수 없습니다."
        )


def build_qnet_index(qnet_docs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """build_certification_docs() 결과를 name_norm -> doc으로 인덱싱한다."""
    return {d["name_norm"]: d for d in qnet_docs}


def build_search_terms_index(
    career_cert_map: dict[str, list[dict[str, Any]]],
) -> dict[str, list[str]]:
    """career_cert_map(진로명 -> [{name,tier}])을 뒤집어 cert name_norm -> 진로명 목록으로 만든다.

    app/api/certifications.py의 검색이 자격명뿐 아니라 그 자격이 속한 진로/
    분야명("증권", "반도체" 등)으로도 걸리게 하기 위한 내부 필드(search_terms)의
    소스. 정렬 + 중복 제거해 반환한다(한 자격이 여러 진로에 걸릴 수 있으므로).
    """
    index: dict[str, set[str]] = {}
    for career_name, cert_refs in career_cert_map.items():
        for ref in cert_refs:
            key = normalize_cert_name(ref["name"])
            index.setdefault(key, set()).add(career_name)
    return {name_norm: sorted(career_names) for name_norm, career_names in index.items()}


def doc_id_for(jmcd: str, name_norm: str) -> str:
    """Firestore 문서 id: jmcd가 있으면 그대로, 없으면 name_norm 슬러그(민간/국제 자격)."""
    return jmcd or f"cert-{name_norm}"


def build_cert_doc(
    cert: dict[str, Any],
    qnet_index: dict[str, dict[str, Any]],
    search_terms_index: dict[str, list[str]] | None = None,
) -> tuple[dict[str, Any], bool]:
    """curated 자격증 1건 -> Firestore 저장용 doc. (doc, unmatched) 반환.

    unmatched=True는 "국가자격인데 Q-Net 종목 목록에서 못 찾음"만 뜻한다(운영자
    보고용) - 민간/국제 자격은 애초에 매칭 대상이 아니므로 항상 False.

    search_terms_index는 build_search_terms_index() 결과 - 없으면(테스트 등)
    빈 목록으로 채운다.
    """
    match = qnet_index.get(cert["name_norm"]) if cert["scope"] == "domestic_national" else None
    jmcd = match["jmcd"] if match else ""
    # 공식 URL: curated 쪽에 이미 구체적인 값이 있으면 우선하고(예: 협회 공식
    # 사이트), curated가 비어 있을 때만 Q-Net 파생 값(대개 대문 fallback)으로
    # 채운다 - curated가 더 정밀한 링크를 갖고 있는 경우가 많기 때문이다.
    official_url = cert.get("official_url") or (match["official_url"] if match else "")
    doc = {
        "jmcd": jmcd,
        "name": cert["name"],
        "name_norm": cert["name_norm"],
        "issuer": cert["issuer"],
        "scope": cert["scope"],
        "cert_class": cert["cert_class"],
        "tier": cert["tier"],
        "official_url": official_url,
        "schedule": match["schedule"] if match else None,
        "source_type": "open_api" if match else "curated",
        "doc_id": doc_id_for(jmcd, cert["name_norm"]),
        "search_terms": (search_terms_index or {}).get(cert["name_norm"], []),
    }
    unmatched = cert["scope"] == "domestic_national" and match is None
    return doc, unmatched


def build_career_path_docs(
    career_cert_map: dict[str, list[dict[str, Any]]],
    cert_docs_by_name: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """career_cert_map(진로명 -> [{name,tier}]) -> career_paths/{slug} 문서 리스트.

    각 진로의 자격증 항목에 cert_id(certifications 문서 id)를 붙여, 프론트가
    /api/certifications/by-career 응답만으로 자격증 상세를 바로 조회할 수 있게
    한다 - cert_light_paths(표준 자격증 없는 진로)는 이 맵에 없으므로 여기서
    다루지 않는다(YAGNI - 요청 범위 밖).
    """
    docs: list[dict[str, Any]] = []
    for career_name, cert_refs in career_cert_map.items():
        certs = [
            {
                "name": ref["name"],
                "tier": ref.get("tier", ""),
                "cert_id": cert_docs_by_name[ref["name"]]["doc_id"]
                if ref["name"] in cert_docs_by_name
                else "",
            }
            for ref in cert_refs
        ]
        docs.append({"slug": normalize_cert_name(career_name), "name": career_name, "certs": certs})
    return docs


# --- 네트워크 I/O (여기부터는 유닛 테스트 대상이 아님) -------------------------


def fetch_qnet_docs(settings: Any) -> list[dict[str, Any]]:
    """Q-Net 종목목록+시험일정을 가져와 build_certification_docs로 join한다."""
    assert_source_allowed("data_go_kr_15003024_jongmok_list", for_llm=False)
    assert_source_allowed("data_go_kr_15074408_exam_schedule", for_llm=False)

    this_year = str(datetime.now().year)
    next_year = str(datetime.now().year + 1)

    with httpx.Client(timeout=30.0) as client:
        xml_text = fetch_jongmok_list_xml(client, settings.data_go_kr_api_key)
        master_items = parse_jongmok_list_xml(xml_text)
        print(f"Q-Net 종목 목록 {len(master_items)}건 수신")

        schedule_items: list[dict[str, Any]] = []
        for yy in (this_year, next_year):
            try:
                items = fetch_all_exam_schedule(client, settings.data_go_kr_service_key, impl_yy=yy)
                schedule_items.extend(items)
                print(f"{yy}년 시험일정 {len(items)}건 수신")
            except httpx.HTTPError as exc:
                print(f"경고: {yy}년 시험일정 호출 실패({exc}) - 해당 연도 없이 계속 진행")

    return build_certification_docs(master_items, schedule_items)


def _resolve_commit_client(project: str | None) -> Any:
    """--commit 시 쓸 Firestore 클라이언트를 고른다.

    --project를 주면 운영 경로다: 로컬 gcloud 세션의 GCLOUD_ACCESS_TOKEN으로
    인증해 그 프로젝트에 직접 쓴다(backfill_profile_embeddings.py와 동일 패턴 -
    서비스 계정 키 파일 없이, 사용자 자신의 gcloud 토큰만 사용). 실수로 운영에
    쓰지 않도록 project는 폴백 기본값이 없고, 에뮬레이터 host가 켜진 채로
    운영 프로젝트를 지정하면 즉시 거부한다.

    --project가 없으면 get_firestore_client()로 폴백한다(에뮬레이터/데모).
    """
    if project is None:
        return get_firestore_client()
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        raise SystemExit(
            "ERROR: FIRESTORE_EMULATOR_HOST가 켜진 채로 --project를 줬습니다. "
            "운영 적재 시에는 에뮬레이터 host를 끄고 실행하세요."
        )
    token = os.environ.get("GCLOUD_ACCESS_TOKEN")
    if not token:
        raise SystemExit(
            "ERROR: GCLOUD_ACCESS_TOKEN이 없습니다. "
            "export GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token) 후 재실행하세요."
        )
    credentials = Credentials(token=token).with_quota_project(project)
    return firestore.Client(project=project, credentials=credentials)


def main() -> None:
    parser = argparse.ArgumentParser(description="load curated certifications into Firestore")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="실제로 Firestore에 upsert한다. 없으면 dry-run(기본, 안전).",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="dry-run 명시(기본값과 동일, 문서화용)"
    )
    parser.add_argument(
        "--project",
        default=None,
        help=(
            "운영 Firestore 프로젝트 id(예: ourlab-0808). 주면 로컬 gcloud 세션의 "
            "GCLOUD_ACCESS_TOKEN으로 인증해 그 프로젝트에 쓴다(backfill 스크립트와 동일 "
            "패턴). 안 주면 get_firestore_client()로 폴백(에뮬레이터/데모)."
        ),
    )
    args = parser.parse_args()

    data = json.loads(CURATED_PATH.read_text(encoding="utf-8"))
    assert_reviewed(data)
    print(f"큐레이션 자격증 {len(data['certs'])}건 로드 (reviewed_at={data.get('reviewed_at')})")

    settings = get_settings()
    try:
        qnet_docs = fetch_qnet_docs(settings)
    except SourceGateError as exc:
        print(f"에러: 소스 게이트 실패 - {exc}")
        raise SystemExit(1) from exc
    qnet_index = build_qnet_index(qnet_docs)
    search_terms_index = build_search_terms_index(data.get("career_cert_map", {}))

    cert_docs: list[dict[str, Any]] = []
    cert_docs_by_name: dict[str, dict[str, Any]] = {}
    unmatched_names: list[str] = []
    for cert in data["certs"]:
        doc, unmatched = build_cert_doc(cert, qnet_index, search_terms_index)
        cert_docs.append(doc)
        cert_docs_by_name[cert["name"]] = doc
        if unmatched:
            unmatched_names.append(cert["name"])

    career_docs = build_career_path_docs(data.get("career_cert_map", {}), cert_docs_by_name)

    national_total = sum(1 for c in data["certs"] if c["scope"] == "domestic_national")
    matched = national_total - len(unmatched_names)
    print(
        f"\n국가자격 {national_total}건 중 Q-Net 매칭 {matched}건, 미매칭 {len(unmatched_names)}건"
    )
    if unmatched_names:
        print("미매칭 목록 (alias 추가 검토 필요):")
        for name in unmatched_names:
            print(f"  - {name}")

    if not args.commit:
        print(
            f"\n[dry-run] certifications {len(cert_docs)}건 / "
            f"career_paths {len(career_docs)}건 upsert 예정 - "
            "실제로 쓰려면 --commit을 넘기세요(이 세션에서는 사용 금지)."
        )
        return

    db = _resolve_commit_client(args.project)
    written_certs = upsert_certifications(db, cert_docs)
    written_careers = upsert_career_paths(db, career_docs)
    print(f"certifications {written_certs}건 / career_paths {written_careers}건 upsert 완료")


if __name__ == "__main__":
    main()
