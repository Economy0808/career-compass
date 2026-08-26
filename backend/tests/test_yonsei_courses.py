"""yonsei_courses.py 단위 테스트.

브리핑에 인용된 verbatim 샘플 문자열만 사용한다 - 유저 로컬 파일에 의존하지 않는다.
"""

import shutil
import uuid
from pathlib import Path

import pytest

from app.etl.yonsei_courses import (
    CourseDesc,
    CourseRow,
    _split_name_en,
    merge_courses,
    parse_course_level,
    parse_course_row,
    parse_curriculum_file,
    parse_descriptions_file,
)

# pytest의 기본 tmp_path는 이 Windows 환경에서 ESTsoft CreatorTemp 권한 문제로
# WinError 5를 낸다(코드 문제 아님, 알려진 환경 이슈). 대신 스크래치패드 아래에
# 직접 임시 디렉터리를 만든다.
_SCRATCH_ROOT = Path(
    r"C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Project-CareerCompass-03-Code"
    r"\b859fff5-343b-4e81-8df2-760d65a34178\scratchpad\pytest_tmp"
)


@pytest.fixture
def scratch_dir():
    d = _SCRATCH_ROOT / uuid.uuid4().hex
    d.mkdir(parents=True, exist_ok=True)
    yield d
    shutil.rmtree(d, ignore_errors=True)


# --- File A: 표 행 파싱 ---------------------------------------------------


def test_parse_long_form_row_with_years_and_semester():
    line = "1,2,3,4  2   일반   HUM2037  동서양공연예술의이해          3   3   0   2000"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "HUM2037"
    assert row.name == "동서양공연예술의이해"
    assert row.kind == "일반"
    assert row.years == [1, 2, 3, 4]
    assert row.semester == 2
    assert row.credits == 3.0
    assert row.lecture_hours == 3.0
    assert row.lab_hours == 0.0


def test_parse_long_form_row_second_sample():
    line = "1,2,3,4  1   일반   HUM2038  디지털언어데이터와인문학        3   3   0   2000"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "HUM2038"
    assert row.years == [1, 2, 3, 4]
    assert row.semester == 1


def test_parse_long_form_row_years_subset():
    line = "2,3,4   1   일반  HUM2042  한국의세계유산과디지털리터러시      3   3   0   2000"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "HUM2042"
    assert row.years == [2, 3, 4]
    assert row.semester == 1
    assert row.name == "한국의세계유산과디지털리터러시"


def test_parse_long_form_row_fourth_sample():
    line = "2,3,4   2   일반   HUM2049  인물로본한국사            3   3   0    2000"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "HUM2049"
    assert row.years == [2, 3, 4]
    assert row.semester == 2
    assert row.name == "인물로본한국사"


def test_parse_short_form_row_no_years_semester_hours():
    line = "전기 KOR1001 한국어문학의이해    3"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "KOR1001"
    assert row.name == "한국어문학의이해"
    assert row.kind == "전기"
    assert row.years == []
    assert row.semester is None
    assert row.credits == 3.0
    assert row.lecture_hours is None
    assert row.lab_hours is None


def test_parse_short_form_row_second_sample():
    line = "전기 KOR1101 우리말연구의첫걸음   3"
    row = parse_course_row(line)
    assert row is not None
    assert row.code == "KOR1101"
    assert row.kind == "전기"
    assert row.credits == 3.0


def test_unknown_kind_is_permissive_not_dropped():
    """미관측 종별이어도 유효한 학정번호가 있으면 절대 버리지 않는다."""
    line = "미분류 PSY9999 알수없는과목  3"
    row = parse_course_row(line)
    assert row is not None
    assert row.kind == "미분류"
    assert row.code == "PSY9999"


def test_prose_line_with_multiple_codes_is_rejected():
    line = "국 어 국 문 학 전 공  KOR1001 한국어문학의이해, KOR1101 우리말연구의첫걸음,"
    assert parse_course_row(line) is None


def test_prose_line_trailing_comma_single_code_is_rejected():
    line = "KOR1001 한국어문학의이해,"
    assert parse_course_row(line) is None


def test_blank_line_is_rejected():
    assert parse_course_row("") is None
    assert parse_course_row("   \n") is None


