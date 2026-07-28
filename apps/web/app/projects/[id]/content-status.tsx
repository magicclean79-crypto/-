import type { ContentStatus } from "@acos/shared";

/** 발행 상태 배지 (TASK-0704) — 상태별 색상 고정 */
const BADGE_STYLES: Record<ContentStatus, string> = {
  DRAFT:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  REVIEW: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  PUBLISHED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  ARCHIVED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span
      data-testid="content-status-badge"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
