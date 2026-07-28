"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ExecutionDashboardDto,
  ExperimentActionDto,
  ExperimentAnalyticsDto,
  ExperimentAssignmentsDto,
  ExperimentKindDto,
  ExperimentStatusDto,
  RecommendationBasisDto,
  LlmExperimentsDto,
} from "@acos/shared";
import { authFetchInit } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<ExperimentStatusDto, string> = {
  RUNNING: "진행 중",
  STOPPED: "중단됨",
  PROMOTED: "승자 확정",
};

const STATUS_STYLE: Record<ExperimentStatusDto, string> = {
  RUNNING:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  STOPPED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  PROMOTED:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
};

const ACTION_LABEL: Record<ExperimentActionDto, string> = {
  START: "시작",
  STOP: "중단",
  PROMOTE: "승격",
  ROLLBACK: "되돌리기",
};

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

const BASIS_LABEL: Record<RecommendationBasisDto, string> = {
  "success-rate": "성공률",
  cost: "비용",
  latency: "지연",
  "insufficient-data": "판단 보류",
  "no-variants": "대상 없음",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** 기준 대비 증감 — 부호를 붙여 방향을 분명히 한다 */
function delta(value: number | null, format: (v: number) => string): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${format(value)}`;
}

/**
 * Experiment Dashboard (TASK-1003) —
 * feature별 트래픽 분배 실험(Percentage / A·B / Canary / Weighted)의
 * 설정 비율과 **실제 배정 비율**, 그리고 변형별 품질·비용 지표를 함께 본다.
 */
export default function ExperimentsPage() {
  const [data, setData] = useState<LlmExperimentsDto | null>(null);
  const [stats, setStats] = useState<ExecutionDashboardDto | null>(null);
  const [assignments, setAssignments] =
    useState<ExperimentAssignmentsDto | null>(null);
  const [analytics, setAnalytics] = useState<
    Record<string, ExperimentAnalyticsDto>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [experimentsRes, statsRes, assignmentsRes] = await Promise.all([
        fetch(`${API_URL}/llm/experiments`),
        fetch(`${API_URL}/executions/stats`),
        fetch(`${API_URL}/llm/experiments/assignments`),
      ]);
      if (!experimentsRes.ok) {
        setError(`조회 실패 (HTTP ${experimentsRes.status})`);
        return;
      }
      setError(null);
      const experiments = (await experimentsRes.json()) as LlmExperimentsDto;
      setData(experiments);

      // 실험별 분석 (TASK-1102) — 실패한 건은 건너뛰고 나머지를 표시한다
      const analyzed = await Promise.all(
        experiments.experiments.map(async (experiment) => {
          const response = await fetch(
            `${API_URL}/llm/experiments/${experiment.feature}/analytics`,
          );
          return response.ok
            ? ((await response.json()) as ExperimentAnalyticsDto)
            : null;
        }),
      );
      setAnalytics(
        Object.fromEntries(
          analyzed
            .filter((item): item is ExperimentAnalyticsDto => item !== null)
            .map((item) => [item.feature, item]),
        ),
      );

      if (statsRes.ok) {
        setStats((await statsRes.json()) as ExecutionDashboardDto);
      }
      if (assignmentsRes.ok) {
        setAssignments(
          (await assignmentsRes.json()) as ExperimentAssignmentsDto,
        );
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    }
  }

  // 최초 1회만 조회한다 (이후는 상태 전이 후 load()로 갱신)
  useEffect(() => {
    void load();
  }, []);

  /** 상태 전이 — Start / Stop / Promote / Rollback (쓰기 API, EDITOR 이상) */
  async function transition(
    feature: string,
    action: ExperimentActionDto,
    variantKey?: string,
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(
        `${API_URL}/llm/experiments/${feature}/${action.toLowerCase()}`,
        authFetchInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(variantKey ? { variantKey } : {}),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setNotice(
          `${ACTION_LABEL[action]} 실패 (HTTP ${response.status}) — ${body?.message ?? "권한 또는 요청을 확인해 주세요."}`,
        );
        return;
      }
      setNotice(
        `${feature} 실험을 ${ACTION_LABEL[action]}했습니다${variantKey ? ` (승자 ${variantKey})` : ""}.`,
      );
      await load();
    } catch {
      setNotice("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

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

      {notice ? (
        <div
          data-testid="experiments-notice"
          className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {notice}
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
                  data-testid="experiment-status"
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[experiment.lifecycle.status]}`}
                >
                  {STATUS_LABEL[experiment.lifecycle.status]}
                  {experiment.lifecycle.promotedVariant
                    ? ` · ${experiment.lifecycle.promotedVariant}`
                    : ""}
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
                <span className="font-mono">{experiment.assignments}건</span> ·
                고정 배정 프로젝트{" "}
                <span className="font-mono">
                  {experiment.lifecycle.assignmentCount}개
                </span>
              </p>

              {/* Lifecycle 조작 (TASK-1101) — 쓰기 API, EDITOR 이상 */}
              <div
                className="mt-3 flex flex-wrap items-center gap-2"
                data-testid="lifecycle-controls"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(experiment.feature, "START")}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  시작
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(experiment.feature, "STOP")}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  중단
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(experiment.feature, "ROLLBACK")}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  되돌리기
                </button>
                <span className="ml-1 text-xs text-zinc-500">승격:</span>
                {experiment.variants
                  .filter((variant) => variant.available)
                  .map((variant) => (
                    <button
                      key={variant.key}
                      type="button"
                      disabled={busy}
                      data-testid="promote-button"
                      onClick={() =>
                        void transition(
                          experiment.feature,
                          "PROMOTE",
                          variant.key,
                        )
                      }
                      className="rounded-lg border border-indigo-300 px-2.5 py-1 font-mono text-xs text-indigo-800 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
                    >
                      {variant.key}
                    </button>
                  ))}
              </div>

              {experiment.lifecycle.events.length > 0 ? (
                <details className="mt-2" data-testid="lifecycle-history">
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    상태 변경 이력 {experiment.lifecycle.events.length}건
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {experiment.lifecycle.events.map((event) => (
                      <li key={event.id} className="text-xs text-zinc-500">
                        <span className="font-mono">
                          {ACTION_LABEL[event.action]}
                        </span>{" "}
                        {event.fromStatus} → {event.toStatus}
                        {event.toVariant ? ` (${event.toVariant})` : ""}
                        {event.actor ? ` · ${event.actor}` : ""} ·{" "}
                        {new Date(event.createdAt).toLocaleString("ko-KR")}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {experiment.reason ? (
                <p
                  data-testid="experiment-reason"
                  className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                >
                  {experiment.reason}
                </p>
              ) : null}

              {analytics[experiment.feature] ? (
                <div
                  className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"
                  data-testid="experiment-analytics"
                >
                  {(() => {
                    const report = analytics[experiment.feature];
                    const { recommendation } = report;
                    return (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold">
                            승자 추천
                          </span>
                          <span
                            data-testid="recommendation-basis"
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              recommendation.conclusive
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            }`}
                          >
                            {recommendation.winner
                              ? `${recommendation.winner} · ${BASIS_LABEL[recommendation.basis]}`
                              : BASIS_LABEL[recommendation.basis]}
                          </span>
                          <span className="text-xs text-zinc-500">
                            신뢰도{" "}
                            <span
                              className="font-mono"
                              data-testid="recommendation-confidence"
                            >
                              {percent(recommendation.confidence)}
                            </span>
                            {recommendation.conclusive ? " · 통계적 확정" : " · 참고"}
                          </span>
                        </div>
                        <p
                          className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"
                          data-testid="recommendation-reason"
                        >
                          {recommendation.reason}
                        </p>
                        {report.comparisons.length > 0 ? (
                          <div className="mt-2 overflow-x-auto">
                            <table
                              className="w-full text-left text-xs"
                              data-testid="experiment-comparison"
                            >
                              <thead className="text-zinc-500">
                                <tr>
                                  <th className="py-1 pr-3 font-medium">
                                    기준({report.baseline}) 대비
                                  </th>
                                  <th className="py-1 pr-3 font-medium">
                                    성공률
                                  </th>
                                  <th className="py-1 pr-3 font-medium">지연</th>
                                  <th className="py-1 pr-3 font-medium">
                                    호출당 비용
                                  </th>
                                  <th className="py-1 pr-3 font-medium">
                                    성공률 신뢰도
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.comparisons.map((item) => (
                                  <tr
                                    key={item.key}
                                    data-testid="comparison-row"
                                    className="border-t border-zinc-200 dark:border-zinc-800"
                                  >
                                    <td className="py-1 pr-3 font-mono">
                                      {item.key}
                                    </td>
                                    <td className="py-1 pr-3 tabular-nums">
                                      {delta(
                                        item.successRateDelta,
                                        (v) => `${(v * 100).toFixed(1)}%p`,
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 tabular-nums">
                                      {delta(
                                        item.latencyDelta,
                                        (v) => `${Math.round(v)}ms`,
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 tabular-nums">
                                      {delta(
                                        item.costPerCallDelta,
                                        (v) => `$${v.toFixed(6)}`,
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 tabular-nums">
                                      {percent(item.successRateConfidence)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        <p className="mt-1 text-xs text-zinc-500">
                          관측 {report.totalCalls}건
                          {report.since
                            ? ` · ${new Date(report.since).toLocaleString("ko-KR")} 이후`
                            : " · 전체 기간"}
                          . 승격은 운영자가 판단합니다 — 추천은 근거일 뿐입니다.
                        </p>
                      </>
                    );
                  })()}
                </div>
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

          {assignments && assignments.assignments.length > 0 ? (
            <section
              data-testid="assignment-dashboard"
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="text-sm font-semibold">
                Sticky Assignment (Project 기반)
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                같은 프로젝트는 항상 같은 변형을 받습니다. 배정은 결정적
                해시(실험 정의 + 프로젝트)로 정해지므로 재기동·다중 인스턴스와
                무관하게 일관됩니다.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table
                  className="w-full text-left text-sm"
                  data-testid="assignment-table"
                >
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Feature</th>
                      <th className="py-1 pr-3 font-medium">프로젝트</th>
                      <th className="py-1 pr-3 font-medium">변형</th>
                      <th className="py-1 pr-3 font-medium">배정 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.assignments.map((item) => (
                      <tr
                        key={`${item.feature}|${item.projectId}`}
                        data-testid="assignment-row"
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {item.feature}
                        </td>
                        <td className="py-1.5 pr-3 text-xs">
                          {item.projectName ?? "(이름 없음)"}
                          <span className="ml-1 font-mono text-zinc-500">
                            {item.projectId}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {item.variantKey}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-zinc-500">
                          {new Date(item.assignedAt).toLocaleString("ko-KR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {assignments.reassignments.length > 0 ? (
                <details className="mt-3" data-testid="reassignment-history">
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    재배정 이력 {assignments.reassignments.length}건 — 실험
                    정의가 바뀌면 고정 배정이 다시 정해집니다
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {assignments.reassignments.map((item) => (
                      <li
                        key={`${item.projectId}|${item.createdAt}`}
                        className="text-xs text-zinc-500"
                      >
                        <span className="font-mono">{item.projectId}</span>{" "}
                        <span className="font-mono">{item.fromVariant}</span> →{" "}
                        <span className="font-mono">{item.toVariant}</span> ·{" "}
                        {item.reason === "DEFINITION_CHANGED"
                          ? "실험 정의 변경"
                          : "변형 사용 불가"}{" "}
                        · {new Date(item.createdAt).toLocaleString("ko-KR")}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

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
