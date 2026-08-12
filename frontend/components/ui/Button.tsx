"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-goal text-white hover:brightness-110 border border-transparent",
  secondary: "bg-goal/12 text-goal-bright border border-line-strong hover:bg-goal/20",
  ghost: "bg-transparent text-content-secondary border border-line hover:bg-goal/10",
  danger: "bg-transparent text-wither border border-wither/45 hover:bg-wither/12",
};

const SIZE: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-caption rounded-sm",
  md: "px-5 py-2.5 text-body-sm rounded-md",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
        "transition-[filter,background-color,border-color] duration-150",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    />
  );
}
