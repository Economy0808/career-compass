"use client";

import { motion } from "framer-motion";

export function ProgressBar({
  value,
  size = "md",
  showLabel = false,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const height = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";

  return (
    <div className="flex items-center gap-2">
      <div className={`w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800 ${height}`}>
        <motion.div
          className={`${height} rounded-full ${clamped >= 100 ? "bg-accent-500" : "bg-progress-500"}`}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
      {showLabel && (
        <span className="shrink-0 text-xs font-medium text-muted tabular-nums">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}
