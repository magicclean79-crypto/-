"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  AlertBoardDto,
  NotificationQueueStatusDto,
  AlertLevelDto,
  ApiKeyFormatStatusDto,
  CostVerificationDto,
  MonitorStatusDto,
  ProductionActivationDto,
  ProductionCutoverDto,
  ProductionMonitorDto,
  ProviderRolloutDto,
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

/**
 * Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤).
 *
 * `unverified`를 "연결됨"으로 보여 주지 않는다 — 키 형식이 맞다는 것은
 * 오타가 없다는 뜻일 뿐이고, 그것을 연결 완료로 보여 주면 **붙지 않은
 * 시스템이 붙은 것처럼** 읽힌다.
 */
/**
 * 운영 전환 판정 (TASK-3401, CTO 지시 4·5·6).
 *
 * `not-production`을 "연결됨"처럼 보이게 하지 않는다 — 돌고는 있지만
 * 상대가 운영의 그것이 아니라는 뜻이고, 그 차이가 이 화면의 전부다.
 */
const CUTOVER_LABEL: Record<ProductionCutoverDto["dependencies"][number]["status"], string> = {
  verified: "실 연결 확인",
  "not-production": "운영의 그것이 아님",
  unverified: "확인 안 됨",
  "not-configured": "미구성",
  invalid: "설정 오류",
  // 자격 증명 이전의 문제 (TASK-3501) — 키가 틀린 것과 길이 막힌 것은 다르다
  unreachable: "닿지 못함",
};

const CUTOVER_STYLE: Record<ProductionCutoverDto["dependencies"][number]["status"], string> = {
  verified:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "not-production":
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  unverified:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "not-configured":
    "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  invalid: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unreachable: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const ROLLOUT_LABEL: Record<ProviderRolloutDto["stages"][number]["status"], string> = {
  connected: "연결됨",
  unverified: "확인 안 됨",
  invalid: "형식 오류",
  "not-configured": "미구성",
  mock: "가짜(mock)",
  "dev-only": "개발용 엔진",
};

