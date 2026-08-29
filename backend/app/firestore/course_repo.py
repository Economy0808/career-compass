"""Firestore 기반 연세대 교과목 카탈로그 리포지토리.

## 컬렉션 레이아웃

`course_catalog/{courseCode}` - 평평한(flat) 컬렉션. 학정번호(code)는 대학
전체에서 유일하고 자연스러운 문서 id이므로, 로더를 재실행해도 같은 문서를
덮어쓸 뿐 중복이 생기지 않는다(멱등성).

firestore.rules의 기존 규칙은 `match /course_catalog/{deptCode}` 형태로
작성돼 있지만, 와일드카드 변수 이름(`deptCode`)은 규칙 매칭에 아무 영향이
없다 - 이 규칙은 course_catalog 바로 아래의 "모든 문서 id"에 매칭되므로,
평평한 course_catalog/{courseCode} 레이아웃과 그대로 호환된다(읽기: 로그인
사용자, 쓰기: 항상 거부 - Admin SDK만 쓴다). 그 아래 `courses/{courseCode}`
서브컬렉션 규칙은 이 로더가 서브컬렉션을 만들지 않으므로 단순히 쓰이지
않는다.

## 쓰기 경로

이 모듈이 문서를 쓰는 유일한 함수는 upsert_courses뿐이다 - Admin SDK가
firestore.rules를 완전히 우회하므로(모듈 constellation_repo.py와 동일한
이유), "코스 카탈로그는 백엔드 ETL만 쓴다"는 불변식은 여기 코드로만
지켜진다.
"""

from __future__ import annotations

import logging

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.etl.yonsei_courses import MergedCourse

logger = logging.getLogger(__name__)

_COLLECTION = "course_catalog"

# Firestore가 한 배치(WriteBatch)에 허용하는 최대 오퍼레이션 수.
_BATCH_LIMIT = 500

# list_taxonomy 스캔 결과가 이 값 미만이면 "정상적으로 비어있다"가 아니라 "에뮬레이터/DB가
# 아직 비어있는 순간에 스캔이 걸렸다"로 간주한다(캐시 오염 자가 치유 - 아래 참고).
_MIN_DEPARTMENTS_TO_CACHE = 3

# list_taxonomy 모듈 레벨 캐시 - 프로세스당 1회만 전체 스캔한다(7,109개 문서 기준
# 수 초 소요). ponytail: 카탈로그가 갱신돼도 프로세스 재시작 전까지는 새 학과/단과대가
# 안 보인다 - 지금 규모에서는 무해한 트레이드오프. 문서 수가 수십만으로 커지면 이
# 전체 스캔 대신 학과/단과대 목록을 담은 별도 메타 문서로 승격할 것.
#
# 캐시는 "정상적인" 스캔 결과만 담는다 - 빈 스캔(또는 학과가 극소수인 스캔)을 캐시에
# 담으면, 에뮬레이터가 막 재시작돼 아직 비어있는 순간에 첫 호출이 들어온 경우 그 빈
# 결과가 프로세스 재시작 전까지 영구화돼 이후 모든 과목 추천이 조용히 0개를 낸다
# (list_taxonomy -> select_relevant_departments -> cluster_courses 전체가 말라버림).
# 그래서 _MIN_DEPARTMENTS_TO_CACHE 미만이면 캐시에 저장하지 않고 다음 호출이 재스캔하게
# 둔다.
_taxonomy_cache: tuple[list[str], list[str]] | None = None


def _is_taxonomy_junk(value: str) -> bool:
    """department/college 필드에 파싱 불량으로 섞여든 문장형 텍스트인지 판단한다.

    근본 원인(app/etl/yonsei_courses.py 파서)은 건드리지 않고, 소비 지점인
    list_taxonomy에서만 방어한다. data/dept-check.txt의 실측 예시를 기준으로 잡은
    보수적인 휴리스틱 두 가지:

    1. "학과/전공" 리터럴이 섞여 있으면 무조건 쓰레기다 - "문과대학              학과/전공
       철학"처럼 단과대/학과 필드가 원본 표의 레이블 텍스트와 통째로 뭉개져 들어온
       파싱 아티팩트에서만 나타나는 패턴이라 정상 명칭과 절대 겹치지 않는다.
    2. 길이가 20자를 넘으면서 공백이 6개 이상이면(즉 7단어 이상) 과목 설명 문장일
       가능성이 매우 높다 - "Underwood International College"(공백 2개),
       "Political Science and International Relations"(공백 4개),
       "강원지역혁신플랫폼 스마트수소에너지융합전공"(공백 1개, 22자)처럼 실제로 긴
       정상 명칭들은 전부 공백 5개 이하였던 반면, 쓰레기 문장들은 최소 7개 단어
       이상이었다(dept-check.txt 실측).
    """
    if "학과/전공" in value:
        return True
    return len(value) > 20 and value.count(" ") >= 6


