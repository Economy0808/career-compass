import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-3xl border border-border bg-surface p-5 shadow-soft dark:shadow-softDark ${className}`}
      {...props}
    />
  );
}
