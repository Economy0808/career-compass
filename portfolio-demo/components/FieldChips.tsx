"use client";

import { useEffect, useState } from "react";
import { Card, Chip } from "@/components/ui";
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
    <Card data-testid="field-chips" className="mb-3.5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body-sm font-semibold text-content-primary">
          어떤 밭에 심을까요?
        </span>
        <span className="text-caption text-content-muted">
          최대 {MAX_FIELD_SELECTION}개 · 선택 안 해도 괜찮아요
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[...featured, ...visibleRest].map((c) => {
          const on = selected.includes(c.code);
          // 상한에 걸린 미선택 칩은 흐리게 — 왜 안 눌리는지 보이게 한다
          const muted = !on && atLimit;
          return (
            <Chip
              key={c.code}
              interactive
              selected={on}
              disabled={disabled || muted}
              onClick={() => toggle(c.code)}
            >
              {c.name}
            </Chip>
          );
        })}

        {!expanded && rest.length > 0 && (
          <Chip
            interactive
            disabled={disabled}
            onClick={() => setExpanded(true)}
            className="border-dashed"
          >
            기타 {rest.length}개 +
          </Chip>
        )}
      </div>

      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2.5 text-caption text-content-muted hover:text-content-secondary"
        >
          접기
        </button>
      )}
    </Card>
  );
}
