import type { Metadata } from "next";
import Link from "next/link";
import { EXECUTION_TIMELINE_INTERVALS } from "@acos/shared";
import type {
  ExecutionDashboardDto,
  ExecutionGroupStatsDto,
  ExecutionTimelineDto,
  ExecutionTimelineInterval,
} from "@acos/shared";
import {
  formatCost,
  formatCount,
  formatLatency,
  formatRate,
} from "./format";
import { TimelineChart } from "./timeline-chart";

export const metadata: Metadata = {
  title: "실행 대시보드 | AI Product Content OS",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function StatsTable({
  title,
  groups,
}: {
  title: string;
  groups: ExecutionGroupStatsDto[];
}) {
  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">{title}</h2>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">데이터가 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">이름</th>
                <th className="py-1 pr-3 font-medium">호출</th>
                <th className="py-1 pr-3 font-medium">성공률</th>
                <th className="py-1 pr-3 font-medium">실패</th>
                <th className="py-1 pr-3 font-medium">토큰(입력/출력)</th>
                <th className="py-1 pr-3 font-medium">비용</th>
                <th className="py-1 pr-3 font-medium">평균 지연</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ key, stats }) => (
                <tr
                  key={key}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="py-1.5 pr-3 font-mono text-xs">{key}</td>
                  <td className="py-1.5 pr-3">{formatCount(stats.count)}</td>
                  <td className="py-1.5 pr-3">{formatRate(stats.successRate)}</td>
                  <td className="py-1.5 pr-3">{formatCount(stats.failedCount)}</td>
                  <td className="py-1.5 pr-3">
                    {formatCount(stats.inputTokens)} / {formatCount(stats.outputTokens)}
                  </td>
                  <td className="py-1.5 pr-3">{formatCost(stats.cost)}</td>
                  <td className="py-1.5 pr-3">{formatLatency(stats.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Execution Dashboard (TASK-0701, Sprint 7) — Stats API(합계·차원별) +
 * Timeline API(시간 축)를 소비하는 운영 대시보드.
 */
export default async function ExecutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ interval?: string }>;
}) {
  const { interval: rawInterval } = await searchParams;
  const interval: ExecutionTimelineInterval = (
    EXECUTION_TIMELINE_INTERVALS as readonly string[]
  ).includes(rawInterval ?? "")
    ? (rawInterval as ExecutionTimelineInterval)
    : "day";

  const [stats, timeline] = await Promise.all([
    fetchJson<ExecutionDashboardDto>("/executions/stats"),
    fetchJson<ExecutionTimelineDto>(`/executions/timeline?interval=${interval}`),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">실행 대시보드</h1>
        <p className="mt-1 text-sm text-zinc-500">
          모든 LLM 호출의 운영 지표 — Execution Domain (기록·집계·추이)
        </p>
      </div>

      {stats === null ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          API에 연결할 수 없습니다. API 서버(4000)와 DB 상태를 확인해 주세요.
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="호출 수"
              value={formatCount(stats.totals.count)}
              sub={`성공 ${formatCount(stats.totals.successCount)} · 실패 ${formatCount(stats.totals.failedCount)}`}
            />
            <KpiCard
              label="성공률"
              value={formatRate(stats.totals.successRate)}
              sub={`실패율 ${formatRate(stats.totals.failureRate)}`}
            />
            <KpiCard
              label="토큰"
              value={`${formatCount(stats.totals.inputTokens + stats.totals.outputTokens)}`}
              sub={`입력 ${formatCount(stats.totals.inputTokens)} · 출력 ${formatCount(stats.totals.outputTokens)}`}
            />
            <KpiCard
              label="비용 / 지연"
              value={formatCost(stats.totals.cost)}
              sub={`평균 ${formatLatency(stats.totals.avgLatencyMs)} · 최대 ${formatLatency(stats.totals.maxLatencyMs)}`}
            />
          </section>

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Timeline</h2>
              <div className="flex gap-1 text-xs">
                {EXECUTION_TIMELINE_INTERVALS.map((item) => (
                  <Link
                    key={item}
                    href={`/executions?interval=${item}`}
                    className={
                      item === interval
                        ? "rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    }
                  >
                    {item}
                  </Link>
                ))}
              </div>
            </div>
            <div className="mt-4">
              {timeline === null ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  Timeline을 불러올 수 없습니다.
                </p>
              ) : (
                <TimelineChart buckets={timeline.buckets} interval={interval} />
              )}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-1">
            <StatsTable title="Feature별 통계" groups={stats.byFeature} />
            <StatsTable title="Provider별 통계" groups={stats.byProvider} />
            <StatsTable title="Model별 통계" groups={stats.byModel} />
          </div>
        </>
      )}
    </main>
  );
}
