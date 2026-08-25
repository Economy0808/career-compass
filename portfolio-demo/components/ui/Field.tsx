"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Common = {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
};

export type FieldProps =
  | (Common & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">)
  | (Common & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">);

const CONTROL =
  "w-full rounded-md border bg-black/25 px-3.5 py-2.5 text-body text-content-primary " +
  "placeholder:text-content-muted transition-colors focus:outline-none " +
  "focus-visible:border-goal-bright";

export function Field(props: FieldProps) {
  const { id, label, error, hint, className, ...rest } = props;
  const borderTone = error ? "border-wither/60" : "border-line";
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-caption font-semibold text-content-secondary">
        {label}
      </label>
      {"multiline" in props && props.multiline ? (
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
        <p id={`${id}-error`} className="text-caption text-wither">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}
