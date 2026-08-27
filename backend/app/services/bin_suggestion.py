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
            }, ...
         ]}, ...
    ]}

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
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from google.cloud.firestore import Client

from app.llm.academic_rules import ACADEMIC_RULES_DIGEST
from app.llm.base import LLMClient, SupportBin, SupportElement
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


def _support_item(element: SupportElement) -> dict[str, Any]:
    """SupportElement 한 건을 wire-ready BinItem dict로 변환한다."""
    item: dict[str, Any] = {
        "id": f"support:{uuid.uuid4()}",
        "label": element.label,
        "type": element.type,
    }
    if element.subtitle is not None:
        item["subtitle"] = element.subtitle
    if element.description is not None:
        item["description"] = element.description
    return item


def _support_bin(bin_view: SupportBin) -> dict[str, Any]:
    """SupportBin 한 건(=비교과 군집 하나)을 wire-ready Bin dict로 변환한다."""
    bin_dict: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "label": bin_view.name,
        "origin": "llm",
        "items": [_support_item(e) for e in bin_view.elements],
    }
    if bin_view.advice is not None:
        bin_dict["advice"] = bin_view.advice
    return bin_dict


async def suggest_all_bins(db: Client, llm: LLMClient, goal_text: str) -> dict[str, Any]:
    """목표 텍스트 하나로 수업 군집 + 비교과 군집 전체 세트를 만든다.

    두 파이프라인(수업/비교과)은 서로 입력을 공유하지 않으므로 asyncio.gather로
    동시에 실행한다. suggest_course_bin 내부의 Firestore 조회는 이미
    asyncio.to_thread로 감싸져 있어(course_clustering.py 참조) 이 gather 병렬
    실행 중에도 이벤트 루프를 막지 않는다.

    목표가 애매해 학과/비교과 어느 쪽도 못 찾으면 그 갈래는 그냥 빈 리스트를
    내고, 전체 결과도 {"bins": []}가 될 수 있다 — 예외를 던지지 않는다
    (course_clustering의 "확신 없으면 빈 결과" 계약을 그대로 유지).
    """
    course_task = suggest_course_bin(db, llm, goal_text, rules_context=ACADEMIC_RULES_DIGEST)
    support_task = llm.suggest_support_elements(goal_text, rules_context=ACADEMIC_RULES_DIGEST)
    course_result, support_result = await asyncio.gather(course_task, support_task)

    bins: list[dict[str, Any]] = [_course_bin(cluster) for cluster in course_result.clusters]
    bins.extend(_support_bin(bin_view) for bin_view in support_result.bins)
    return {"bins": bins}


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

    db는 현재 이 경로에서 쓰이지 않는다(수업이 아닌 비교과 제안만 하므로
    Firestore 조회가 필요 없다) — 그래도 시그니처에 포함해 두는 건 앞으로
    "이 보관함이 실은 수업 라벨이었다"처럼 카탈로그 조회가 필요해질 확장
    여지를 열어두기 위함이다(호출부 시그니처를 다시 바꾸지 않아도 되게).
    """
    del db  # 현재 미사용 — 위 독스트링 참고.
    scoped_goal = f"{goal_text} — '{bin_label}' 주제만"
    result = await llm.suggest_support_elements(scoped_goal, rules_context=ACADEMIC_RULES_DIGEST)

    items = [_support_item(element) for bin_view in result.bins for element in bin_view.elements]
    bin_dict: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "label": bin_label,
        "origin": "user",
        "items": items,
    }
    if result.bins and result.bins[0].advice is not None:
        bin_dict["advice"] = result.bins[0].advice
    return bin_dict