const ROLLOUT_STYLE: Record<ProviderRolloutDto["stages"][number]["status"], string> = {
  connected:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  // 모르는 것은 정상(초록)도 실패(빨강)도 아니다
  unverified: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  invalid: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  // 미구성은 실패가 아니다 — 회색으로 둔다
  "not-configured": "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  mock: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  "dev-only": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
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
  // 주 1회 대조(CTO 결정 2001-②)를 "168시간"이라고 적으면 읽히지 않는다
  if (ms % 86_400_000 === 0) {
    return `${ms / 86_400_000}일`;
  }
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
  const [queue, setQueue] = useState<NotificationQueueStatusDto | null>(null);
  const [rollout, setRollout] = useState<ProviderRolloutDto | null>(null);
  // 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6) — 붙은 상대가 진짜인가
  const [cutover, setCutover] = useState<ProductionCutoverDto | null>(null);
  // 운영 활성화 세 조건 (TASK-3601, CTO 정책 3601-①)
  const [activation, setActivation] = useState<ProductionActivationDto | null>(
    null,
  );
  // OCR 관측 (TASK-3001, CTO 결정 2901-④) — LLM과 같은 기준, 다른 표
  const [ocrMonitor, setOcrMonitor] = useState<ProductionMonitorDto | null>(
    null,
  );
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
      const [
        nextValidation,
        nextCost,
        nextMonitor,
        nextBoard,
        nextQueue,
        nextRollout,
        nextOcrMonitor,
        nextCutover,
        nextActivation,
      ] = await Promise.all([
        get<ProviderValidationReportDto>(
          `/llm/providers/validate${live ? "?live=1" : ""}`,
        ),
        get<CostVerificationDto>("/llm/cost-verification?hours=24"),
        get<ProductionMonitorDto>("/llm/monitoring?minutes=60"),
        get<AlertBoardDto>("/ops/alerts"),
        get<NotificationQueueStatusDto>("/ops/notifications/queue"),
        // Provider 연결 순서 (TASK-2901)
        get<ProviderRolloutDto>("/ops/providers"),
        // OCR 관측 (TASK-3001)
        get<ProductionMonitorDto>("/llm/monitoring/ocr?minutes=60"),
        // 운영 전환 검증 (TASK-3401)
        get<ProductionCutoverDto>("/ops/cutover"),
        // 운영 활성화 (TASK-3601)
        get<ProductionActivationDto>("/ops/activation"),
      ]);
      if (nextCutover) {
        setCutover(nextCutover);
      }
      if (nextActivation) {
        setActivation(nextActivation);
      }
      if (nextRollout) {
        setRollout(nextRollout);
      }
      if (nextOcrMonitor) {
        setOcrMonitor(nextOcrMonitor);
      }
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
      if (nextQueue) {
        setQueue(nextQueue);
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

  /** 예약 워커를 기다리지 않고 지금 큐를 비운다 */
  async function drainQueue() {
    await post("/ops/notifications/queue/drain", "전송 실패");
  }

  /** Dead Letter 재시도 — 설정을 고친 뒤 다시 보낸다 */
  async function requeueDead() {
    await post("/ops/notifications/queue/requeue", "재시도 실패");
  }

  async function post(path: string, failure: string) {
    setCheckRunning(true);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `${failure} (HTTP ${response.status})`,
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
              ? board.coordination.lockHealthy
                ? `분산 (인스턴스 ${board.coordination.instance})`
                : "⛔ 분산 잠금을 쓸 수 없습니다 — 예약 점검이 돌지 않습니다"
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
                      {!schedule.enabled
                        ? "중단"
                        : schedule.dailyAtMinutes !== null
                          ? // 일 1회 점검은 운영 서버 로컬 시각 기준 (CTO 결정 1501-①)
                            `매일 ${String(Math.floor(schedule.dailyAtMinutes / 60)).padStart(2, "0")}:${String(schedule.dailyAtMinutes % 60).padStart(2, "0")} 로컬`
                          : duration(schedule.intervalMs)}
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

      {queue ? (
        <section
          data-testid="notification-queue"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">알림 큐</h2>
            <span
              data-testid="queue-verdict"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                queue.dead > 0 ? ALERT_STYLE.critical : FORMAT_STYLE.ok
              }`}
            >
              {queue.dead > 0
                ? `전달 실패 ${queue.dead}건`
                : "전달 실패 없음"}
            </span>
            <span className="text-xs text-zinc-500">
              대기 {queue.pending} · 전송 완료 {queue.sent} · 지금 보낼 수 있음{" "}
              {queue.due}
              {queue.workerEnabled
                ? ` · 워커 ${duration(queue.workerIntervalMs)}마다`
                : " · ⛔ 워커 중단 — 큐에만 쌓입니다"}
            </span>
            <button
              type="button"
              data-testid="drain-queue"
              disabled={checkRunning}
              onClick={() => void drainQueue()}
              className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              지금 보내기
            </button>
            {queue.dead > 0 ? (
              <button
                type="button"
                data-testid="requeue-dead"
                disabled={checkRunning}
                onClick={() => void requeueDead()}
                className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
              >
                실패분 다시 보내기
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            전달하지 못한 알림은 지우지 않고 남깁니다 — 설정을 고친 뒤 다시 보낼
            수 있습니다.
          </p>

          {queue.deadLetters.length > 0 ? (
            <ul data-testid="dead-letters" className="mt-3 space-y-2 text-sm">
              {queue.deadLetters.slice(0, 5).map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  <strong>{item.channel}</strong> — {item.title} (
                  {item.attempts}회 시도)
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/*
        운영 전환 검증 (TASK-3401 — CTO 지시 4·5·6).

        연결 순서(아래)와 목적이 다르다: 그쪽은 "어디까지 붙였는가",
        이쪽은 **"붙은 상대가 진짜인가"** 다. 계약 스텁을 상대로 만든 성공
        기록은 연결의 증거가 아니고, 그것을 가려내지 못하면 화면은 붙지
        않은 시스템을 붙었다고 보고한다.
      */}
      {cutover ? (
        <section
          data-testid="production-cutover"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">운영 전환 검증</h2>
            <span
              data-testid="cutover-summary"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                cutover.ready
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              }`}
            >
              {cutover.summary.verified}/{cutover.summary.total} 확인됨
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{cutover.detail}</p>
          {/*
            전환은 운영·Staging에서 한다 (TASK-3501, CTO 정책 3501-①).
            개발에서 상시 빨간색을 띄우면 사람은 그 빨간색을 무시하게 되고,
            정작 운영에서 떴을 때도 무시한다. 판정은 감추지 않고, 이 환경이
            대상이 아니라는 사실만 함께 말한다.
          */}
          {!cutover.applicable ? (
            <p
              data-testid="cutover-not-applicable"
              className="mt-1 text-xs text-zinc-500"
            >
              이 환경({cutover.environment})은 전환 대상이 아닙니다 — 실 Provider
              전환은 운영·Staging에서 수행합니다 (CTO 정책 3501-①). 아래는
              참고용 판정입니다.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-zinc-500">
            성공 기록은 최근 {cutover.evidenceWindowDays}일까지만 근거로
            인정합니다 — 오래전 한 번의 성공으로 지금도 붙어 있다고 말할 수
            없습니다.
          </p>

          {/*
            지금 해야 할 **한 가지** (TASK-3501 — CTO 지시 6).
            항목 넷을 나란히 두면 사람은 "그래서 뭐부터?"에서 멈춘다.
            남은 것 중 첫 번째를 골라 크게 보여 준다.
          */}
          {!cutover.ready && cutover.applicable ? (
            <div
              data-testid="cutover-next"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
            >
              <p className="font-medium">지금 할 일</p>
              <p className="mt-1 text-zinc-700 dark:text-zinc-300">
                {(() => {
                  const next = cutover.dependencies.find(
                    (row) => row.status !== "verified",
                  );
                  return next
                    ? `${next.title} — ${next.next}`
                    : "남은 항목이 없습니다.";
                })()}
              </p>
            </div>
          ) : null}

          {/*
            도달 점검 (TASK-3501 — CTO 지시 2·3).
            키가 틀린 것과 길이 막힌 것은 다르다. 둘 다 "호출 실패"로 보이면
            사람은 있지도 않은 키 문제를 몇 시간씩 찾는다.
          */}
          {cutover.egress.length > 0 ? (
            <ul
              data-testid="cutover-egress"
              className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400"
            >
              {cutover.egress.map((probe) => (
                <li key={probe.host}>
                  {/*
                    세 상태를 갈라 말한다 — 403은 "닿지 못함"이 아니라
                    "누가 막았는지 모름"이다. 모르는 것을 막혔다고 말하면
                    사람은 방화벽을 뒤지다 시간을 버린다.
                  */}
                  <span
                    className={
                      probe.status === "reachable"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : probe.status === "ambiguous"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-red-700 dark:text-red-400"
                    }
                  >
                    {probe.status === "reachable"
                      ? "닿음"
                      : probe.status === "ambiguous"
                        ? "가릴 수 없음"
                        : "닿지 못함"}
                  </span>{" "}
                  {probe.host} — {probe.detail}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            운영 활성화 세 조건 (TASK-3601, CTO 정책 3601-①).
            하나로 뭉친 초록불은 "무엇이 남았는지"를 말하지 못하고,
            둘이 충족된 상태를 "거의 다"로 보이게 만든다.
          */}
          {activation ? (
            <ul
              data-testid="activation-conditions"
              className="mt-3 grid gap-2 sm:grid-cols-3"
            >
              {activation.conditions.map((condition) => (
                <li
                  key={condition.id}
                  data-testid={`activation-${condition.id}`}
                  className={`rounded-lg border p-2 text-xs ${
                    condition.met
                      ? "border-emerald-200 dark:border-emerald-900"
                      : "border-amber-200 dark:border-amber-900"
                  }`}
                >
                  <span className="font-medium">
                    {condition.met ? "충족" : "아직"} · {condition.title}
                  </span>
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                    {condition.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          <ul data-testid="cutover-items" className="mt-3 space-y-2 text-sm">
            {cutover.dependencies.map((row) => (
              <li
                key={row.id}
                data-testid={`cutover-${row.id}`}
                className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.title}</span>
                  <span
                    data-testid={`cutover-status-${row.id}`}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${CUTOVER_STYLE[row.status]}`}
                  >
                    {CUTOVER_LABEL[row.status]}
                  </span>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  {row.detail}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  다음 할 일: {row.next}
                  {row.evidence ? ` · 근거: ${row.evidence}` : ""}
                  {row.env.length > 0 ? ` · ${row.env.join(" · ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rollout ? (
        <section
          data-testid="provider-rollout"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Provider 연결 순서</h2>
            <span
              data-testid="rollout-progress"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                rollout.summary.connected === rollout.summary.total
                  ? ROLLOUT_STYLE.connected
                  : ROLLOUT_STYLE.unverified
              }`}
            >
              {rollout.summary.connected}/{rollout.summary.total} 연결됨
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {rollout.detail}
          </p>

          <ol data-testid="rollout-stages" className="mt-3 space-y-2 text-sm">
            {rollout.stages.map((stage) => (
              <li
                key={stage.stage}
                data-testid="rollout-stage"
                className={`rounded-lg border p-3 ${
                  stage.stage === rollout.next
                    ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-400">
                    {stage.order}
                  </span>
                  <span className="font-medium">{stage.title}</span>
                  <span
                    data-testid="rollout-status"
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLLOUT_STYLE[stage.status]}`}
                  >
                    {ROLLOUT_LABEL[stage.status]}
                  </span>
                  {/* 다음에 붙일 단계를 글자로 밝힌다 — 색만으로 구분하지 않는다 */}
                  {stage.stage === rollout.next ? (
                    <span
                      data-testid="rollout-next"
                      className="text-xs font-medium text-amber-700 dark:text-amber-400"
                    >
                      다음 단계
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {stage.detail}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  설정: {stage.env.join(" · ")}
                  {/* 연결됨의 근거는 선언이 아니라 사실이다 */}
                  {stage.evidence ? ` · 근거: ${stage.evidence}` : ""}
                </p>
              </li>
            ))}
          </ol>

          {/* 순서를 벗어난 진행은 사실만 말하고 막지 않는다 */}
          {rollout.outOfOrder.length > 0 ? (
            <p
              data-testid="rollout-out-of-order"
              className="mt-3 text-xs text-amber-700 dark:text-amber-400"
            >
              확정 순서보다 먼저 붙은 단계: {rollout.outOfOrder.join(", ")} —
              막지는 않습니다.
            </p>
          ) : null}
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

      {ocrMonitor ? (
        <section
          data-testid="ocr-monitor"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">OCR 관측</h2>
            <span
              data-testid="ocr-monitor-status"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${MONITOR_STYLE[ocrMonitor.status]}`}
            >
              {MONITOR_LABEL[ocrMonitor.status]}
            </span>
            <span className="text-xs text-zinc-500">
              최근 {ocrMonitor.windowMinutes}분 · 최소 표본 {ocrMonitor.minSamples}건
            </span>
          </div>
          <p className="mt-1 text-sm">
            호출 {ocrMonitor.totals.calls}건 · 성공률{" "}
            {percent(ocrMonitor.totals.successRate)} · 비용{" "}
            {money(ocrMonitor.totals.cost)} · 미산정{" "}
            {ocrMonitor.totals.unpricedCalls}건
          </p>
          {/* 판정 기준은 LLM과 같다 — 엔진에 따라 다를 이유가 없다 */}
          <p className="mt-1 text-xs text-zinc-500">
            LLM과 같은 기준으로 판정합니다. 표본이 적으면 판정하지 않습니다
            (1회 실패로 장애라고 말하지 않습니다).
          </p>

          {ocrMonitor.providers.length > 0 ? (
            <ul data-testid="ocr-providers" className="mt-3 space-y-2 text-sm">
              {ocrMonitor.providers.map((row) => (
                <li
                  key={row.provider}
                  data-testid={`ocr-provider-${row.provider}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <span className="font-medium">{row.provider}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${MONITOR_STYLE[row.status]}`}
                  >
                    {MONITOR_LABEL[row.status]}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {row.calls}건 · 성공률 {percent(row.successRate)} · 비용{" "}
                    {money(row.cost)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="ocr-empty" className="mt-3 text-sm text-zinc-500">
              관측 창 안에 OCR 호출이 없습니다 — 엔진이 멈췄다는 뜻은 아닙니다.
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
          {/*
            원장별 합계 (TASK-3001, CTO 결정 2901-④) — 예산은 LLM과 OCR을
            합해서 보지만, 총액만 보여 주면 어디서 늘었는지 알 수 없다.
          */}
          <p data-testid="cost-by-source" className="mt-1 text-xs text-zinc-500">
            LLM {money(cost.bySource.llm)} · OCR {money(cost.bySource.ocr)}
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