def _add_if_clean(values: set[str], value: str, field_name: str) -> None:
    """쓰레기가 아니면 집합에 추가하고, 걸러진 값은 debug로만 남긴다."""
    if _is_taxonomy_junk(value):
        logger.debug("list_taxonomy: 문장형 쓰레기로 걸러진 %s 값: %r", field_name, value)
        return
    values.add(value)


def _doc_id(course: MergedCourse) -> str:
    """학정번호(code)를 문서 id로 그대로 쓴다 - 대학 전체에서 유일하다."""
    return course.code


def upsert_courses(db: Client, courses: list[MergedCourse]) -> int:
    """교과목 리스트를 배치 쓰기로 upsert하고, 실제로 쓴 문서 수를 반환한다.

    Firestore 배치는 한 번에 최대 500개 오퍼레이션까지만 허용하므로, 500개
    단위로 잘라 여러 배치를 순차 커밋한다. 문서 id를 학정번호로 고정하고
    set()(merge 없이 전체 필드 교체)을 쓰므로, 같은 과목을 다시 upsert해도
    문서가 늘어나지 않고 필드 값만 최신 상태로 갱신된다(멱등성).
    """
    collection = db.collection(_COLLECTION)
    written = 0
    for start in range(0, len(courses), _BATCH_LIMIT):
        chunk = courses[start : start + _BATCH_LIMIT]
        batch = db.batch()
        for course in chunk:
            doc_ref = collection.document(_doc_id(course))
            batch.set(doc_ref, course.model_dump())
        batch.commit()
        written += len(chunk)
    return written


def get_course(db: Client, code: str) -> MergedCourse | None:
    """학정번호로 단일 과목을 조회한다. 없으면 None."""
    snapshot = db.collection(_COLLECTION).document(code).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict()
    assert data is not None
    return MergedCourse.model_validate(data)


def list_by_department(db: Client, department: str, limit: int = 100) -> list[MergedCourse]:
    """특정 학과(department)의 과목을 최대 limit개 반환한다."""
    query = (
        db.collection(_COLLECTION)
        .where(filter=FieldFilter("department", "==", department))
        .limit(limit)
    )
    return [MergedCourse.model_validate(doc.to_dict()) for doc in query.stream()]


def search_by_college(db: Client, college: str, limit: int = 100) -> list[MergedCourse]:
    """특정 단과대(college) 소속 과목을 최대 limit개 반환한다."""
    query = (
        db.collection(_COLLECTION).where(filter=FieldFilter("college", "==", college)).limit(limit)
    )
    return [MergedCourse.model_validate(doc.to_dict()) for doc in query.stream()]


def list_taxonomy(db: Client) -> tuple[list[str], list[str]]:
    """course_catalog에 실제로 존재하는 (학과 목록, 단과대 목록) 고유값을 정렬해 반환한다.

    select_relevant_departments가 이름을 "지어내는" 대신 실제 카탈로그 값 중에서만
    고르도록 어휘를 주입하기 위한 용도다. department/college 두 필드만
    projection(.select)으로 가져와 페이로드를 최소화한다.

    프로세스당 1회만 스캔하도록 모듈 레벨 캐시를 쓴다 - 위 _taxonomy_cache 주석 참고.
    """
    global _taxonomy_cache
    if _taxonomy_cache is not None:
        return _taxonomy_cache
    departments: set[str] = set()
    colleges: set[str] = set()
    for doc in db.collection(_COLLECTION).select(["department", "college"]).stream():
        data = doc.to_dict() or {}
        dept = data.get("department")
        college = data.get("college")
        if dept:
            _add_if_clean(departments, dept, "department")
        if college:
            _add_if_clean(colleges, college, "college")

    result = (sorted(departments), sorted(colleges))
    if len(departments) < _MIN_DEPARTMENTS_TO_CACHE:
        # 스캔이 비었거나 학과가 극소수다 - DB/에뮬레이터가 아직 안 채워진 순간에
        # 걸렸을 가능성이 높으므로 캐시에 담지 않고 다음 호출이 재스캔하게 둔다.
        # 이 함수의 결과는 select_relevant_departments -> cluster_courses로 그대로
        # 흘러가므로, 여기서 조용히 넘어가면 이후 추천 파이프라인 전체가 원인 불명으로
        # 0개를 내게 된다.
        logger.warning(
            "list_taxonomy: 스캔된 학과 수(%d)가 임계값(%d) 미만 - 캐시에 저장하지 않고"
            " 다음 호출에서 재스캔한다",
            len(departments),
            _MIN_DEPARTMENTS_TO_CACHE,
        )
        return result
    _taxonomy_cache = result
    return result
