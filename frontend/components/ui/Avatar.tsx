"use client";

import { cn } from "@/lib/cn";

export interface AvatarProps {
  emoji: string;
  name?: string;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function Avatar({ emoji, name, size = "sm", onClick }: AvatarProps) {
  const content = (
    <>
      <span className={size === "sm" ? "text-body" : "text-title"}>{emoji}</span>
      {name && <span className="truncate text-caption text-content-secondary">{name}</span>}
    </>
  );
  const base = "inline-flex min-w-0 items-center gap-2";
  if (!onClick) return <span className={base}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(base, "rounded-full transition-colors hover:text-content-primary")}
    >
      {content}
    </button>
  );
}
