"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Common = {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
  /** 라이트 종이 표면(societies/certifications 등)에 놓일 때 - 다크월드
   * 토큰 대신 paper-* 토큰을 쓴다. 기본값 false라 기존 호출부는 그대로. */
  paper?: boolean;
};

export type FieldProps =
  | (Common & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">)
  | (Common & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">);

const CONTROL_DARK =
  "w-full rounded-md border bg-ink-900/60 px-3.5 py-2.5 text-body text-text-hi " +
  "placeholder:text-text-lo transition-colors focus:outline-none " +
  "focus-visible:border-spec-b";
const CONTROL_PAPER =
  "w-full rounded-xl border bg-paper px-3.5 py-2.5 text-body text-paper-ink " +
  "placeholder:text-paper-lo transition-colors focus:outline-none " +
  "focus-visible:border-paper-ink";

export function Field(props: FieldProps) {
  // multiline은 분기 전용 판별자 - rest에 남기면 DOM 속성으로 새서 React 경고가 뜬다.
  const { id, label, error, hint, className, multiline, paper = false, ...rest } = props;
  const CONTROL = paper ? CONTROL_PAPER : CONTROL_DARK;
  const borderTone = error ? "border-spec-m/60" : paper ? "border-paper-line" : "border-rule";
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-caption font-semibold", paper ? "text-paper-lo" : "text-text-lo")}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(CONTROL, borderTone, "min-h-[96px] resize-y")}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(CONTROL, borderTone)}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-spec-m">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className={cn("text-caption", paper ? "text-paper-lo" : "text-text-lo")}>{hint}</p>
      ) : null}
    </div>
  );
}
