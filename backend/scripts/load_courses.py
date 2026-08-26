"""parse_courses.py가 만든 병합 JSON을 읽어 Firestore course_catalog에 적재하는 CLI.

사용법 (backend/ 에서, 에뮬레이터가 이미 떠 있고 FIRESTORE_EMULATOR_HOST가
설정된 상태):
    .venv/Scripts/python.exe scripts/load_courses.py <courses.json> <report_out.txt>

실제 운영 프로젝트(ourlab-0808)를 건드리지 않도록, FIRESTORE_EMULATOR_HOST가
설정되지 않은 상태에서는 즉시 에러로 중단한다 - "실수로 실제 DB에 쓰는 것"이
이 스크립트가 낼 수 있는 가장 위험한 실패 모드이기 때문이다.

출력 리포트는 UTF-8 파일로 쓴다 - Windows 콘솔(cp949)에 한글을 직접 출력하면
죽으므로, 콘솔에는 ASCII 요약만 찍는다(parse_courses.py와 동일한 패턴).
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.yonsei_courses import MergedCourse  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402
from app.firestore.course_repo import upsert_courses  # noqa: E402

# parse_course_row가 "표 행이 아닌데 표로 잘못 인식된" 경우 kind에 이런 값들이
# 섞여 들어온다(연세대 교과과정 파서의 알려진 한계, 브리핑 참고). 정상적인
# 종별 집합은 yonsei_courses.py의 _KNOWN_KINDS와 같지만, 이 스크립트는 별도
# import 없이 그 모듈이 이미 진단에 쓰는 것과 동일한 개념을 재사용한다.
_KNOWN_KINDS = {
    "전기",
    "전필",
    "전선",
    "대교",
    "공기",
    "교기",
    "기교",
    "교직",
    "일반",
    "RC",
    "전공",
}


def _load_courses(json_path: Path) -> list[MergedCourse]:
    raw = json.loads(json_path.read_text(encoding="utf-8"))
    return [MergedCourse.model_validate(item) for item in raw]


def _build_report(courses: list[MergedCourse], written: int) -> str:
    college_counts = Counter(c.college or "(없음)" for c in courses)
    department_counts = Counter(c.department or "(없음)" for c in courses)

    missing_description = sum(1 for c in courses if not c.description)
    missing_or_suspicious_kind = sum(1 for c in courses if c.kind not in _KNOWN_KINDS)
    missing_years = sum(1 for c in courses if not c.years)

    lines = [
        "=== Firestore Course Catalog Load Report ===",
        f"Total loaded (written to Firestore): {written}",
        f"Total courses in input JSON: {len(courses)}",
        "",
        "--- Data quality ---",
        f"Missing description: {missing_description}",
        f"Missing or suspicious kind (not in known set {sorted(_KNOWN_KINDS)}): "
        f"{missing_or_suspicious_kind}",
        f"Missing years (empty list): {missing_years}",
        "",
        "--- Counts by college ---",
    ]
    for college, count in sorted(college_counts.items(), key=lambda kv: -kv[1]):
        lines.append(f"  {college}: {count}")

    lines.append("")
    lines.append("--- Counts by department ---")
    for department, count in sorted(department_counts.items(), key=lambda kv: -kv[1]):
        lines.append(f"  {department}: {count}")

    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: load_courses.py <courses.json> <report_out.txt>")
        sys.exit(1)

    if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        print(
            "ERROR: FIRESTORE_EMULATOR_HOST is not set. "
            "Refusing to run against the real Firestore project.",
            file=sys.stderr,
        )
        sys.exit(1)

    json_path = Path(sys.argv[1])
    report_path = Path(sys.argv[2])

    courses = _load_courses(json_path)
    db = get_firestore_client()
    written = upsert_courses(db, courses)

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(_build_report(courses, written), encoding="utf-8")

    # 콘솔에는 ASCII만 출력 (Windows cp949 UnicodeEncodeError 회피).
    print(f"input_courses={len(courses)}")
    print(f"written={written}")
    print(f"report_path={report_path}")


if __name__ == "__main__":
    main()
