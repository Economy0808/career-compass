"use client";

import { motion } from "framer-motion";
import type { MilestoneOut } from "@/lib/types";
import { formatDateKo } from "@/lib/format";
import { MilestoneStatusBadge } from "./MilestoneStatusBadge";

export function MilestoneItem({
  milestone,
  pending,
  onToggle,
}: {
  milestone: MilestoneOut;
  pending: boolean;
  onToggle: () => void;
}) {
  const isDone = milestone.status === "완료";

  return (
    <motion.div
      layout
      className="flex items-start gap-3 rounded-3xl border border-border bg-surface p-4 shadow-soft"
    >
      <motion.button
        type="button"
        onClick={onToggle}
        disabled={pending}
        whileTap={{ scale: 0.85 }}
        className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-50 ${
          isDone
            ? "border-accent-500 bg-accent-500 text-white"
            : "border-ink-300 dark:border-ink-600"
        }`}
        aria-label={isDone ? "완료 취소" : "완료로 표시"}
      >
        <motion.span
          key={isDone ? (milestone.completed_at ?? "done") : "empty"}
          initial={{ scale: isDone ? 0.3 : 1, opacity: isDone ? 0 : 1 }}
          animate={{ scale: 1, opacity: isDone ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 14 }}
          className="text-xs font-bold"
        >
          ✓
        </motion.span>
      </motion.button>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className={`text-sm font-medium ${isDone ? "text-muted line-through" : ""}`}>
            {milestone.title}
          </h3>
          <MilestoneStatusBadge status={milestone.status} />
        </div>
        <p className="text-xs text-muted">{milestone.description}</p>
        <p className="text-xs text-ink-400">{formatDateKo(milestone.due_date)} 마감</p>
      </div>
    </motion.div>
  );
}
