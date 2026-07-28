import type {
  ExecutionTimelineBucketDto,
  ExecutionTimelineInterval,
} from "@acos/shared";
import { bucketLabel, fillTimelineBuckets, formatRate } from "./format";

/**
 * Timeline Chart (TASK-0701) — 외부 차트 라이브러리 없이 CSS 스택 막대로
 * 버킷별 호출 수(성공/실패)를 표시한다. 빈 버킷은 UI에서 보간(CTO 결정).
 */
export function TimelineChart({
  buckets,
  interval,
}: {
  buckets: ExecutionTimelineBucketDto[];
  interval: ExecutionTimelineInterval;
}) {
  const filled = fillTimelineBuckets(buckets, interval);
  if (filled.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">
        표시할 실행 이력이 없습니다.
      </p>
    );
  }

  const maxCount = Math.max(...filled.map((b) => b.stats.count), 1);
  // 라벨은 과밀 방지를 위해 최대 8개만 표시
  const labelEvery = Math.max(1, Math.ceil(filled.length / 8));

  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {filled.map((bucket) => {
          const { count, successCount, failedCount, successRate } =
            bucket.stats;
          const totalPct = (count / maxCount) * 100;
          const failedPct = count > 0 ? (failedCount / count) * 100 : 0;
          return (
            <div
              key={bucket.bucketStart}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${bucketLabel(bucket.bucketStart, interval)} (UTC) — 호출 ${count} · 성공 ${successCount} · 실패 ${failedCount} · 성공률 ${formatRate(successRate)}`}
            >
              {count === 0 ? (
                <div className="h-px w-full rounded bg-zinc-200 dark:bg-zinc-800" />
              ) : (
                <div
                  className="flex w-full flex-col overflow-hidden rounded-t"
                  style={{ height: `${Math.max(totalPct, 3)}%` }}
                >
                  <div
                    className="w-full bg-red-400 dark:bg-red-500"
                    style={{ height: `${failedPct}%` }}
                  />
                  <div className="w-full flex-1 bg-emerald-500 dark:bg-emerald-400" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-zinc-500">
        {filled.map((bucket, index) => (
          <div key={bucket.bucketStart} className="flex-1 truncate text-center">
            {index % labelEvery === 0
              ? bucketLabel(bucket.bucketStart, interval)
              : ""}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          성공
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-400" />
          실패
        </span>
        <span className="ml-auto">시간축: UTC · 빈 버킷은 UI 보간</span>
      </div>
    </div>
  );
}
