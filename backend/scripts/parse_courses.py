"""연세대 교과과정 TXT 두 개를 파싱해 병합 JSON + 진단 리포트를 쓰는 CLI.

사용법:
    python scripts/parse_courses.py <curriculum.txt> <descriptions.txt> <output.json>

출력: <output.json> (병합된 과목 리스트) + <output 파일명>_report.txt (UTF-8 진단 정보).
Windows에서 한글을 stdout에 직접 출력하면 cp949 인코딩 문제로 죽을 수 있으므로
콘솔에는 ASCII 요약만 출력하고, 상세 내용은 UTF-8 파일에 쓴다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.yonsei_courses import (  # noqa: E402
    merge_courses,
    parse_curriculum_file,
    parse_descriptions_file,
)


def main() -> None:
    if len(sys.argv) != 4:
        print("usage: parse_courses.py <curriculum.txt> <descriptions.txt> <output.json>")
        sys.exit(1)

    curriculum_path = Path(sys.argv[1])
    descriptions_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    rows, diagnostics = parse_curriculum_file(curriculum_path)
    descs, desc_count = parse_descriptions_file(descriptions_path)
    merged, a_missing_b, b_missing_a = merge_courses(rows, descs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps([m.model_dump() for m in merged], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    report_path = output_path.with_name(output_path.stem + "_report.txt")
    unique_codes_a = len({r.code for r in rows})
    unique_codes_b = len({d.code for d in descs})
    report_lines = [
        "=== Yonsei Courses Parse Report ===",
        f"File A path: {curriculum_path}",
        f"File B path: {descriptions_path}",
        "",
        f"Rows parsed from A: {len(rows)}  (unique codes: {unique_codes_a})",
        f"Descriptions parsed from B: {desc_count}  (unique codes: {unique_codes_b})",
        f"Merged total: {len(merged)}",
        f"Codes in A with no description in B: {a_missing_b}",
        f"Codes in B with no row in A: {b_missing_a}",
        f"Lines with a course code that were skipped (not a table row): {diagnostics.lines_with_code_skipped}",
        "",
        "Unknown (unrecognized) kinds seen, with counts:",
    ]
    if diagnostics.unknown_kinds:
        for kind, count in sorted(diagnostics.unknown_kinds.items(), key=lambda kv: -kv[1]):
            report_lines.append(f"  {kind!r}: {count}")
    else:
        report_lines.append("  (none)")

    report_lines.append("")
    report_lines.append(
        "Sample skipped lines (up to 20), to verify prose rejection is not over-rejecting:"
    )
    for sample in diagnostics.skipped_samples:
        report_lines.append(f"  {sample}")

    report_path.write_text("\n".join(report_lines), encoding="utf-8")

    # 콘솔에는 ASCII만 출력 (Windows cp949 UnicodeEncodeError 회피).
    print(f"rows_parsed_from_A={len(rows)}")
    print(f"descriptions_parsed_from_B={desc_count}")
    print(f"merged_total={len(merged)}")
    print(f"a_missing_b={a_missing_b}")
    print(f"b_missing_a={b_missing_a}")
    print(f"lines_with_code_skipped={diagnostics.lines_with_code_skipped}")
    print(f"unknown_kinds_count={len(diagnostics.unknown_kinds)}")
    print(f"output_json={output_path}")
    print(f"report_txt={report_path}")


if __name__ == "__main__":
    main()
