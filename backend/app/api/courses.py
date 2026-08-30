"""과목 검색 API (prefix /api/courses).

사용자가 캔버스의 "기본 추천수업 군집"에 스스로 과목을 검색해 요소로 추가할 수
있게 하는 데이터 공급원이다(사용자 원문: "학정번호와 캠퍼스, 수업이름
검색필터로 스스로 검색해서 수업을 띄웠으면 좋겠어. 지금은 단순히 임의의 요소를
추가하는 거잖아"). 캠퍼스 필터는 이번 스코프에서 제외한다 - 대학요람 TXT
원천 데이터에 과목별 캠퍼스 컬럼이 없다(목차·복수전공 규정 문장에만 "캠퍼스"
단어가 등장할 뿐이다). 학과(department)/단과대(college) 필터로 대체한다.

인증은 get_current_user(로그인만)로 충분하다 - require_yonsei_verified를 걸지
않는다: 캔버스는 익명 유저도 혼자 실험할 수 있어야 한다는 게 사용자 지시의
취지이고, 과목 열람 자체는 남의 리소스를 건드리는 쓰기 행동이 아니다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from google.cloud.firestore import Client

from app.auth.deps import get_current_user
from app.auth.firebase_auth import DecodedToken
from app.etl.yonsei_courses import MergedCourse
from app.firestore import course_repo
from app.firestore.client import get_firestore_client
from app.schemas.courses import CourseSearchItem, CourseTaxonomyOut

router = APIRouter(prefix="/api/courses", tags=["courses"])

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 30


def _to_item(course: MergedCourse) -> CourseSearchItem:
    return CourseSearchItem(
        code=course.code,
        name=course.name,
        department=course.department,
        college=course.college,
        level=course.level,
        credits=course.credits,
        kind=course.kind,
        campus=course.campus,
    )


@router.get("/search", response_model=list[CourseSearchItem], response_model_exclude_none=True)
async def search_courses(
    q: str | None = Query(default=None, max_length=100),
    department: str | None = Query(default=None),
    college: str | None = Query(default=None),
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1),
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> list[CourseSearchItem]:
    """과목명 부분일치 또는 학정번호 접두/부분일치로 검색한다(전략은
    course_repo.search_courses 참고). q/department/college가 전부 비면 400을
    내는 대신 필터 없는 상위 limit개를 반환한다 - 프론트 캔버스가 검색어를 치기
    전에도 초기 화면이 빈 목록으로 뜨지 않게 하기 위함이다.

    limit은 기본 20, 30을 넘으면 422가 아니라 30으로 클램프한다(과도한 요청을
    막되 프론트가 상한을 매번 신경 쓰지 않아도 되도록). user는 로그인 여부
    게이트(get_current_user가 익명 요청을 401로 거른다) 용도일 뿐 값 자체는
    쓰지 않는다 - require_yonsei_verified와 달리 소유권 검사가 없다.
    """
    del user
    limit = min(limit, _MAX_LIMIT)
    courses = course_repo.search_courses(
        db, q=q, department=department, college=college, limit=limit
    )
    return [_to_item(c) for c in courses]


@router.get("/taxonomy", response_model=CourseTaxonomyOut)
async def get_course_taxonomy(
    user: DecodedToken = Depends(get_current_user),
    db: Client = Depends(get_firestore_client),
) -> CourseTaxonomyOut:
    """필터 드롭다운용 단과대/학과 목록."""
    del user
    departments, colleges = course_repo.list_taxonomy(db)
    return CourseTaxonomyOut(departments=departments, colleges=colleges)
