"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  AlertBoardDto,
  AlertLevelDto,
  ApiKeyFormatStatusDto,
  CostVerificationDto,
  MonitorStatusDto,
  ProductionMonitorDto,
  ProviderValidationReportDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const FORMAT_LABEL: Record<ApiKeyFormatStatusDto, string> = {
  ok: "형식 정상",
  missing: "미설정",
  invalid: "형식 오류",
  placeholder: "플레이스홀더",
};

const FORMAT_STYLE: Record<ApiKeyFormatStatusDto, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  missing: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  invalid: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  placeholder:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const MONITOR_LABEL: Record<MonitorStatusDto, string> = {
  healthy: "정상",
  degraded: "저하",
  down: "장애",
  unknown: "판정 불가",
};

const MONITOR_STYLE: Record<MonitorStatusDto, string> = {
  healthy:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  degraded: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  down: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function money(value: number | null): string {
  return value === null ? "미산정" : `$${value.toFixed(6)}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const ALERT_STYLE: Record<AlertLevelDto, string> = {
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function duration(ms: number): string {
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000}시간`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}분`;
  }
  return `${Math.round(ms / 1000)}초`;
}

/**
 * Real Provider 운영 점검 (TASK-1301) — ADMIN 전용.
 *
 * 실 Provider로 운영을 시작할 때 필요한 세 가지를 한 화면에 모은다:
 * API Key 검증 / 비용 검증 / 운영 모니터링.
 *
 * Live Check는 **실제 API를 호출해 과금이 발생**하므로 별도 버튼으로
 * 분리하고, 눌러야만 실행한다.
 */
export default function ProductionOpsPage() {
  const [validation, setValidation] =
    useState<ProviderValidationReportDto | null>(null);
  const [cost, setCost] = useState<CostVerificationDto | null>(null);
  const [monitor, setMonitor] = useState<ProductionMonitorDto | null>(null);
  const [board, setBoard] = useState<AlertBoardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [checkRunning, setCheckRunning] = useState(false);
  const [archiveNote, setArchiveNote] = useState<string | null>(null);

  async function get<T>(path: string): Promise<T | null> {
    const response = await fetch(`${API_URL}${path}`, authFetchInit());
    if (!response.ok) {
      setError(
        response.status === 401 || response.status === 403
          ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
          : `조회 실패 (HTTP ${response.status})`,
      );
      return null;
    }
    return (await response.json()) as T;
  }

  async function load(live = false) {
    if (live) {
      setLiveRunning(true);
    } else {
      setLoading(true);
    }
    try {
      const [nextValidation, nextCost, nextMonitor, nextBoard] =
        await Promise.all([
          get<ProviderValidationReportDto>(
            `/llm/providers/validate${live ? "?live=1" : ""}`,
          ),
          get<CostVerificationDto>("/llm/cost-verification?hours=24"),
          get<ProductionMonitorDto>("/llm/monitoring?minutes=60"),
          get<AlertBoardDto>("/ops/alerts"),
        ]);
      if (nextValidation) {
        setError(null);
        setValidation(nextValidation);
      }
      if (nextCost) {
        setCost(nextCost);
      }
      if (nextMonitor) {
        setMonitor(nextMonitor);
      }
      if (nextBoard) {
        setBoard(nextBoard);
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
      setLiveRunning(false);
    }
  }

  /** 예약을 기다리지 않고 지금 점검한다 (배포 직후 등) */
  async function runChecks() {
    setCheckRunning(true);
    try {
      const response = await fetch(`${API_URL}/ops/checks/run`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `점검 실행 실패 (HTTP ${response.status})`,
        );
        return;
      }
      await load(false);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setCheckRunning(false);
    }
  }

  /** 해소 후 유예가 지난 경보를 보관으로 옮긴다 — 삭제하지 않는다 */
  async function archiveAlerts() {
    setCheckRunning(true);
    try {
      const response = await fetch(`${API_URL}/ops/alerts/archive`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `보관 실패 (HTTP ${response.status})`,
        );
        return;
      }
      const result = (await response.json()) as { archived: number };
      setArchiveNote(
        result.archived > 0
          ? `${result.archived}건을 보관했습니다 (삭제하지 않습니다).`
          : "보관할 경보가 없습니다.",
      );
      await load(false);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setCheckRunning(false);
    }
  }

  useEffect(() => {
    void load(false);
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
          Provider 운영 점검
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          API Key 검증 · 비용 검증 · 운영 모니터링 (ADMIN 전용)
        </p>
      </div>

      {error ? (
        <div
          data-testid="production-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {board ? (
        <section
          data-testid="alert-board"
          className={`rounded-xl border p-4 ${
            board.ok
              ? "border-zinc-200 dark:border-zinc-800"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">경보</h2>
            <span
              data-testid="alert-verdict"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                board.summary.critical > 0
                  ? ALERT_STYLE.critical
                  : board.summary.warning > 0
                    ? ALERT_STYLE.warning
                    : FORMAT_STYLE.ok
              }`}
            >
              {/* 배지와 아래 목록이 어긋나면 안 된다 — 주의 경보가 있는데
                  "이상 없음"이라고 하면 읽는 사람이 목록을 무시하게 된다 */}
              {board.summary.critical > 0
                ? `조치 필요 ${board.summary.critical}건`
                : board.summary.warning > 0
                  ? `주의 ${board.summary.warning}건`
                  : "이상 없음"}
            </span>
            <span className="text-xs text-zinc-500">
              활성 {board.summary.total}건 (심각 {board.summary.critical} · 주의{" "}
              {board.summary.warning}) · 재알림 간격 {duration(board.cooldownMs)}
            </span>
            <button
              type="button"
              data-testid="archive-alerts"
              disabled={checkRunning}
              onClick={() => void archiveAlerts()}
              className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-white/60 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              보관 정리
            </button>
            <button
              type="button"
              data-testid="run-checks"
              disabled={checkRunning}
              onClick={() => void runChecks()}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-white/60 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {checkRunning ? "점검 중…" : "지금 점검"}
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            전달 채널:{" "}
            {board.channels.filter((entry) => entry.enabled).length > 0
              ? board.channels
                  .filter((entry) => entry.enabled)
                  .map(
                    (entry) =>
                      `${entry.channel}(${entry.minLevel === "critical" ? "심각만" : "전체"}${entry.resolved ? "·해소 포함" : ""})`,
                  )
                  .join(" · ") + " + 로그"
              : "로그만 — 사람이 보고 있어야 알 수 있습니다"}
            {" · "}
            예약 조율:{" "}
            {board.coordination.distributed
              ? `분산 (인스턴스 ${board.coordination.instance})`
              : "단일 인스턴스 — 여러 개 띄우면 점검이 중복 실행됩니다"}
          </p>

          {archiveNote ? (
            <p data-testid="archive-note" className="mt-2 text-xs text-zinc-500">
              {archiveNote}
            </p>
          ) : null}

          {board.active.length > 0 ? (
            <ul data-testid="active-alerts" className="mt-3 space-y-2 text-sm">
              {board.active.map((alert) => (
                <li
                  key={alert.key}
                  data-testid={`alert-${alert.kind}`}
                  className="rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERT_STYLE[alert.level]}`}
                    >
                      {alert.level === "critical" ? "심각" : "주의"}
                    </span>
                    <strong>{alert.title}</strong>
                    <span className="text-xs text-zinc-500">
                      {alert.occurrences}회 감지
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{alert.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">활성 경보가 없습니다.</p>
          )}

          {board.deliveries.length > 0 ? (
            <details className="mt-3" data-testid="delivery-history">
              <summary className="cursor-pointer text-sm text-zinc-500">
                최근 알림 전송 {board.deliveries.length}건 (실패{" "}
                {board.deliveries.filter((entry) => !entry.ok).length}건)
              </summary>
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {board.deliveries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1 text-xs">{entry.channel}</td>
                      <td className="py-1 text-xs">{entry.alertKey}</td>
                      <td className="py-1 text-xs">
                        {entry.ok ? "성공" : "실패"} · {entry.attempts}회 시도
                        {entry.error ? ` · ${entry.error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1">예약 점검</th>
                  <th className="py-1">간격</th>
                  <th className="py-1">리더</th>
                  <th className="py-1">마지막 실행</th>
                  <th className="py-1">결과</th>
                </tr>
              </thead>
              <tbody>
                {board.schedules.map((schedule) => (
                  <tr
                    key={schedule.job}
                    data-testid={`schedule-${schedule.job}`}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1.5 font-medium">{schedule.job}</td>
                    <td className="py-1.5 text-xs">
                      {schedule.enabled ? duration(schedule.intervalMs) : "중단"}
                    </td>
                    <td className="py-1.5 text-xs">
                      {(() => {
                        const lease = board.coordination.leases.find(
                          (entry) => entry.key === `scheduler:${schedule.job}`,
                        );
                        if (!board.coordination.distributed) {
                          return "단일";
                        }
                        return lease?.self
                          ? "이 인스턴스"
                          : (lease?.owner ?? "없음");
                      })()}
                    </td>
                    <td className="py-1.5 text-xs text-zinc-500">
                      {schedule.lastRunAt
                        ? new Date(schedule.lastRunAt).toLocaleString("ko-KR")
                        : "실행 이력 없음"}
                    </td>
                    <td className="py-1.5 text-xs">
                      {schedule.lastResult
                        ? `${schedule.lastResult.ok ? "정상" : "문제"} — ${schedule.lastResult.detail}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {validation ? (
        <section
          data-testid="key-validation"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">API Key 검증</h2>
            <span
              data-testid="validation-verdict"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                validation.ok
                  ? FORMAT_STYLE.ok
                  : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
              }`}
            >
              {validation.ok ? "문제 없음" : "조치 필요"}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(false)}
              className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              다시 검사
            </button>
            <button
              type="button"
              data-testid="live-check"
              disabled={liveRunning}
              onClick={() => void load(true)}
              className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
            >
              {liveRunning ? "Live Check 중…" : "Live Check (실호출·과금)"}
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            형식 검사는 키가 유효함을 보장하지 않는다 — 확신하려면 Live Check가
            필요하고, 이는 실제 API를 호출한다.
            {validation.liveChecked ? " (이번 조회는 Live Check 포함)" : ""}
          </p>

          {validation.blockers.length > 0 ? (
            <ul
              data-testid="validation-blockers"
              className="mt-3 list-inside list-disc rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {validation.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1">Provider</th>
                  <th className="py-1">키 형식</th>
                  <th className="py-1">힌트</th>
                  <th className="py-1">운영 필수</th>
                  <th className="py-1">사용 가능</th>
                  <th className="py-1">Live</th>
                </tr>
              </thead>
              <tbody>
                {validation.providers.map((entry) => (
                  <tr
                    key={entry.provider}
                    data-testid={`provider-${entry.provider}`}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1.5 font-medium">{entry.title}</td>
                    <td className="py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${FORMAT_STYLE[entry.format]}`}
                      >
                        {FORMAT_LABEL[entry.format]}
                      </span>
                    </td>
                    <td className="py-1.5 font-mono text-xs text-zinc-500">
                      {entry.hint ?? "—"}
                      {entry.length === null ? "" : ` (${entry.length}자)`}
                    </td>
                    <td className="py-1.5 text-xs">
                      {entry.required ? "필수" : "선택"}
                    </td>
                    <td className="py-1.5 text-xs">
                      {entry.instantiated ? "예" : "아니오"}
                    </td>
                    <td className="py-1.5 text-xs">
                      {entry.live
                        ? entry.live.status === "ok"
                          ? `정상 ${entry.live.latencyMs}ms`
                          : "실패"
                        : "미실행"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {monitor ? (
        <section
          data-testid="production-monitor"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">운영 모니터링</h2>
            <span
              data-testid="monitor-status"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${MONITOR_STYLE[monitor.status]}`}
            >
              {MONITOR_LABEL[monitor.status]}
            </span>
            <span className="text-xs text-zinc-500">
              최근 {monitor.windowMinutes}분 · 판정 최소 표본{" "}
              {monitor.minSamples}회
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Health Check·Live Check 같은 진단 호출은 관측에서{" "}
            <strong>제외</strong>됩니다 — 이 구간의 진단 호출{" "}
            {monitor.diagnosticCalls}건.
          </p>
          <p className="mt-1 text-sm">
            호출 {monitor.totals.calls}회 · 성공률{" "}
            {percent(monitor.totals.successRate)} · 비용{" "}
            {money(monitor.totals.cost)}
          </p>

          {monitor.alerts.length > 0 ? (
            <ul
              data-testid="monitor-alerts"
              className="mt-3 list-inside list-disc rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              {monitor.alerts.map((alert, index) => (
                <li key={`${alert.provider}-${index}`}>
                  <strong>{alert.provider}</strong> — {alert.message}
                </li>
              ))}
            </ul>
          ) : null}

          {monitor.providers.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1">Provider</th>
                    <th className="py-1">상태</th>
                    <th className="py-1">호출</th>
                    <th className="py-1">성공률</th>
                    <th className="py-1">p50 / p95 / p99</th>
                    <th className="py-1">비용</th>
                  </tr>
                </thead>
                <tbody>
                  {monitor.providers.map((row) => (
                    <tr
                      key={row.provider}
                      data-testid={`monitor-${row.provider}`}
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 font-medium">{row.provider}</td>
                      <td className="py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${MONITOR_STYLE[row.status]}`}
                        >
                          {MONITOR_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="py-1.5">{row.calls}</td>
                      <td className="py-1.5">{percent(row.successRate)}</td>
                      <td className="py-1.5 font-mono text-xs">
                        {row.latency
                          ? `${row.latency.p50} / ${row.latency.p95} / ${row.latency.p99}ms`
                          : "—"}
                      </td>
                      <td className="py-1.5 font-mono text-xs">
                        {money(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              관측 창 안에 호출이 없습니다 — 정상이라고 판정하지 않습니다.
            </p>
          )}
        </section>
      ) : null}

      {cost ? (
        <section
          data-testid="cost-verification"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">비용 검증</h2>
            <span
              data-testid="cost-verdict"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                cost.ok
                  ? FORMAT_STYLE.ok
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              }`}
            >
              {cost.ok ? "일치" : "확인 필요"}
            </span>
            <span className="text-xs text-zinc-500">
              최근 {cost.hours}시간 · {cost.checked}건 검사
            </span>
          </div>
          <p className="mt-1 text-sm">
            기록 {money(cost.recordedTotal)} · 재계산 {money(cost.expectedTotal)}{" "}
            · 미산정 {cost.unpricedCalls}건
          </p>

          {cost.issues.length > 0 ? (
            <ul
              data-testid="cost-issues"
              className="mt-3 space-y-2 text-sm"
            >
              {cost.issues.map((issue) => (
                <li
                  key={`${issue.kind}-${issue.provider}-${issue.model}`}
                  className="rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  <strong>
                    {issue.provider} / {issue.model}
                  </strong>{" "}
                  ({issue.count}건) — {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-zinc-500">
              등록된 단가 ({cost.pricing.length}종, USD / 1M tokens)
            </summary>
            <table className="mt-2 w-full text-left text-sm">
              <tbody>
                {cost.pricing.map((entry) => (
                  <tr
                    key={entry.model}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1 font-mono text-xs">{entry.model}</td>
                    <td className="py-1 text-xs">
                      입력 ${entry.inputPerMillion} / 출력 $
                      {entry.outputPerMillion}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      ) : null}
    </main>
  );
}
