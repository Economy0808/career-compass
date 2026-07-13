import type { MilestoneStatus } from "@/lib/types";

const STYLES: Record<MilestoneStatus, string> = {
  완료: "bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-200",
  기한초과: "bg-overdue-400/15 text-overdue-600 dark:text-overdue-400",
  진행중: "bg-progress-400/15 text-progress-600 dark:text-progress-400",
};

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
