"""인테이크(intake) 화면의 "원소 보관함(bin)" 전체 세트를 만드는 오케스트레이션.

목표 텍스트 하나로 다음 두 갈래를 동시에 돌려 합친다:
1. 수업 군집 (course_clustering.suggest_course_bin) — Firestore course_catalog로
   그라운딩된 과목 추천.
2. 비교과 준비 요소 군집 (llm.suggest_support_elements) — 자격증/학회/대외활동/
   네트워킹 등 고정 카탈로그가 없는 AI 제안.

두 갈래는 서로 의존하지 않으므로 asyncio.gather로 동시에 실행한다 — 이 함수는
job 워커의 백그라운드 asyncio 태스크 안에서 돌 것이므로, 순차 실행으로 왕복
지연을 두 번 감수할 이유가 없다.

## 결과 dict 계약 (frontend/components/ElementBinPanel.tsx의 Bin/BinItem과 정렬)

라우터가 이 함수의 반환값을 그대로 job 결과 저장소에 verbatim으로 저장하므로,
여기서 만드는 dict 모양이 곧 API 응답 계약이다.

    {"bins": [
        {"id": "<uuid4>", "label": str, "origin": "llm" | "user", "advice": str,  # 없으면 키 자체를 생략
         "items": [
            {"id": str, "label": str, "type": str,
             "level": int,       # 있을 때만
             "subtitle": str,    # 있을 때만
             "description": str, # 있을 때만
             "department": str,  # 있을 때만(수업만 - support 아이템엔 없음)
            }, ...
         ]}, ...
    ],
     "drafts": [
        {"name": str, "tagline": str,
         "coreBinLabels": [str, ...],     # 반드시 위 bins의 label 중에서만 (2~4개, 방어 후 0개면 초안 자체를 버림)
         "binEdges": [[str, str], ...]},  # bins label 사이의 학습 경로 쌍
        ...  # 목표가 뚜렷하면 최대 3개, bins가 너무 작으면 그보다 적거나 빈 리스트
     ]}

### drafts (성단 전체 배치 초안)

유저가 고를 3개의 초안 - "우주 확대" 보드(board 4)의 설계. 시안은 항목을
발췌하지 않는다: bins는 항상 전부(full load) 표시되고, drafts는 그 위에서
안별로 강조할 핵심 군집(coreBinLabels)과 군집 간 학습 경로(binEdges)만 다르게
제시한다. bins가 다 만들어진 뒤에 llm.suggest_draft_constellations(goal_text,
bins)를 호출해 실제 bin label로만 구성하게 한다(환각 방지: 카탈로그 없는 자유
생성이라 코드 검증이 불가능한 support 요소와 달리, 여기서는 bins라는 카탈로그가
있으므로 cluster_courses와 같은 결의 검증이 가능하고 반드시 해야 한다). LLM
클라이언트 구현체가 이미 한 번 걸러내지만, 이 함수에서도 값싼 set 검사로 한 번
더 방어한다(defense in depth) - label 재사용 실수나 향후 구현체 버그가 프론트
까지 새어나가지 않도록.

값이 None인 키는 아예 생략한다 — 프론트가 "키 없음"과 "null"을 구분하지 않고
`item.level`처럼 optional-chaining 없이 접근하는 곳이 있어, undefined(키 없음)
쪽이 더 안전하다.

### label 포맷 (수업)

`f"{code} {name}"` — frontend의 ElementBinPanel.splitCourseCode가
`/^([A-Z]{2,6}\\d{3,5})\\s+(.+)$/` 정규식으로 라벨 앞부분의 학정번호를 뜯어내
칩 위쪽에 코드만, 아래쪽에 과목명만 보여주는 구조이기 때문이다. 코드 없이
과목명만 주면 그 UI가 그냥 코드 없는 과목으로 처리한다(깨지지 않지만 코드가
드러나지 않음) — 실제 카탈로그 과목은 항상 code가 있으므로 여기서는 항상 붙인다.

### level 스케일 (수업)

ClusteredCourseView.level은 "학정번호 첫 자리"(1~4)만 담고 있다(course_clustering.py
docstring 참조). 반면 frontend는 INITIAL_BINS 데모 데이터와 ElementBinPanel.groupByLevel
모두 level을 1000/2000/3000/4000 같은 "천 단위" 값으로 다루고
(`Math.floor(item.level / 1000) * 1000`로 학년 tier를 묶는다), ConstellationCanvas
쪽 노드도 같은 스케일(예: level: 1000)을 쓴다. 그래서 여기서 서비스가 내는
level(1~4)에 1000을 곱해 프론트 스케일로 맞춘다.

### 비교과 요소(support)

SupportElement에는 code 같은 카탈로그 식별자가 없으므로(고정 카탈로그가 없어
환각 방어 자체가 불가능 — base.py의 SupportElement 독스트링 참조) id는
`support:{uuid4()}`로 발급한다. label은 그대로 사용한다(코드 접두사가 없으므로
splitCourseCode는 그냥 전체를 rest로 돌려주고 code는 None이 된다 — 정상 동작).

type이 certification인 항목만 예외로, LLM 프롬프트에 카탈로그를 주입하지 않는
대신(RAG 아님) 생성된 라벨을 certifications 마스터와 사후 대조한다(post-filter
그라운딩 — `_cert_badge_fields` 참고). 매칭되면 verified/official_url/schedule/
cert_class를 서버 DB 값으로만 덧붙이고, 전문직 라이선스(변호사·공인회계사 등)는
매칭 여부와 무관하게 cert_class="professional_license"를 강제하며 보관함 안에서
대표(첫) 자리가 아니라 뒤로 재정렬된다(`_reorder_professional_licenses`).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from google.cloud.firestore import Client

from app.firestore import certification_repo
from app.llm.academic_rules import ACADEMIC_RULES_DIGEST
from app.llm.base import DraftConstellation, LLMClient, SupportBin, SupportElement
from app.services.cert_match import is_professional_license, normalize_cert_name
from app.services.course_clustering import (
    ClusteredCourseView,
    CourseClusterView,
    suggest_course_bin,
)

# 학정번호 첫 자리(1~4) -> frontend가 쓰는 "천 단위" level 스케일로 변환하는 배수.
# course_clustering.ClusteredCourseView.level과 frontend/components/ElementBinPanel.tsx의
# groupByLevel 사이의 단위 불일치를 여기(경계)에서 한 번만 보정한다.
_LEVEL_SCALE = 1000


def _course_item(course: ClusteredCourseView) -> dict[str, Any]:
    """ClusteredCourseView 한 건을 wire-ready BinItem dict로 변환한다."""
    item: dict[str, Any] = {
        "id": f"course:{course.code}",
        # code를 라벨 맨 앞에 붙인다 — frontend splitCourseCode가 이 포맷을 전제로
        # 칩 상단(코드)/하단(과목명)을 분리해 보여준다.
        "label": f"{course.code} {course.name}",
        "type": "course",
    }
    if course.level is not None:
        item["level"] = course.level * _LEVEL_SCALE
    if course.reason:
        item["subtitle"] = course.reason
    # course_clustering.ClusteredCourseView에는 과목 설명 필드가 없다(카탈로그의
    # description은 군집화 입력(CourseOption)에서만 쓰이고 출력엔 안 흘러나온다) —
    # 그래서 description 키는 애초에 만들지 않는다(= 생략, null 아님).
    if course.department:
        # 학과별 bin이 프론트에서 "추천 수업" 하나로 병합돼도 아이템이 자기 소속을
        # 들고 다니게 한다(2026-08-30) - key는 "department"로 snake_case와
        # camelCase가 동일한 한 단어라 별도 변환이 필요 없다.
        item["department"] = course.department
    return item


def _course_bin(cluster: CourseClusterView) -> dict[str, Any]:
    """CourseClusterView 한 건(=군집 하나)을 wire-ready Bin dict로 변환한다."""
    bin_dict: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "label": cluster.name,
        "origin": "llm",
        "items": [_course_item(c) for c in cluster.courses],
    }
    if cluster.advice is not None:
        bin_dict["advice"] = cluster.advice
    return bin_dict


def _cert_badge_fields(db: Client, label: str) -> dict[str, Any]:
    """자격증 라벨을 certifications 마스터와 대조해 서버 신뢰 배지 필드를 만든다.

    post-filter 검증이다(RAG 아님) - 카탈로그를 프롬프트에 넣지 않고, LLM이 이미
    낸 라벨을 사후에 마스터와 대조만 한다. verified=False가 정상 경로다(마스터가
    전체 국가자격을 커버하지 않으므로) - 재질의하지 않고 그대로 미검증 표시한다.

    url/schedule/cert_class는 전부 이 DB 레코드 값만 쓴다 - LLM이 뭘 냈든(설령
    SupportElement.url에 뭔가 들어있어도) 절대 참조하지 않는다. 프론트가 이
    배지를 "공식 확인됨"으로 렌더링하므로 서버 권위가 깨지면 안 되는 보안 요구
    사항이다.

    # ponytail: 자격증 요소마다 단건 조회라 요청 하나에 N개면 Firestore 왕복
    # N번. list_all()을 name_norm 인덱스로 TTL 캐시해 한 번에 끝내도록 올릴 것 -
    # 요청당 자격증 요소가 수십 개로 늘어나 체감 지연이 생기면.
    """
    record = certification_repo.get_by_name_norm(db, normalize_cert_name(label))
    fields: dict[str, Any] = {"verified": record is not None}
    if record is not None:
        for key in ("official_url", "schedule", "cert_class"):
            # truthy 체크 - cert_class는 ETL에서 미분류 시 ""(빈 문자열)로 채워지므로
            # None만 걸러서는 빈 값이 그대로 새어나간다(프로젝트 관례: 값 없으면 키 생략).
            if record.get(key):
                fields[key] = record[key]
    if is_professional_license(label):
        # 전문직 라이선스는 마스터 매칭 실패해도 무게감 태그는 강제한다.
        fields["cert_class"] = "professional_license"
    return fields


def _support_item(element: SupportElement, db: Client) -> dict[str, Any]:
    """SupportElement 한 건을 wire-ready BinItem dict로 변환한다.

    type이 certification이면 _cert_badge_fields로 서버 그라운딩 배지를 덧붙인다
    (element.url은 여기서도 절대 읽지 않는다 - base.py의 SupportElement.url
    독스트링 참고).
    """
    item: dict[str, Any] = {
        "id": f"support:{uuid.uuid4()}",
        "label": element.label,
        "type": element.type,
    }
    if element.subtitle is not None:
        item["subtitle"] = element.subtitle
    if element.description is not None:
        item["description"] = element.description
    if element.type == "certification":
        item.update(_cert_badge_fields(db, element.label))
    return item


def _reorder_professional_licenses(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """전문직 라이선스 자격증이 보관함의 대표(첫) 추천이 되지 않도록 뒤로 미룬다.

    병기는 허용, 단독/대표 추천만 금지 - 그래서 제거가 아니라 재정렬이다. sorted()는
    안정 정렬이라 전문직/비전문직 각 그룹 내부의 상대 순서는 그대로 유지된다.
    """
    return sorted(items, key=lambda item: item.get("cert_class") == "professional_license")


def _support_bin(bin_view: SupportBin, db: Client) -> dict[str, Any]:
    """SupportBin 한 건(=비교과 군집 하나)을 wire-ready Bin dict로 변환한다."""
    items = [_support_item(e, db) for e in bin_view.elements]
    bin_dict: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "label": bin_view.name,
        "origin": "llm",
        "items": _reorder_professional_licenses(items),
    }
    if bin_view.advice is not None:
        bin_dict["advice"] = bin_view.advice
    return bin_dict


def _draft_dict(draft: DraftConstellation, known_labels: set[str]) -> dict[str, Any] | None:
    """DraftConstellation을 wire-ready dict로 변환한다.

    LLM 클라이언트 구현체(anthropic_client/mock_client)가 이미 bins에 없는
    label/edge를 걸러내지만, 여기서 한 번 더 known_labels로 교차 검증한다(값싼
    set 연산이라 비용이 거의 없다) - defense in depth. 방어 후 core가 0개로
    줄면 초안 자체가 의미 없으므로 None을 돌려줘 호출부에서 버리게 한다.
    """
    core_bin_labels = [label for label in draft.core_bin_labels if label in known_labels]
    bin_edges = [
        (a, b) for a, b in draft.bin_edges if a in known_labels and b in known_labels and a != b
    ]
    if not core_bin_labels:
        return None
    return {
        "name": draft.name,
        "tagline": draft.tagline,
        "coreBinLabels": core_bin_labels,
        "binEdges": [list(e) for e in bin_edges],
    }


async def suggest_all_bins(db: Client, llm: LLMClient, goal_text: str) -> dict[str, Any]:
    """목표 텍스트 하나로 수업 군집 + 비교과 군집 전체 세트를 만든다.

    두 파이프라인(수업/비교과)은 서로 입력을 공유하지 않으므로 asyncio.gather로
    동시에 실행한다. suggest_course_bin 내부의 Firestore 조회는 이미
    asyncio.to_thread로 감싸져 있어(course_clustering.py 참조) 이 gather 병렬
    실행 중에도 이벤트 루프를 막지 않는다.

    목표가 애매해 학과/비교과 어느 쪽도 못 찾으면 그 갈래는 그냥 빈 리스트를
    내고, 전체 결과도 {"bins": [], "drafts": []}가 될 수 있다 — 예외를 던지지
    않는다(course_clustering의 "확신 없으면 빈 결과" 계약을 그대로 유지).
    bins가 비면 애초에 골라 담을 항목이 없으므로 suggest_draft_constellations
    호출 자체를 건너뛴다.
    """
    course_task = suggest_course_bin(db, llm, goal_text, rules_context=ACADEMIC_RULES_DIGEST)
    support_task = llm.suggest_support_elements(goal_text, rules_context=ACADEMIC_RULES_DIGEST)
    course_result, support_result = await asyncio.gather(course_task, support_task)

    bins: list[dict[str, Any]] = [_course_bin(cluster) for cluster in course_result.clusters]
    bins.extend(_support_bin(bin_view, db) for bin_view in support_result.bins)

    # 별자리 초안은 bins가 다 만들어진 뒤에만 의미가 있다(고를 항목 자체가 없으면
    # LLM을 부를 이유가 없다) - 그래서 위 gather와 묶지 않고 순차로 이어 붙인다.
    drafts: list[dict[str, Any]] = []
    if bins:
        known_labels = {b["label"] for b in bins}
        draft_result = await llm.suggest_draft_constellations(goal_text, bins)
        drafts = [
            wire
            for raw in draft_result.drafts
            if (wire := _draft_dict(raw, known_labels)) is not None
        ]
    return {"bins": bins, "drafts": drafts}


async def fill_single_bin(
    db: Client, llm: LLMClient, goal_text: str, bin_label: str
) -> dict[str, Any]:
    """사용자가 직접 만든 보관함 하나를 LLM 제안으로 채운다.

    tradeoff(정직하게 문서화): LLMClient 프로토콜에는 "보관함 하나만 채우는"
    전용 메서드가 없다(이번 세션 범위에서 새 프로토콜 메서드를 추가하지 않기로
    함). 그래서 suggest_support_elements를 재사용하되, goal_text 뒤에 보관함
    라벨을 덧붙여 그 주제로 스코프를 좁힌 프롬프트를 만들고, 반환된 여러
    SupportBin의 원소를 전부 하나의 보관함으로 합친다. 이 방식은:
      - 정확함: 실제 LLM이 이 스코프 텍스트를 보고 관련 없는 걸 섞어 낼 수도
        있다(예: 자격증 보관함인데 학회를 얹어줄 수 있음) — 전용 메서드였다면
        방지 가능했을 결함.
      - 실용적임: 지금 당장은 새 프로토콜/AnthropicClaudeClient 메서드 추가
        없이도 "사용자가 만든 보관함이 비어있지 않게" 만드는 최소 구현이다.
    advice는 반환된 첫 SupportBin의 것을 그대로 쓴다(여러 bin이 섞여 나와도
    보관함 하나에는 advice가 하나만 있어야 하므로) — bins가 비면 advice 키
    자체를 생략한다.

    db는 자격증 그라운딩(post-filter 배지 매칭)에 쓰인다 - _support_item이
    type == certification인 항목마다 certifications 마스터를 조회한다.
    """
    scoped_goal = f"{goal_text} — '{bin_label}' 주제만"
    result = await llm.suggest_support_elements(scoped_goal, rules_context=ACADEMIC_RULES_DIGEST)

    items = [
        _support_item(element, db) for bin_view in result.bins for element in bin_view.elements
    ]
    bin_dict: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "label": bin_label,
        "origin": "user",
        "items": _reorder_professional_licenses(items),
    }
    if result.bins and result.bins[0].advice is not None:
        bin_dict["advice"] = result.bins[0].advice
    return bin_dict
