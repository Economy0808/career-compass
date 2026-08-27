"""연세대학교 실습 교과목을 Firestore 에뮬레이터에 시드하는 스크립트.

## 목적
개발/QA 단계에서 course_catalog을 테스트하기 위해 20~30개의 현실적인 Yonsei 교과목
문서를 에뮬레이터에 적재한다. mock_client.py의 _DEPARTMENT_KEYWORDS 맵과 일치하는
단과대/학과만 사용하므로, mock 선택 파이프라인과 일관성 있게 테스트할 수 있다.

## 주요 제약
- FIRESTORE_EMULATOR_HOST가 반드시 설정되어야 함 (실 DB 오염 방지).
- 학정번호 레벨(code 숫자부 첫 자리)은 1000~4000 범위만 (5000/6000은 대학원 과목으로 필터됨).
- college/department 필드는 mock이 인식할 수 있는 값만 사용.
- kind는 yonsei_courses.py의 _KNOWN_KINDS에 포함된 값만 사용.

## mock_client.py 의존성
_DEPARTMENT_KEYWORDS 맵:
  "경영대학" → ["경영대학", "상경대학"]
  "경영" → ["경영대학"]
  "데이터" → ["응용통계학과", "공과대학"]
  "프로그래" → ["공과대학"]
  등
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.yonsei_courses import MergedCourse  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402
from app.firestore.course_repo import upsert_courses  # noqa: E402

# 시드할 테스트 과목들. 단과대/학과는 mock 매킹에서 인식 가능한 값만 사용.
_SEED_COURSES = [
    # 경영대학 (Business School) — BIZ 코드
    MergedCourse(
        code="BIZ1101",
        name="경영학원론",
        kind="전필",
        years=[1],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Introduction to Business",
        description="경영학의 기본 개념과 경영환경, 조직의 주요 기능을 이해한다.",
        college="경영대학",
        department="경영학과",
    ),
    MergedCourse(
        code="BIZ2102",
        name="재무회계",
        kind="전필",
        years=[2],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=2,
        name_en="Financial Accounting",
        description="재무제표 작성과 분석, 회계 순환의 기본을 다룬다.",
        college="경영대학",
        department="경영학과",
    ),
    MergedCourse(
        code="BIZ2103",
        name="경영통계학",
        kind="전선",
        years=[2],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=2,
        name_en="Business Statistics",
        description="경영 의사결정에 필요한 통계 분석 기법을 학습한다.",
        college="경영대학",
        department="경영학과",
    ),
    MergedCourse(
        code="BIZ3201",
        name="마케팅관리",
        kind="전선",
        years=[3],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=3,
        name_en="Marketing Management",
        description="마케팅 전략 수립과 고객 관계 관리 기본을 학습한다.",
        college="경영대학",
        department="경영학과",
    ),
    MergedCourse(
        code="BIZ3202",
        name="조직행동론",
        kind="전선",
        years=[3],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=3,
        name_en="Organizational Behavior",
        description="조직 내 개인과 집단의 행동을 이해하고 관리하는 방법을 다룬다.",
        college="경영대학",
        department="경영학과",
    ),
    MergedCourse(
        code="BIZ4301",
        name="경영전략론",
        kind="전선",
        years=[4],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=4,
        name_en="Business Strategy",
        description="기업의 장기 경쟁력 확보 전략을 수립하고 평가한다.",
        college="경영대학",
        department="경영학과",
    ),
    # 상경대학 (Commerce and Economics School) — ECO/STA 코드
    MergedCourse(
        code="ECO1001",
        name="미시경제학",
        kind="전필",
        years=[1],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Microeconomics",
        description="소비자, 기업, 시장의 경제 행동을 분석한다.",
        college="상경대학",
        department="경제학부",
    ),
    MergedCourse(
        code="ECO1002",
        name="거시경제학",
        kind="전필",
        years=[1],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Macroeconomics",
        description="국가 전체의 경제 현상과 정책을 다룬다.",
        college="상경대학",
        department="경제학부",
    ),
    MergedCourse(
        code="ECO2101",
        name="경제학사",
        kind="전선",
        years=[2],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=2,
        name_en="History of Economic Thought",
        description="경제학의 발전 과정과 주요 학파의 이론을 학습한다.",
        college="상경대학",
        department="경제학부",
    ),
    MergedCourse(
        code="STA1101",
        name="확률과통계",
        kind="전필",
        years=[1],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Probability and Statistics",
        description="확률의 기본 개념과 통계 분석의 기초를 다룬다.",
        college="상경대학",
        department="응용통계학과",
    ),
    MergedCourse(
        code="STA2201",
        name="수리통계학",
        kind="전필",
        years=[2],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=2,
        name_en="Mathematical Statistics",
        description="통계적 추론과 확률 모형의 수학적 이론을 학습한다.",
        college="상경대학",
        department="응용통계학과",
    ),
    MergedCourse(
        code="STA2202",
        name="회귀분석",
        kind="전선",
        years=[2],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=2,
        name_en="Regression Analysis",
        description="회귀 모형의 구축과 검증, 해석 기법을 다룬다.",
        college="상경대학",
        department="응용통계학과",
    ),
    MergedCourse(
        code="STA3301",
        name="다변량분석",
        kind="전선",
        years=[3],
        semester=1,
        credits=3.0,
        lecture_hours=3.0,
        level=3,
        name_en="Multivariate Analysis",
        description="다변량 데이터의 분석 기법과 해석을 학습한다.",
        college="상경대학",
        department="응용통계학과",
    ),
    # 공과대학 (Engineering School) — CSI/EEE 코드
    MergedCourse(
        code="CSI1001",
        name="프로그래밍기초",
        kind="전필",
        years=[1],
        semester=1,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=1,
        name_en="Introduction to Programming",
        description="프로그래밍의 기본 개념과 문제 해결 방법을 학습한다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="CSI1002",
        name="이산수학",
        kind="전필",
        years=[1],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Discrete Mathematics",
        description="컴퓨터과학 기초가 되는 이산 구조를 다룬다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="CSI2101",
        name="자료구조",
        kind="전필",
        years=[2],
        semester=1,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=2,
        name_en="Data Structures",
        description="기본 자료구조와 알고리즘의 설계·분석을 학습한다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="CSI2102",
        name="데이터베이스",
        kind="전선",
        years=[2],
        semester=2,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=2,
        name_en="Database Systems",
        description="데이터베이스 설계, 관계형 모형, SQL을 다룬다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="CSI3201",
        name="운영체제",
        kind="전필",
        years=[3],
        semester=1,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=3,
        name_en="Operating Systems",
        description="프로세스 관리, 메모리 관리, 파일시스템 기초를 학습한다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="CSI3202",
        name="네트워크",
        kind="전선",
        years=[3],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=3,
        name_en="Computer Networks",
        description="네트워크 통신 프로토콜과 인터넷 기술을 다룬다.",
        college="공과대학",
        department="컴퓨터과학과",
    ),
    MergedCourse(
        code="EEE1001",
        name="회로이론",
        kind="전필",
        years=[1],
        semester=2,
        credits=3.0,
        lecture_hours=3.0,
        level=1,
        name_en="Circuit Theory",
        description="전기 회로의 기본 원리와 분석 방법을 학습한다.",
        college="공과대학",
        department="전기공학과",
    ),
    MergedCourse(
        code="EEE2101",
        name="신호처리",
        kind="전선",
        years=[2],
        semester=1,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=2,
        name_en="Signal Processing",
        description="신호의 표현과 처리 기법을 다룬다.",
        college="공과대학",
        department="전기공학과",
    ),
    MergedCourse(
        code="EEE3301",
        name="전자회로",
        kind="전선",
        years=[3],
        semester=1,
        credits=3.0,
        lecture_hours=2.0,
        lab_hours=2.0,
        level=3,
        name_en="Electronics",
        description="반도체 소자와 전자 회로 설계의 기초를 학습한다.",
        college="공과대학",
        department="전기공학과",
    ),
]


def main() -> None:
    """에뮬레이터에 테스트 과목들을 시드한다."""
    # HARD GUARD: 에뮬레이터 확인 - 실 DB 오염 절대 금지
    if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        print(
            "ERROR: FIRESTORE_EMULATOR_HOST는 설정되어야 합니다. "
            "실제 Firestore 프로젝트를 보호하기 위해 에뮬레이터 없이는 실행할 수 없습니다.",
            file=sys.stderr,
        )
        sys.exit(1)

    db = get_firestore_client()
    written = upsert_courses(db, _SEED_COURSES)

    # 단과대별 통계 출력 (콘솔에는 ASCII 기반 형식, Windows cp949 회피)
    from collections import Counter

    college_counts = Counter(c.college or "(없음)" for c in _SEED_COURSES)
    department_counts = Counter(c.department or "(없음)" for c in _SEED_COURSES)

    print("=== Firestore Emulator Course Seed ===")
    print(f"Total courses seeded: {written}/{len(_SEED_COURSES)}")
    print("")
    print("--- Counts by college ---")
    for college, count in sorted(college_counts.items(), key=lambda kv: -kv[1]):
        # ASCII 변환 (대학 이름의 한글은 콘솔에 직접 출력할 수 없으므로 간단히 개수만)
        print(f"  {college}: {count}")

    print("")
    print("--- Counts by department ---")
    for department, count in sorted(department_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {department}: {count}")


if __name__ == "__main__":
    main()
