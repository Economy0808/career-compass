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

from google.cloud.firestore import Client
from google.cloud.firestore_v1.base_query import FieldFilter

from app.etl.yonsei_courses import MergedCourse

_COLLECTION = "course_catalog"

# Firestore가 한 배치(WriteBatch)에 허용하는 최대 오퍼레이션 수.
_BATCH_LIMIT = 500

# list_taxonomy 모듈 레벨 캐시 - 프로세스당 1회만 전체 스캔한다(7,109개 문서 기준
# 수 초 소요). ponytail: 카탈로그가 갱신돼도 프로세스 재시작 전까지는 새 학과/단과대가
# 안 보인다 - 지금 규모에서는 무해한 트레이드오프. 문서 수가 수십만으로 커지면 이
# 전체 스캔 대신 학과/단과대 목록을 담은 별도 메타 문서로 승격할 것.
_taxonomy_cache: tuple[list[str], list[str]] | None = None


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
            departments.add(dept)
        if college:
            colleges.add(college)
    _taxonomy_cache = (sorted(departments), sorted(colleges))
    return _taxonomy_cache
