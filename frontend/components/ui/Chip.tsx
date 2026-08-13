"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "goal" | "growth" | "bloom" | "wither" | "neutral";

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  selected?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

const TONE: Record<Tone, { on: string; off: string }> = {
  goal: { on: "bg-goal/18 text-goal-bright border-line-strong", off: "text-content-muted border-line" },
  growth: { on: "bg-growth/18 text-growth-bright border-growth/45", off: "text-content-muted border-line" },
  bloom: { on: "bg-bloom/15 text-bloom border-bloom/40", off: "text-content-muted border-line" },
  wither: { on: "bg-wither/15 text-wither border-wither/40", off: "text-content-muted border-line" },
  neutral: { on: "bg-white/8 text-content-primary border-line-strong", off: "text-content-muted border-line" },
};

export function Chip({
  children, tone = "goal", selected = false, interactive = false,
  disabled = false, onClick, title, className,
}: ChipProps) {
  const base = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border",
    "px-4 py-1.5 text-caption font-semibold transition-colors",
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
