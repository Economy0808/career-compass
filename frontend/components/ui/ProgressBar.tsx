import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  value: number; // 0-100
  tone?: "growth" | "altitude";
  className?: string;
}

export function ProgressBar({ value, tone = "growth", className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-rule/60", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "growth" ? "bg-spec-a" : "bg-[linear-gradient(90deg,#9DB4FF,#FFF3C4)]"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
