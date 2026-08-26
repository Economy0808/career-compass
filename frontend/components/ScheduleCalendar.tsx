"use client";

import { ChevronRightIcon } from "@/components/ui";
import { cn } from "@/lib/cn";
import { localISODate, todayISODate } from "@/lib/format";
import type { CalendarDayOut } from "@/lib/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 별 마커: 다섯 꼭짓점 별 하나로 그날의 진행도를 나타낸다.
const STAR_PATH =
  "M12 2.5l2.7 6.4 6.9.6-5.3 4.6 1.6 6.8L12 17.3l-5.9 3.6 1.6-6.8-5.3-4.6 6.9-.6L12 2.5Z";

// 하루 완료 목표 = 6개. 6에 가까울수록 별이 커지고 선명해진다.
const DAY_GOAL = 6;

/** 완료 개수(1~6) → 별 크기/불투명도. 6에서 최대. */
function starVisual(count: number): { size: number; opacity: number; full: boolean } {
  const n = Math.min(count, DAY_GOAL);
  const t = (n - 1) / (DAY_GOAL - 1); // 0..1
  return { size: 10 + t * 12, opacity: 0.45 + t * 0.55, full: n >= DAY_GOAL };
}

interface ScheduleCalendarProps {
  year: number;
  month: number; // 1-12
  selectedDate: string; // YYYY-MM-DD
  /** date(YYYY-MM-DD) → 집계 */
  data: Record<string, CalendarDayOut>;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function ScheduleCalendar({
  year,
  month,
  selectedDate,
  data,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: ScheduleCalendarProps) {
  const today = todayISODate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-lg border border-rule bg-ink-800 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          className="rounded-full p-1.5 text-text-lo transition-colors hover:bg-white/8 hover:text-text-hi"
          aria-label="이전 달"
        >
          <ChevronRightIcon size={18} className="rotate-180" />
        </button>
        <div className="font-serif text-heading font-bold text-text-hi">
          {year}년 {month}월
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded-full p-1.5 text-text-lo transition-colors hover:bg-white/8 hover:text-text-hi"
          aria-label="다음 달"
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={cn(
              "pb-1.5 text-center text-micro font-semibold",
              // 주말만 색으로 구분 — 토큰이 아닌 요일 전용 색이다.
              i === 0 ? "text-[#c98a8a]" : i === 6 ? "text-[#8aa9c9]" : "text-text-lo"
            )}
          >
            {w}
          </div>
        ))}

        {cells.map((day, idx) => {
          if (day === null) return <div key={`b${idx}`} />;
          const iso = localISODate(new Date(year, month - 1, day));
          const cell = data[iso];
          const isSelected = iso === selectedDate;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              className={cn(
                "flex aspect-square flex-col items-center justify-start gap-0.5 rounded-md border pt-1.5",
                "text-caption transition-colors",
                isSelected
                  ? "border-rule bg-spec-b/18 text-text-hi"
                  : "border-transparent text-text-lo hover:bg-white/6"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full",
                  isToday && "bg-lit/22 font-bold text-text-hi"
                )}
              >
                {day}
              </span>
              {cell && cell.completed_count > 0 && (() => {
                const { size, opacity, full } = starVisual(cell.completed_count);
                return (
                  <svg
                    width={size}
                    height={size}
                    viewBox="0 0 24 24"
                    style={
                      full ? { filter: "drop-shadow(0 0 4px rgb(255 243 196 / .8))" } : undefined
                    }
                  >
                    {/* 별 색은 lit 토큰 하나로 통일하고, 농도만 완료 개수를 나타낸다. */}
                    <path d={STAR_PATH} fill="#FFF3C4" opacity={opacity} />
                  </svg>
                );
              })()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
