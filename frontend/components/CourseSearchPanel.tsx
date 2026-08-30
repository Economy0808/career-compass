"use client";

/**
 * 과목 검색 패널 - 학정번호·과목명 통합검색 + 학과/단과대 필터로 실제 개설
 * 과목을 찾아 보관함 원소로 추가한다. ElementBinPanel의 "직접 추가" 폼에서
 * 원소 종류로 "수업"을 고르면 이 패널이 대신 뜬다(자격증·학회 등은 여전히
 * 텍스트로 직접 입력 - 검색 카탈로그가 없으므로).
 *
 * app/explore/page.tsx의 응답 역전 방지(seq 가드) + 디바운스 패턴을 그대로
 * 따른다. 필터는 FILTER_DEFS 배열로 다뤄, 캠퍼스 컬럼이 나중에 채워지면 이
 * 배열에 한 줄만 추가하면 되게 한다(이번 스코프에서는 제외 - 사용자 결정).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { courseItemId, getCourseTaxonomy, searchCourses, type CourseDto } from "@/lib/courses-api";

const SEARCH_DEBOUNCE_MS = 300;

type FilterKey = "department" | "college";

interface FilterDef {
  key: FilterKey;
  label: string;
}

// campus 필터는 원천 데이터에 과목별 컬럼이 없어 이번 스코프에서 제외(사용자
// 결정: "나중에 내가 적재해줄게 지금 캠퍼스 정보는 패스하자"). 나중에 값이
// 채워지면 { key: "campus", label: "캠퍼스" } 한 줄만 여기 추가하면 되고,
// 드롭다운 렌더/쿼리 조립 쪽은 손댈 필요가 없다.
const FILTER_DEFS: FilterDef[] = [
  { key: "department", label: "학과" },
  { key: "college", label: "단과대" },
];

type TaxonomyByKey = Record<FilterKey, string[]>;

export interface CourseSearchPanelProps {
  onSelect: (course: CourseDto) => void;
  /** 이미 어딘가의 보관함에 담긴 과목 id(course:{학정번호}) - 중복 클릭 방지 표시용. */
  existingItemIds: Set<string>;
  className?: string;
}

export function CourseSearchPanel({ onSelect, existingItemIds, className }: CourseSearchPanelProps) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ department: "", college: "" });
  const [taxonomy, setTaxonomy] = useState<TaxonomyByKey | null>(null);
  const [results, setResults] = useState<CourseDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // 응답 역전 방지 - 마지막 요청만 반영한다(app/explore/page.tsx와 동일 패턴).
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getCourseTaxonomy()
      .then((dto) => {
        if (!cancelled) setTaxonomy({ department: dto.departments, college: dto.colleges });
      })
      .catch(() => {
        // 드롭다운은 옵션 없이(검색창 텍스트만으로) 계속 동작하므로 화면을 죽이지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    const trimmed = q.trim();
    setLoading(true);
    setError(false);
    const timer = setTimeout(
      () => {
        searchCourses({
          q: trimmed || undefined,
          department: filters.department || undefined,
          college: filters.college || undefined,
          limit: 20,
        })
          .then((list) => {
            if (requestSeq.current === seq) {
              setResults(list);
              setLoading(false);
            }
          })
          .catch(() => {
            if (requestSeq.current === seq) {
              setResults([]);
              setError(true);
              setLoading(false);
            }
          });
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [q, filters.department, filters.college]);

  const hasQueryOrFilter = q.trim() || filters.department || filters.college;

  return (
    <div className={className}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="학정번호·과목명 검색"
        aria-label="과목 검색"
        className="w-full min-w-0 rounded-none border border-paper-line bg-transparent px-2 py-1 text-micro text-paper-ink placeholder:text-paper-lo focus:border-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-ink/60"
      />
      <div className="mt-1.5 flex gap-1.5">
        {FILTER_DEFS.map((def) => (
          <select
            key={def.key}
            value={filters[def.key]}
            onChange={(e) => setFilters((prev) => ({ ...prev, [def.key]: e.target.value }))}
            aria-label={def.label}
            className="min-w-0 flex-1 rounded-none border border-paper-line bg-paper px-1 py-1 text-micro text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-ink/60"
          >
            <option value="">{def.label} 전체</option>
            {(taxonomy?.[def.key] ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ))}
      </div>
      <div
        className="canvas-scroll mt-1.5 max-h-40 space-y-1 overflow-y-auto overscroll-contain pr-0.5"
        aria-live="polite"
      >
        {loading ? (
          <p className="px-1 py-1.5 text-micro text-paper-lo">검색 중…</p>
        ) : error ? (
          <p className="px-1 py-1.5 text-micro text-paper-lo">검색에 실패했어요. 다시 시도해 주세요.</p>
        ) : !results || results.length === 0 ? (
          <p className="px-1 py-1.5 text-micro text-paper-lo">
            {hasQueryOrFilter ? "일치하는 과목이 없어요." : "검색어를 입력하거나 필터를 골라보세요."}
          </p>
        ) : (
          results.map((course) => {
            const id = courseItemId(course.code);
            const already = existingItemIds.has(id);
            return (
              <button
                key={course.code}
                type="button"
                disabled={already}
                onClick={() => onSelect(course)}
                aria-label={already ? `${course.name} - 이미 담았어요` : `${course.name} 담기`}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-none border px-2 py-1 text-left text-micro transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-ink/60",
                  already
                    ? "cursor-default border-paper-line text-paper-lo opacity-45"
                    : "border-paper-line text-paper-ink hover:border-paper-ink/50 hover:bg-paper"
                )}
              >
                <span className="shrink-0 font-mono text-micro text-paper-lo">{course.code}</span>
                <span className="min-w-0 flex-1 truncate">{course.name}</span>
                {course.department && (
                  <span className="shrink-0 truncate text-micro text-paper-lo">{course.department}</span>
                )}
                {typeof course.credits === "number" && (
                  <span className="shrink-0 text-micro text-paper-lo">{course.credits}학점</span>
                )}
                {already && (
                  <span aria-hidden className="shrink-0 text-lit">
                    ✓
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
