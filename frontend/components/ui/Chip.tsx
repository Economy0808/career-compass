"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// 톤은 항성 분광형 악센트를 그대로 쓴다: goal/growth/bloom/wither라는
// 옛 이름을 그대로 유지해 이 Chip을 쓰는 다른 화면(app/**)이 깨지지 않게
// 하면서, 내부 색상만 새 spec 토큰으로 교체한다.
type Tone = "goal" | "growth" | "bloom" | "wither" | "neutral";
type Size = "sm" | "md";

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  selected?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

const TONE: Record<Tone, { on: string; off: string }> = {
  goal: { on: "bg-spec-b/18 text-spec-b border-rule", off: "text-text-lo border-rule" },
  growth: { on: "bg-spec-a/18 text-spec-a border-spec-a/45", off: "text-text-lo border-rule" },
  bloom: { on: "bg-spec-g/15 text-spec-g border-spec-g/40", off: "text-text-lo border-rule" },
  wither: { on: "bg-spec-m/15 text-spec-m border-spec-m/40", off: "text-text-lo border-rule" },
  neutral: { on: "bg-text-hi/8 text-text-hi border-rule", off: "text-text-lo border-rule" },
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-0.5 text-micro",
  md: "px-4 py-1.5 text-caption",
};

export function Chip({
  children, tone = "goal", size = "md", selected = false, interactive = false,
  disabled = false, onClick, title, className,
}: ChipProps) {
  const base = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border",
    "font-semibold transition-colors",
    SIZE[size],
    selected ? TONE[tone].on : TONE[tone].off,
    interactive && !selected && !disabled && "hover:bg-white/6",
    disabled && "cursor-not-allowed opacity-40",
    className
  );

  if (interactive || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-pressed={selected}
        className={base}
      >
        {children}
      </button>
    );
  }
  return <span title={title} className={base}>{children}</span>;
}
