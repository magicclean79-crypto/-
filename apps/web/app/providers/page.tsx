"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  BudgetWindowStatusDto,
  ExecutionDashboardDto,
  LlmBudgetDto,
  LlmProvidersDto,
} from "@acos/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const CONNECTION_LABEL: Record<string, string> = {
  official: "공식 연결",
  "adapter-ready": "어댑터 준비",
  mock: "Mock",
};

const BUDGET_LABEL: Record<string, string> = {
  off: "미설정 (무제한)",
  ok: "정상",
  alert: "경고",
  exceeded: "초과 — 호출 차단",
};

function usd(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(4)}`;
}

function BudgetCard({
  title,
  window,
  testId,
}: {
  title: string;
  window: BudgetWindowStatusDto;
  testId: string;
}) {
  const percent =
    window.ratio === null ? 0 : Math.min(100, Math.round(window.ratio * 100));
  const barColor =
    window.status === "exceeded"
      ? "bg-red-500"
      : window.status === "alert"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const badgeColor =
    window.status === "exceeded"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      : window.status === "alert"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : window.status === "ok"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <div
      data-testid={testId}
      className="flex-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${badgeColor}`}>
          {BUDGET_LABEL[window.status]}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">
        {usd(window.spend)}
        <span className="ml-1 text-sm font-normal text-zinc-500">
          / {window.budget === null ? "무제한" : usd(window.budget)}
        </span>
      </p>
      {window.budget !== null ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Provider Dashboard (TASK-0902) —
 * Provider Registry · Model Routing · 비용 예산(Cost Governance) 현황.
 */
export default function ProvidersPage() {
  const [providers, setProviders] = useState<LlmProvidersDto | null>(null);
  const [budget, setBudget] = useState<LlmBudgetDto | null>(null);
  const [stats, setStats] = useState<ExecutionDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [providersRes, budgetRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/llm/providers`),
          fetch(`${API_URL}/llm/budget`),
          fetch(`${API_URL}/executions/stats`),
        ]);
        if (!providersRes.ok || !budgetRes.ok) {
          setError(`조회 실패 (HTTP ${providersRes.status})`);
          return;
        }
        setProviders((await providersRes.json()) as LlmProvidersDto);
        setBudget((await budgetRes.json()) as LlmBudgetDto);
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
          Provider 현황
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Provider Registry · Model Routing · 비용 예산 (Cost Governance)
        </p>
      </div>

      {error ? (
        <div
          data-testid="providers-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {budget ? (
        <section className="flex flex-col gap-3 sm:flex-row">
          <BudgetCard
            title="일간 예산 (UTC)"
            window={budget.daily}
            testId="budget-daily"
          />
          <BudgetCard
            title="월간 예산 (UTC)"
            window={budget.monthly}
            testId="budget-monthly"
          />
        </section>
      ) : null}

      {providers ? (
        <>
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">
              선택된 Provider와 Model Routing
            </h2>
            <p className="mt-2 text-sm" data-testid="selected-provider">
              <span className="font-mono">{providers.selected.provider}</span>{" "}
              · 기본 모델{" "}
              <span className="font-mono">
                {providers.selected.defaultModel}
              </span>
            </p>
            <table className="mt-3 w-full text-left text-sm" data-testid="routing-table">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Feature</th>
                  <th className="py-1 pr-3 font-medium">라우팅 모델</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(providers.routing).map(([feature, model]) => (
                  <tr
                    key={feature}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs">{feature}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {model ?? "(Provider 기본)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">Provider Registry</h2>
            <div className="mt-3 overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                data-testid="providers-table"
              >
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Provider</th>
                    <th className="py-1 pr-3 font-medium">연결</th>
                    <th className="py-1 pr-3 font-medium">키</th>
                    <th className="py-1 pr-3 font-medium">기본 모델</th>
                    <th className="py-1 pr-3 font-medium">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.providers.map((item) => (
                    <tr
                      key={item.name}
                      data-testid="provider-row"
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 pr-3">
                        {item.title}
                        {item.selected ? (
                          <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                            선택됨
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            item.connection === "official"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : item.connection === "adapter-ready"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {CONNECTION_LABEL[item.connection]}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-xs">
                        {item.name === "mock"
                          ? "불필요"
                          : item.keyConfigured
                            ? "설정됨"
                            : "미설정"}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {item.defaultModel}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">
                        {item.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {stats && stats.byProvider.length > 0 ? (
        <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">
            Provider 비교 (전체 기간 — 성공률·지연·비용)
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table
              className="w-full text-left text-sm"
              data-testid="provider-stats"
            >
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Provider</th>
                  <th className="py-1 pr-3 font-medium">호출</th>
                  <th className="py-1 pr-3 font-medium">성공률</th>
                  <th className="py-1 pr-3 font-medium">평균 지연</th>
                  <th className="py-1 pr-3 font-medium">토큰 (입력/출력)</th>
                  <th className="py-1 pr-3 font-medium">비용</th>
                  <th className="py-1 pr-3 font-medium">비용/호출</th>
                </tr>
              </thead>
              <tbody>
                {stats.byProvider.map((group) => (
                  <tr
                    key={group.key}
                    data-testid="provider-compare-row"
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
                    <td className="py-1.5 pr-3 tabular-nums">
                      {group.stats.cost === null || group.stats.count === 0
                        ? "—"
                        : `$${(Number(group.stats.cost) / group.stats.count).toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