def test_line_with_code_but_no_trailing_numbers_is_rejected():
    line = "관련 과목으로 PSY1001 심리학개론을 권장한다"
    assert parse_course_row(line) is None


# --- File B: 개요 파싱 -----------------------------------------------------


def test_split_name_en_balanced():
    ko, en = _split_name_en(
        "동서양공연예술의이해 (Understanding of Performing Arts in the East and the West)"
    )
    assert ko == "동서양공연예술의이해"
    assert en == "Understanding of Performing Arts in the East and the West"


def test_split_name_en_unbalanced_parens_is_tolerant():
    ko, en = _split_name_en("디지털미디어와젠더 (Digital Media and Posthuman(Reflection)")
    assert ko == "디지털미디어와젠더"
    assert en == "Digital Media and Posthuman(Reflection"


def test_split_name_en_no_parens():
    ko, en = _split_name_en("이름만있음")
    assert ko == "이름만있음"
    assert en is None


def test_parse_descriptions_file(scratch_dir):
    content = (
        "개설교과목 개요   1\n"
        "YONSEI UNIVERSITY\n"
        "2026 연세대학교 대학요람\n"
        "대학  문과대학\n"
        "학과/전공\n"
        "문과대학 공통\n"
        "HUM2037 동서양공연예술의이해 (Understanding of Performing Arts in the East and the West)\n"
        "'동서양공연예술의이해'는 고전극에서 현대미디어극까지, 서구의 오페라에서 한국의 판소리까지, 공연예술 전반에 대한 입문\n"
        "수업으로, 동서양의 다양한 공연예술의 형식과 흐름을 이해하고 문화적 차이를 분석하는 데에 목표를 둔다.\n"
        "HUM2038 디지털언어데이터와인문학 (Digital Language Data and Humanities)\n"
        "설명 두번째 과목.\n"
    )
    path = scratch_dir / "desc.txt"
    path.write_text(content, encoding="utf-8")

    descs, count = parse_descriptions_file(path)
    assert count == 2
    first = descs[0]
    assert first.code == "HUM2037"
    assert first.name_ko == "동서양공연예술의이해"
    assert first.name_en == "Understanding of Performing Arts in the East and the West"
    assert "공연예술" in first.description
    assert first.college == "문과대학"
    assert first.department == "문과대학 공통"

    second = descs[1]
    assert second.code == "HUM2038"
    assert second.description == "설명 두번째 과목."
    assert second.college == "문과대학"


# --- 병합 ------------------------------------------------------------------


def test_merge_courses_joins_by_code_and_reports_coverage():
    """outer join이므로 A/B 어느 한쪽에만 있는 코드도 결과에 남는다 (총 3개).

    기존 버전은 inner join(A 기준)이라 len(merged) == 2, YYY0000(B 전용)이
    버려졌었다 - 이것이 바로 이번에 고친 데이터 손실 버그이므로 기대값을
    outer join 기준(3개, 아무것도 버려지지 않음)으로 갱신했다.
    """
    rows = [
        CourseRow(
            code="HUM2037",
            name="동서양공연예술의이해",
            kind="일반",
            years=[1, 2, 3, 4],
            semester=2,
            credits=3.0,
        ),
        CourseRow(
            code="ZZZ9999", name="설명없음과목", kind="일반", years=[], semester=None, credits=3.0
        ),
    ]
    descs = [
        CourseDesc(
            code="HUM2037",
            name_ko="동서양공연예술의이해",
            name_en="Understanding...",
            description="설명",
            college="문과대학",
        ),
        CourseDesc(code="YYY0000", name_ko="표에없는과목", description="설명2"),
    ]
    merged, a_missing_b, b_missing_a = merge_courses(rows, descs)
    assert len(merged) == 3
    assert a_missing_b == 1  # ZZZ9999
    assert b_missing_a == 1  # YYY0000
    hum = next(m for m in merged if m.code == "HUM2037")
    assert hum.description == "설명"
    assert hum.college == "문과대학"
    no_desc = next(m for m in merged if m.code == "ZZZ9999")
    assert no_desc.description is None


