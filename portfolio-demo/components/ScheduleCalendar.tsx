"use client";

import { ChevronRightIcon } from "@/components/ui";
import { cn } from "@/lib/cn";
import { localISODate, todayISODate } from "@/lib/format";
import type { CalendarDayOut } from "@/lib/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const BEAN_PATH =
  "M8 4.5C4.8 6.2 4 11 6.6 14.8c2.7 3.9 8 5.6 11.6 3.9 3.3-1.6 4-6.4 1.4-10.2C17 4.6 11.3 2.8 8 4.5Z";

// 하루 완료 목표 = 6개. 6에 가까울수록 콩이 커지고 선명해진다.
const DAY_GOAL = 6;

/** 완료 개수(1~6) → 콩 크기/불투명도. 6에서 최대. */
function beanVisual(count: number): { size: number; opacity: number; full: boolean } {
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
    <div className="rounded-lg border border-line bg-surface-raised p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          className="rounded-full p-1.5 text-content-muted transition-colors hover:bg-white/8 hover:text-content-primary"
          aria-label="이전 달"
        >
          <ChevronRightIcon size={18} className="rotate-180" />
        </button>
        <div className="font-serif text-heading font-bold text-content-primary">
          {year}년 {month}월
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded-full p-1.5 text-content-muted transition-colors hover:bg-white/8 hover:text-content-primary"
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
              i === 0 ? "text-[#c98a8a]" : i === 6 ? "text-[#8aa9c9]" : "text-content-muted"
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
                  ? "border-line-strong bg-goal/18 text-content-primary"
                  : "border-transparent text-content-secondary hover:bg-white/6"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full",
                  isToday && "bg-growth/22 font-bold text-content-primary"
                )}
              >
                {day}
              </span>
              {cell && cell.completed_count > 0 && (() => {
                const { size, opacity, full } = beanVisual(cell.completed_count);
                return (
                  <svg
                    width={size}
                    height={size}
                    viewBox="0 0 24 24"
                    style={
                      full ? { filter: "drop-shadow(0 0 4px rgb(226 185 79 / .8))" } : undefined
                    }
                  >
                    {/* 콩 색은 growth 하나로 통일하고, 농도만 완료 개수를 나타낸다. */}
                    <path d={BEAN_PATH} fill="#5db35b" opacity={opacity} />
                    {full && (
                      <path
                        d="M10 8c1.4 1 3.8 3 4.8 5.4"
                        fill="none"
                        stroke="#eef0c8"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    )}
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
