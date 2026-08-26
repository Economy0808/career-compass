"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-rule bg-ink-800/70 p-4 backdrop-blur-[2px]",
        interactive &&
          "cursor-pointer transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-rule/80",
        className
      )}
      {...rest}
    />
  );
}
