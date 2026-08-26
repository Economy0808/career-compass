"""연세대학교 교과과정(TXT 변환본) 파서.

기존 PDF 기반 파서(yonsei_curriculum.py, pdfplumber 좌표 계산)는 폐기되었다.
사용자가 표 구조를 보존한 TXT 변환본을 제공했으므로 좌표 계산 없이 라인 기반으로
파싱한다. 순수 파싱 함수만 제공한다 - Firestore/DB/네트워크 의존성 없음.

두 개의 소스 파일을 다룬다:
- File A (대학요람 교과과정 표): 학년/학기/종별/학정번호/교과목명/학점 등 계층 정보.
- File B (개설교과목 개요): 학정번호별 국문/영문 과목명 + 설명 + 단과대/학과.

두 파일을 학정번호(code) 기준으로 병합한다.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

# 학정번호 패턴: 영문 접두사(2~6자) + 숫자(3~5자리). 예: HUM2037, KOR1001, PSY1001.
_CODE_RE = re.compile(r"\b([A-Z]{2,6}\d{3,5})\b")

# File B 페이지 부속물(반복 헤더/푸터) - 건너뛴다.
_FURNITURE_SUBSTRINGS = (
    "개설교과목 개요",
    "YONSEI UNIVERSITY",
    "2026 연세대학교 대학요람",
)


class CourseKinds:
    """자주 관측되는 학과목종별 값 (닫힌 집합 아님, 참고용).

    미관측 종별이 나와도 파싱을 막지 않는다 - CourseRow.kind는 permissive str.
    """

    JEONGI = "전기"  # 전공기초
    JEONPIL = "전필"  # 전공필수
    JEONSEON = "전선"  # 전공선택
    DAEGYO = "대교"  # 대학교양
    GONGGI = "공기"  # 공통기초
    GYOGI = "교기"  # 교양기초
    GIGYO = "기교"  # 기초교양
    GYOJIK = "교직"  # 교직
    ILBAN = "일반"  # 일반선택
    RC = "RC"
    JEONGONG = "전공"  # 전공


_KNOWN_KINDS = {
    CourseKinds.JEONGI,
    CourseKinds.JEONPIL,
    CourseKinds.JEONSEON,
    CourseKinds.DAEGYO,
    CourseKinds.GONGGI,
    CourseKinds.GYOGI,
    CourseKinds.GIGYO,
    CourseKinds.GYOJIK,
    CourseKinds.ILBAN,
    CourseKinds.RC,
    CourseKinds.JEONGONG,
}


class CourseRow(BaseModel):
    """File A(교과과정 표)에서 파싱한 한 줄."""

    code: str
    name: str
    kind: str  # permissive str - CourseKinds는 참고용 상수일 뿐 닫힌 집합이 아니다.
    years: list[int]
    semester: int | None = None
    credits: float | None = None
    lecture_hours: float | None = None
    lab_hours: float | None = None
    department: str | None = None


class CourseDesc(BaseModel):
    """File B(개설교과목 개요)에서 파싱한 한 항목."""

    code: str
    name_ko: str
    name_en: str | None = None
    description: str
    college: str | None = None
    department: str | None = None


class MergedCourse(BaseModel):
    """File A + File B를 학정번호로 병합한 최종 과목 정보."""

    code: str
    name: str
    kind: str
    years: list[int]
    semester: int | None = None
    credits: float | None = None
    lecture_hours: float | None = None
    lab_hours: float | None = None
    name_en: str | None = None
    description: str | None = None
    college: str | None = None
    department: str | None = None


class ParseDiagnostics(BaseModel):
    """진단 정보 - 스크립트가 _report.txt를 쓸 때 사용."""

    rows_parsed: int = 0
    lines_with_code_skipped: int = 0
    skipped_samples: list[str] = []
    unknown_kinds: dict[str, int] = {}
    descs_parsed: int = 0


def _is_number(token: str) -> bool:
    """토큰이 정수/실수로 파싱 가능한지 확인한다 (콤마 제거 후)."""
    cleaned = token.replace(",", "")
    try:
        float(cleaned)
    except ValueError:
        return False
    return True


def _parse_before_code(before: str) -> tuple[list[int], int | None, str]:
    """학정번호 앞부분에서 (학년 리스트, 학기, 종별)을 뽑아낸다.

    장형: "1,2,3,4  2   일반" -> years=[1,2,3,4], semester=2, kind="일반"
    단형: "전기"              -> years=[], semester=None, kind="전기"
    학기 생략:  "2,3,4  일반"  -> years=[2,3,4], semester=None, kind="일반"

    설계 근거: 종별은 항상 마지막 토큰(전기/전필/전선/... 등 한글 2~3자 또는 RC).
    남은 토큰이 2개면 [학년, 학기], 1개면 [학년]으로 간주한다 - 학기 단독 표기는
    관측되지 않았고, 학년은 콤마 리스트 또는 단일 숫자로만 나타나기 때문이다.
    """
    tokens = before.split()
    if not tokens:
        return [], None, ""
    kind = tokens[-1]
    remaining = tokens[:-1]
    years: list[int] = []
    semester: int | None = None
    if len(remaining) >= 2:
        years_tok, sem_tok = remaining[-2], remaining[-1]
        years = _parse_years(years_tok)
        if sem_tok.isdigit():
            semester = int(sem_tok)
    elif len(remaining) == 1:
        years = _parse_years(remaining[0])
    return years, semester, kind


def _parse_years(token: str) -> list[int]:
    """ "1,2,3,4" 또는 "2,3,4" 또는 "3" 같은 학년 토큰을 정수 리스트로 변환한다."""
    parts = [p for p in token.split(",") if p.strip().isdigit()]
    return [int(p) for p in parts]


def parse_course_row(line: str) -> CourseRow | None:
    """File A의 한 줄을 파싱한다. 표 행이 아니면(산문 등) None을 반환한다.

    판별 기준: 표 행은 학정번호가 정확히 1개 나오고, 학정번호 뒤에 (공백 없는)
    과목명 토큰 + 최소 1개의 숫자 토큰(학점)이 뒤따른다. 산문 문장은 학정번호가
    여러 개 나오거나(콤마로 나열), 학정번호 뒤에 숫자가 아닌 텍스트나 후행 콤마가
    이어진다 - 이 경우 표 행이 아니라고 판단해 버린다.
    """
    stripped = line.rstrip("\n").rstrip()
    if not stripped:
        return None
    codes = _CODE_RE.findall(stripped)
    if len(codes) != 1:
        return None
    if stripped.endswith(","):
        return None
    match = _CODE_RE.search(stripped)
    assert match is not None
    code = codes[0]
    before = stripped[: match.start()]
    after = stripped[match.end() :].strip()
    if not after:
        return None
    parts = after.split()
    name = parts[0]
    rest = parts[1:]
    if not rest:
        return None
    # rest의 모든 토큰이 숫자여야 표 행으로 인정한다 (학점/강의/실습/기타).
    if not all(_is_number(tok) for tok in rest):
        return None

    years, semester, kind = _parse_before_code(before)

    credits = float(rest[0]) if len(rest) >= 1 else None
    lecture_hours = float(rest[1]) if len(rest) >= 2 else None
    lab_hours = float(rest[2]) if len(rest) >= 3 else None

    return CourseRow(
        code=code,
        name=name,
        kind=kind,
        years=years,
        semester=semester,
        credits=credits,
        lecture_hours=lecture_hours,
        lab_hours=lab_hours,
    )


def parse_curriculum_file(path: Path) -> tuple[list[CourseRow], ParseDiagnostics]:
    """File A 전체를 읽어 CourseRow 리스트와 진단 정보를 반환한다."""
    diagnostics = ParseDiagnostics()
    rows: list[CourseRow] = []
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        has_code = bool(_CODE_RE.search(line))
        row = parse_course_row(line)
        if row is not None:
            rows.append(row)
            diagnostics.rows_parsed += 1
            if row.kind not in _KNOWN_KINDS:
                diagnostics.unknown_kinds[row.kind] = diagnostics.unknown_kinds.get(row.kind, 0) + 1
        elif has_code:
            diagnostics.lines_with_code_skipped += 1
            if len(diagnostics.skipped_samples) < 20:
                diagnostics.skipped_samples.append(line.strip())
    return rows, diagnostics


_HEADER_RE = re.compile(r"^([A-Z]{2,6}\d{3,5})\s+(.+)$")


def _split_name_en(rest: str) -> tuple[str, str | None]:
    """ "과목명 (English Name)" 형태에서 (국문명, 영문명)을 뽑는다.

    영문명 괄호가 불균형(예: 여는 괄호 2개, 닫는 괄호 1개)이어도 관대하게 처리한다:
    첫 '(' 이후 전부를 영문명으로 보고 마지막 ')'만 있으면 제거한다.
    """
    idx = rest.find("(")
    if idx == -1:
        return rest.strip(), None
    name_ko = rest[:idx].strip()
    name_en = rest[idx + 1 :].strip()
    if name_en.endswith(")"):
        name_en = name_en[:-1].strip()
    return name_ko, (name_en or None)


def parse_descriptions_file(path: Path) -> tuple[list[CourseDesc], int]:
    """File B 전체를 읽어 CourseDesc 리스트를 반환한다.

    반환값의 두 번째 요소는 파싱된 항목 수(진단용, len(list)와 동일하지만
    명시적으로 반환해 스크립트에서 바로 쓰기 편하게 한다).
    """
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    descs: list[CourseDesc] = []
    college: str | None = None
    department: str | None = None
    expect_department = False

    current_code: str | None = None
    current_name_ko: str = ""
    current_name_en: str | None = None
    current_desc_lines: list[str] = []
    current_college: str | None = None
    current_department: str | None = None

    def flush() -> None:
        if current_code is None:
            return
        descs.append(
            CourseDesc(
                code=current_code,
                name_ko=current_name_ko,
                name_en=current_name_en,
                description="\n".join(current_desc_lines).strip(),
                college=current_college,
                department=current_department,
            )
        )

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if any(sub in line for sub in _FURNITURE_SUBSTRINGS):
            continue

        if line.startswith("대학") and line[2:].strip():
            college = line[2:].strip()
            expect_department = False
            continue
        if line == "학과/전공":
            expect_department = True
            continue
        if expect_department:
            department = line
            expect_department = False
            continue

        header_match = _HEADER_RE.match(line)
        if header_match:
            flush()
            current_code = header_match.group(1)
            current_name_ko, current_name_en = _split_name_en(header_match.group(2))
            current_desc_lines = []
            current_college = college
            current_department = department
            continue

        if current_code is not None:
            current_desc_lines.append(line)

    flush()
    return descs, len(descs)


def merge_courses(
    rows: list[CourseRow], descs: list[CourseDesc]
) -> tuple[list[MergedCourse], int, int]:
    """A(rows)와 B(descs)를 학정번호로 병합한다.

    반환값: (병합된 리스트, A에는 있지만 B에 없는 코드 수, B에는 있지만 A에 없는 코드 수)
    """
    desc_by_code = {d.code: d for d in descs}
    row_codes = {r.code for r in rows}
    desc_codes = set(desc_by_code.keys())

    merged: list[MergedCourse] = []
    for row in rows:
        desc = desc_by_code.get(row.code)
        merged.append(
            MergedCourse(
                code=row.code,
                name=row.name,
                kind=row.kind,
                years=row.years,
                semester=row.semester,
                credits=row.credits,
                lecture_hours=row.lecture_hours,
                lab_hours=row.lab_hours,
                name_en=desc.name_en if desc else None,
                description=desc.description if desc else None,
                college=desc.college if desc else None,
                department=desc.department if desc else None,
            )
        )

    a_missing_b = len(row_codes - desc_codes)
    b_missing_a = len(desc_codes - row_codes)
    return merged, a_missing_b, b_missing_a
