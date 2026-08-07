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

interface DashboardQuery {
  interval: ExecutionTimelineInterval;
  feature: string;
  provider: string;
  model: string;
  from: string;
  to: string;
}

/** datetime-local 입력값("YYYY-MM-DDTHH:mm") → API용 ISO(UTC 해석) */
function toApiDate(value: string): string {
  if (!value) {
    return "";
  }
  // 타임존 표기가 없으면 UTC로 해석한다 (Timeline 표준: UTC)
  const iso = /Z|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}:00Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function buildApiQuery(query: DashboardQuery): string {
  const params = new URLSearchParams();
  if (query.feature) params.set("feature", query.feature);
  if (query.provider) params.set("provider", query.provider);
  if (query.model) params.set("model", query.model);
  const from = toApiDate(query.from);
  const to = toApiDate(query.to);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params.toString();
}

/** interval 전환 링크 — 현재 필터를 유지한다 */
function intervalHref(query: DashboardQuery, interval: string): string {
  const params = new URLSearchParams();
  params.set("interval", interval);
  if (query.feature) params.set("feature", query.feature);
  if (query.provider) params.set("provider", query.provider);
  if (query.model) params.set("model", query.model);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return `/executions?${params.toString()}`;
}

/**
 * Execution Dashboard (TASK-0701 · 필터 TASK-0702, Sprint 7) —
 * Stats API(합계·차원별) + Timeline API(시간 축)를 소비하는 운영 대시보드.
 */
export default async function ExecutionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    interval?: string;
    feature?: string;
    provider?: string;
    model?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const raw = await searchParams;
  const query: DashboardQuery = {
    interval: (EXECUTION_TIMELINE_INTERVALS as readonly string[]).includes(
      raw.interval ?? "",
    )
      ? (raw.interval as ExecutionTimelineInterval)
      : "day",
    feature: raw.feature ?? "",
    provider: raw.provider ?? "",
    model: raw.model ?? "",
    from: raw.from ?? "",
    to: raw.to ?? "",
  };
  const interval = query.interval;
  const filterQuery = buildApiQuery(query);
  const suffix = filterQuery ? `&${filterQuery}` : "";

  const [stats, timeline] = await Promise.all([
    fetchJson<ExecutionDashboardDto>(
      `/executions/stats?${filterQuery}`,
    ),
    fetchJson<ExecutionTimelineDto>(
      `/executions/timeline?interval=${interval}${suffix}`,
    ),
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

      {/* Dashboard Filter (TASK-0702) — GET 폼, 서버 컴포넌트 유지 */}
      <form
        method="GET"
        action="/executions"
        data-testid="dashboard-filter"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
      >
        <input type="hidden" name="interval" value={interval} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Feature</span>
          <select
            name="feature"
            defaultValue={query.feature}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          >
            <option value="">전체</option>
            <option value="content-generation">content-generation</option>
            <option value="product-analysis">product-analysis</option>
            <option value="vision-analysis">vision-analysis</option>
            <option value="design-review">design-review</option>
            <option value="dev">dev</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Provider</span>
          <input
            name="provider"
            defaultValue={query.provider}
            placeholder="예: mock, openai"
            className="w-36 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Model</span>
          <input
            name="model"
            defaultValue={query.model}
            placeholder="예: gpt-4o"
            className="w-36 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">From (UTC)</span>
          <input
            type="datetime-local"
            name="from"
            defaultValue={query.from}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">To (UTC)</span>
          <input
            type="datetime-local"
            name="to"
            defaultValue={query.to}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          필터 적용
        </button>
        <Link
          href="/executions"
          className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          초기화
        </Link>
      </form>

      {stats === null ? (
        <div
          data-testid="dashboard-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          API에 연결할 수 없습니다. API 서버(4000)와 DB 상태를 확인해 주세요.
        </div>
      ) : (
        <>
          <section
            data-testid="kpi-cards"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
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
                    href={intervalHref(query, item)}
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
