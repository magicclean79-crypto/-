"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ExecutionDashboardDto,
  ExperimentKindDto,
  LlmExperimentsDto,
} from "@acos/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const KIND_LABEL: Record<ExperimentKindDto, string> = {
  percentage: "Percentage",
  ab: "A/B",
  canary: "Canary",
  weighted: "Weighted",
};

const KIND_STYLE: Record<ExperimentKindDto, string> = {
  percentage: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  ab: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  canary:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  weighted:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/**
 * Experiment Dashboard (TASK-1003) —
 * feature별 트래픽 분배 실험(Percentage / A·B / Canary / Weighted)의
 * 설정 비율과 **실제 배정 비율**, 그리고 변형별 품질·비용 지표를 함께 본다.
 */
export default function ExperimentsPage() {
  const [data, setData] = useState<LlmExperimentsDto | null>(null);
  const [stats, setStats] = useState<ExecutionDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [experimentsRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/llm/experiments`),
          fetch(`${API_URL}/executions/stats`),
        ]);
        if (!experimentsRes.ok) {
          setError(`조회 실패 (HTTP ${experimentsRes.status})`);
          return;
        }
        setData((await experimentsRes.json()) as LlmExperimentsDto);
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
          Experiment 현황
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Routing Experiment & Traffic Control — 트래픽 분배 설정과 실제 결과
        </p>
      </div>

      {error ? (
        <div
          data-testid="experiments-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <p className="text-xs text-zinc-500" data-testid="experiments-summary">
            사용 가능 Provider{" "}
            <span className="font-mono">
              {data.availableProviders.join(", ")}
            </span>{" "}
            · 실험{" "}
            <span className="font-mono">{data.experiments.length}건</span>
          </p>

          {data.experiments.length === 0 ? (
            <div
              data-testid="experiments-empty"
              className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800"
            >
              설정된 실험이 없습니다. 기존 Routing 설정대로 호출됩니다 —{" "}
              <span className="font-mono">LLM_EXPERIMENT_CONTENT</span> /{" "}
              <span className="font-mono">LLM_EXPERIMENT_ANALYSIS</span> /{" "}
              <span className="font-mono">LLM_EXPERIMENT_VISION</span> 로
              설정합니다 (예{" "}
              <span className="font-mono">openai=90,anthropic=10</span>).
            </div>
          ) : null}

          {data.experiments.map((experiment) => (
            <section
              key={experiment.feature}
              data-testid="experiment-card"
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{experiment.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${KIND_STYLE[experiment.kind]}`}
                >
                  {KIND_LABEL[experiment.kind]}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    experiment.active
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {experiment.active ? "적용 중" : "미적용"}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                <span className="font-mono">{experiment.feature}</span> ·{" "}
                <span className="font-mono">{experiment.env}</span> · 배정{" "}
                <span className="font-mono">{experiment.assignments}건</span>
              </p>
              {experiment.reason ? (
                <p
                  data-testid="experiment-reason"
                  className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                >
                  {experiment.reason}
                </p>
              ) : null}

              <div className="mt-3 overflow-x-auto">
                <table
                  className="w-full text-left text-sm"
                  data-testid="experiment-variants"
                >
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">변형</th>
                      <th className="py-1 pr-3 font-medium">설정 비율</th>
                      <th className="py-1 pr-3 font-medium">배정 비율</th>
                      <th className="py-1 pr-3 font-medium">실제 배정</th>
                      <th className="py-1 pr-3 font-medium">실행 호출</th>
                      <th className="py-1 pr-3 font-medium">성공률</th>
                      <th className="py-1 pr-3 font-medium">평균 지연</th>
                      <th className="py-1 pr-3 font-medium">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.variants.map((variant) => {
                      // Execution 기준 변형 지표 — 모델 미지정 변형은 Provider
                      // 기본 모델로 기록되므로 접두사로 맞춘다
                      const measured = stats?.byVariant.find((group) =>
                        variant.model
                          ? group.key ===
                            `${experiment.feature}→${variant.provider}:${variant.model}`
                          : group.key.startsWith(
                              `${experiment.feature}→${variant.provider}:`,
                            ),
                      );
                      return (
                        <tr
                          key={variant.key}
                          data-testid="experiment-variant-row"
                          className="border-t border-zinc-100 dark:border-zinc-800"
                        >
                          <td className="py-1.5 pr-3 font-mono text-xs">
                            {variant.key}
                            {variant.available ? null : (
                              <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                사용 불가
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {percent(variant.weightShare)}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {percent(variant.effectiveShare)}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {percent(variant.actualShare)}
                            <span className="ml-1 text-xs text-zinc-500">
                              ({variant.assignments})
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {measured?.stats.count ?? 0}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {measured?.stats.successRate == null
                              ? "—"
                              : `${(measured.stats.successRate * 100).toFixed(1)}%`}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {measured?.stats.avgLatencyMs == null
                              ? "—"
                              : `${Math.round(measured.stats.avgLatencyMs)}ms`}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">
                            {measured?.stats.cost == null
                              ? "미산정"
                              : `$${Number(measured.stats.cost).toFixed(4)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="text-xs text-zinc-500">
            배정 비율은 사용 불가 변형을 제외하고 재정규화한 값입니다. 실제
            배정은 프로세스 시작 이후 누적(추첨 결과)이고, 실행 호출·성공률·
            비용은 Execution 이력(전체 기간) 기준입니다. 변형이 불건강해지면
            Failover가 체인을 재정렬하므로 <strong>배정과 실행이 다를 수
            있습니다</strong> — 두 값의 차이가 곧 변형의 실패 규모입니다.
            설정은 재기동 없이 다음 호출부터 반영됩니다.
          </p>
        </>
      ) : null}
    </main>
  );
}