def test_outer_join_keeps_course_present_only_in_file_b():
    """B 전용 코드는 hierarchy 필드(kind/years)가 비어 있는 채로 살아남는다."""
    descs = [CourseDesc(code="YYY0000", name_ko="표에없는과목", description="설명2")]
    merged, a_missing_b, b_missing_a = merge_courses([], descs)
    assert len(merged) == 1
    only_b = merged[0]
    assert only_b.code == "YYY0000"
    assert only_b.name == "표에없는과목"
    assert only_b.description == "설명2"
    assert only_b.kind is None
    assert only_b.years == []
    assert b_missing_a == 1
    assert a_missing_b == 0


def test_outer_join_keeps_course_present_only_in_file_a():
    """A 전용 코드는 description 계열 필드가 비어 있는 채로 살아남는다."""
    rows = [
        CourseRow(
            code="ZZZ9999", name="설명없음과목", kind="일반", years=[1], semester=1, credits=3.0
        )
    ]
    merged, a_missing_b, b_missing_a = merge_courses(rows, [])
    assert len(merged) == 1
    only_a = merged[0]
    assert only_a.code == "ZZZ9999"
    assert only_a.name == "설명없음과목"
    assert only_a.kind == "일반"
    assert only_a.years == [1]
    assert only_a.description is None
    assert only_a.name_en is None
    assert only_a.college is None
    assert a_missing_b == 1
    assert b_missing_a == 0


def test_course_in_both_sources_gets_fields_from_both():
    rows = [
        CourseRow(
            code="HUM2037",
            name="동서양공연예술의이해",
            kind="일반",
            years=[1, 2, 3, 4],
            semester=2,
            credits=3.0,
        )
    ]
    descs = [
        CourseDesc(
            code="HUM2037",
            name_ko="동서양공연예술의이해",
            name_en="Understanding...",
            description="설명",
            college="문과대학",
            department="문과대학 공통",
        )
    ]
    merged, _, _ = merge_courses(rows, descs)
    assert len(merged) == 1
    both = merged[0]
    assert both.kind == "일반"
    assert both.years == [1, 2, 3, 4]
    assert both.name_en == "Understanding..."
    assert both.description == "설명"
    assert both.college == "문과대학"


# --- level(계층 수준) 폴백 --------------------------------------------------


def test_parse_course_level_known_codes():
    assert parse_course_level("KOR1001") == 1
    assert parse_course_level("STA3109") == 3
    assert parse_course_level("BIZ4123") == 4


def test_parse_course_level_malformed_code_returns_none():
    assert parse_course_level("KOR") is None
    assert parse_course_level("1001") is None
    assert parse_course_level("KO0R1001X") is None


def test_level_does_not_populate_or_alter_years():
    """level은 years가 없을 때 참고용 폴백일 뿐, years 필드를 채우거나 바꾸면 안 된다."""
    rows = [
        CourseRow(code="STA3109", name="통계학", kind="전선", years=[], semester=None, credits=3.0)
    ]
    merged, _, _ = merge_courses(rows, [])
    course = merged[0]
    assert course.level == 3
    assert course.years == []  # level이 있어도 years는 그대로 비어 있다

    rows_with_years = [
        CourseRow(
            code="STA3109", name="통계학", kind="전선", years=[1, 2], semester=None, credits=3.0
        )
    ]
    merged2, _, _ = merge_courses(rows_with_years, [])
    course2 = merged2[0]
    assert course2.level == 3
    assert course2.years == [1, 2]  # 실제 years가 있으면 level과 무관하게 그대로 유지


def test_parse_curriculum_file_records_diagnostics(scratch_dir):
    content = (
        "1,2,3,4  2   일반   HUM2037  동서양공연예술의이해          3   3   0   2000\n"
        "전기 KOR1001 한국어문학의이해    3\n"
        "국 어 국 문 학 전 공  KOR1001 한국어문학의이해, KOR1101 우리말연구의첫걸음,\n"
    )
    path = scratch_dir / "curriculum.txt"
    path.write_text(content, encoding="utf-8")

    rows, diagnostics = parse_curriculum_file(path)
    assert len(rows) == 2
    assert diagnostics.rows_parsed == 2
    assert diagnostics.lines_with_code_skipped == 1
