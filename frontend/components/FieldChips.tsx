"use client";

import { useEffect, useState } from "react";
import { getNcsCategories } from "@/lib/api";
import { MAX_FIELD_SELECTION, type NcsCategory } from "@/lib/types";

/**
 * 관심 분야(NCS 대분류) 복수 선택 칩.
 *
 * 추천 분야만 먼저 펼쳐두고 나머지는 "기타"로 접는다 — 24개를 한 번에 던지면
 * 고르기 전에 질리기 때문. 선택은 어디까지나 선택사항이라, 건너뛰면 서버가
 * 문자열 매칭으로 축소해 로드맵은 그대로 나온다.
 */
export default function FieldChips({
  selected,
  onChange,
  disabled = false,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const [categories, setCategories] = useState<NcsCategory[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getNcsCategories()
      .then((res) => alive && setCategories(res))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // 분야 선택은 부가 기능이라, 못 불러와도 조용히 숨기고 대화를 막지 않는다.
  if (failed || !categories) return null;

  const featured = categories.filter((c) => c.featured);
  const rest = categories.filter((c) => !c.featured);
  // 접혀 있어도 이미 고른 기타 분야는 보여야 한다 (선택이 사라진 것처럼 보이면 안 됨)
  const visibleRest = expanded ? rest : rest.filter((c) => selected.includes(c.code));
  const atLimit = selected.length >= MAX_FIELD_SELECTION;

  function toggle(code: string) {
    if (disabled) return;
    if (selected.includes(code)) onChange(selected.filter((c) => c !== code));
    else if (!atLimit) onChange([...selected, code]);
  }

  return (
    <div
      data-testid="field-chips"
      className="mb-3.5 rounded-2xl border border-[rgba(143,220,138,.14)] bg-[rgba(10,26,15,.85)] px-[17px] py-[15px]"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-[#dcead8]">
          어떤 밭에 심을까요?
        </span>
        <span className="shrink-0 text-[11.5px] text-moss-600">
          최대 {MAX_FIELD_SELECTION}개 · 선택 안 해도 괜찮아요
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[...featured, ...visibleRest].map((c) => {
          const on = selected.includes(c.code);
          // 상한에 걸린 미선택 칩은 흐리게 — 왜 안 눌리는지 보이게 한다
          const muted = !on && atLimit;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => toggle(c.code)}
              disabled={disabled || muted}
              aria-pressed={on}
              className={`rounded-full border px-3.5 py-[7px] text-[12.5px] transition-all duration-150 ${
                on
                  ? "border-bean-400 bg-bean-500 font-semibold text-[#f0f7ec] shadow-[0_2px_12px_rgba(63,143,71,.3)]"
                  : "border-[rgba(143,220,138,.22)] bg-[rgba(255,255,255,.04)] text-moss-300 hover:border-[rgba(143,220,138,.45)] hover:bg-[rgba(143,220,138,.1)]"
              } ${muted ? "cursor-not-allowed opacity-35" : ""} ${
                disabled ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              {c.name}
            </button>
          );
        })}

        {!expanded && rest.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            disabled={disabled}
            className="rounded-full border border-dashed border-[rgba(143,220,138,.3)] px-3.5 py-[7px] text-[12.5px] text-moss-500 transition-colors hover:border-[rgba(143,220,138,.5)] hover:text-moss-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            기타 {rest.length}개 +
          </button>
        )}
      </div>

      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2.5 text-[11.5px] text-moss-600 hover:text-moss-400"
        >
          접기
        </button>
      )}
    </div>
  );
}
