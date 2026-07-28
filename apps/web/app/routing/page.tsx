"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ExecutionDashboardDto,
  LlmRoutingDto,
  RoutingSource,
} from "@acos/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const SOURCE_LABEL: Record<RoutingSource, string> = {
  feature: "Feature 매핑",
  default: "기본 Provider",
  fallback: "폴백",
};

const SOURCE_STYLE: Record<RoutingSource, string> = {
  feature:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  default:
    "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  fallback:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

/**
 * Routing Dashboard (TASK-1001) —
 * feature별 Provider 매핑 현황 + 실제 실행된 경로 메트릭.
 */
export default function RoutingPage() {
  const [routing, setRouting] = useState<LlmRoutingDto | null>(null);
  const [stats, setStats] = useState<ExecutionDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [routingRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/llm/routing`),
          fetch(`${API_URL}/executions/stats`),
        ]);
        if (!routingRes.ok) {
          setError(`조회 실패 (HTTP ${routingRes.status})`);
          return;
        }
        setRouting((await routingRes.json()) as LlmRoutingDto);
        if (statsRes.ok) {
          setStats((await statsRes.json()) as ExecutionDashboardDto);
        }
      } catch {
        setError("API 서버에 연결할 수 없습니다.");
      }
    }
    void load();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Routing 현황
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cross-Provider Routing — Feature별 Provider 매핑과 실행 경로 메트릭
        </p>
      </div>

      {error ? (
        <div
          data-testid="routing-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {routing ? (
        <>
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">
              Feature별 Provider 매핑
            </h2>
            <p className="mt-1 text-xs text-zinc-500" data-testid="routing-default">
              기본 Provider{" "}
              <span className="font-mono">{routing.defaultProvider}</span> ·
              사용 가능{" "}
              <span className="font-mono">
                {routing.availableProviders.join(", ")}
              </span>
            </p>
            <div className="mt-3 overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                data-testid="routing-table"
              >
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Feature</th>
                    <th className="py-1 pr-3 font-medium">Provider</th>
                    <th className="py-1 pr-3 font-medium">모델</th>
                    <th className="py-1 pr-3 font-medium">결정</th>
                    <th className="py-1 pr-3 font-medium">환경변수</th>
                  </tr>
                </thead>
                <tbody>
                  {routing.routes.map((route) => (
                    <tr
                      key={route.feature}
                      data-testid="routing-row"
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {route.feature}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {route.provider}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {route.model ?? "(Provider 기본)"}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${SOURCE_STYLE[route.source]}`}
                        >
                          {SOURCE_LABEL[route.source]}
                        </span>
                        {route.reason ? (
                          <span
                            data-testid="routing-reason"
                            className="ml-1.5 text-xs text-amber-700 dark:text-amber-400"
                          >
                            {route.reason}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs text-zinc-500">
                        {route.env}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              값 형식: <span className="font-mono">provider</span> 또는{" "}
              <span className="font-mono">provider:model</span> — 변경은 재기동
              없이 다음 호출부터 반영됩니다.
            </p>
          </section>

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">
              Routing Metrics (실행된 경로 — 전체 기간)
            </h2>
            {stats && stats.byRoute.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table
                  className="w-full text-left text-sm"
                  data-testid="routing-metrics"
                >
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">경로</th>
                      <th className="py-1 pr-3 font-medium">호출</th>
                      <th className="py-1 pr-3 font-medium">성공률</th>
                      <th className="py-1 pr-3 font-medium">평균 지연</th>
                      <th className="py-1 pr-3 font-medium">토큰</th>
                      <th className="py-1 pr-3 font-medium">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byRoute.map((group) => (
                      <tr
                        key={group.key}
                        data-testid="routing-metric-row"
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {group.key}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {group.stats.count}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {group.stats.successRate === null
                            ? "—"
                            : `${(group.stats.successRate * 100).toFixed(1)}%`}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {group.stats.avgLatencyMs === null
                            ? "—"
                            : `${Math.round(group.stats.avgLatencyMs)}ms`}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {group.stats.inputTokens}/{group.stats.outputTokens}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {group.stats.cost === null
                            ? "미산정"
                            : `$${Number(group.stats.cost).toFixed(4)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p
                data-testid="routing-metrics-empty"
                className="mt-2 text-sm text-zinc-500"
              >
                실행 이력이 없습니다.
              </p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
