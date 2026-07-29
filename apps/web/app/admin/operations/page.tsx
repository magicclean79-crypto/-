"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  DrStatusDto,
  OperationsReadinessDto,
  ReadinessVerdictDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const OK_STYLE =
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
const WARN_STYLE =
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
const FAIL_STYLE = "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
const MUTED_STYLE =
  "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

const DR_LABEL: Record<DrStatusDto, string> = {
  pass: "통과",
  fail: "실패",
  warn: "주의",
  manual: "직접 확인",
};

const DR_STYLE: Record<DrStatusDto, string> = {
  pass: OK_STYLE,
  fail: FAIL_STYLE,
  warn: WARN_STYLE,
  manual: MUTED_STYLE,
};

const VERDICT_LABEL: Record<ReadinessVerdictDto, string> = {
  ok: "정상",
  stale: "오래됨",
  failed: "실패",
  missing: "이력 없음",
};

const VERDICT_STYLE: Record<ReadinessVerdictDto, string> = {
  ok: OK_STYLE,
  stale: WARN_STYLE,
  failed: FAIL_STYLE,
  missing: FAIL_STYLE,
};

function bytes(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)}KB`;
  }
  return `${value}B`;
}

function since(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

function duration(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000}분` : `${Math.round(ms / 1000)}초`;
}

/**
 * 운영 대시보드 (TASK-1601) — ADMIN 전용.
 *
 * `/admin/production`이 "지금 잘 돌고 있는가"라면, 이 화면은
 * **"지금 무너지면 되살릴 수 있는가"** 를 본다.
 *
 * 백업·복원 검증·재해 복구 체크리스트·Redis·SMTP를 한 화면에 모은다.
 * 자동으로 판정할 수 없는 항목은 `직접 확인`으로 남긴다 — 모르는 것을
 * 통과로 처리하지 않는다.
 */
export default function OperationsPage() {
  const [data, setData] = useState<OperationsReadinessDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/ops/readiness`,
        authFetchInit(),
      );
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `조회 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setError(null);
      setData((await response.json()) as OperationsReadinessDto);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function act(
    path: string,
    label: string,
    describe: (result: Record<string, unknown>) => string,
  ) {
    setRunning(label);
    setNote(null);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `${label} 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setNote(describe((await response.json()) as Record<string, unknown>));
      await load();
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setRunning(null);
    }
  }

  useEffect(() => {
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight">운영 대시보드</h1>
        <p className="mt-1 text-sm text-zinc-500">
          백업 · 복원 검증 · 재해 복구 · Redis · 메일 경로 (ADMIN 전용)
        </p>
      </div>

      {error ? (
        <div
          data-testid="operations-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <section
            data-testid="dr-checklist"
            className={`rounded-xl border p-4 ${
              data.recoverable
                ? "border-zinc-200 dark:border-zinc-800"
                : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">재해 복구 체크리스트</h2>
              <span
                data-testid="dr-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  data.recoverable ? OK_STYLE : FAIL_STYLE
                }`}
              >
                {data.recoverable ? "복구 가능" : "복구 불가"}
              </span>
              <span className="text-xs text-zinc-500">
                통과 {data.summary.pass} · 실패 {data.summary.fail} · 주의{" "}
                {data.summary.warn} · 직접 확인 {data.summary.manual}
              </span>
              <button
                type="button"
                data-testid="reload-readiness"
                disabled={loading}
                onClick={() => void load()}
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-white/60 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {loading ? "확인 중…" : "다시 확인"}
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              &ldquo;복구 가능&rdquo;은 복구 가능성을 좌우하는 항목이 모두 통과했다는
              뜻입니다. <strong>직접 확인</strong> 항목은 자동 판정할 수 없으므로
              사람이 확인해야 합니다.
            </p>

            <ul className="mt-3 space-y-2 text-sm">
              {data.checklist.map((item) => (
                <li
                  key={item.id}
                  data-testid={`dr-item-${item.id}`}
                  className="rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[item.status]}`}
                    >
                      {DR_LABEL[item.status]}
                    </span>
                    <strong>{item.title}</strong>
                    {item.critical ? (
                      <span className="text-xs text-zinc-500">복구 필수</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{item.detail}</p>
                </li>
              ))}
            </ul>
          </section>

          {note ? (
            <p data-testid="operations-note" className="text-sm text-zinc-500">
              {note}
            </p>
          ) : null}

          <section
            data-testid="backup-status"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">백업</h2>
              <span
                data-testid="backup-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[data.backup.verdict]}`}
              >
                {VERDICT_LABEL[data.backup.verdict]}
              </span>
              <span className="text-xs text-zinc-500">
                {data.backup.directory}/ · {data.backup.retentionDays}일 보관 ·{" "}
                {since(data.backup.ageMs)} · {bytes(data.backup.sizeBytes)}
              </span>
              <button
                type="button"
                data-testid="run-backup"
                disabled={running !== null}
                onClick={() =>
                  void act("/ops/backup/run", "백업", (result) =>
                    result.ok
                      ? `백업 완료 — ${bytes(Number(result.sizeBytes ?? 0))}.`
                      : `백업 실패 — ${String(result.error ?? "사유 불명")}`,
                  )
                }
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {running === "백업" ? "백업 중…" : "지금 백업"}
              </button>
            </div>
            <p className="mt-1 text-sm">{data.backup.message}</p>

            {data.backup.history.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1">시각</th>
                      <th className="py-1">결과</th>
                      <th className="py-1">크기</th>
                      <th className="py-1">소요</th>
                      <th className="py-1">실행</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.backup.history.map((run) => (
                      <tr
                        key={run.id}
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 text-xs">
                          {new Date(run.createdAt).toLocaleString("ko-KR")}
                        </td>
                        <td className="py-1.5 text-xs">
                          {run.ok ? "성공" : `실패 — ${run.error ?? ""}`}
                        </td>
                        <td className="py-1.5 text-xs">{bytes(run.sizeBytes)}</td>
                        <td className="py-1.5 text-xs">
                          {/* 0.1초짜리 백업을 "0초"라고 하면 안 돌았다고 읽힌다 */}
                          {run.durationMs < 1000
                            ? `${run.durationMs}ms`
                            : `${(run.durationMs / 1000).toFixed(1)}초`}
                        </td>
                        <td className="py-1.5 text-xs">
                          {run.trigger === "schedule" ? "예약" : "수동"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                백업 이력이 없습니다 — 복구할 수 있는 지점이 없습니다.
              </p>
            )}
          </section>

          <section
            data-testid="restore-status"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">복원 검증</h2>
              <span
                data-testid="restore-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[data.restore.verdict]}`}
              >
                {VERDICT_LABEL[data.restore.verdict]}
              </span>
              <span className="text-xs text-zinc-500">
                {data.restore.configured
                  ? `${since(data.restore.ageMs)} · 테이블 ${data.restore.tables ?? "—"}개`
                  : "검증 대상 DB 미구성 (BACKUP_RESTORE_DB_URL)"}
              </span>
              <button
                type="button"
                data-testid="verify-restore"
                disabled={running !== null}
                onClick={() =>
                  void act(
                    "/ops/backup/verify-restore",
                    "복원 검증",
                    (result) =>
                      result.configured === false
                        ? "복원 검증 대상 DB가 없습니다 — 실패가 아니라 하지 못한 것입니다."
                        : result.ok
                          ? `복원 검증 통과 — 테이블 ${String(result.tables)}개.`
                          : `복원 검증 실패 — ${String(result.error ?? "사유 불명")}`,
                  )
                }
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {running === "복원 검증" ? "복원 중…" : "지금 복원 검증"}
              </button>
            </div>
            <p className="mt-1 text-sm">{data.restore.message}</p>
            <p className="mt-1 text-xs text-zinc-500">
              복원은 <strong>별도 데이터베이스</strong>에서만 합니다 — 운영 DB에는
              절대 복원하지 않습니다.
            </p>

            {data.restore.history.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1">시각</th>
                      <th className="py-1">결과</th>
                      <th className="py-1">테이블</th>
                      <th className="py-1">실행</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.restore.history.map((run) => (
                      <tr
                        key={run.id}
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 text-xs">
                          {new Date(run.createdAt).toLocaleString("ko-KR")}
                        </td>
                        <td className="py-1.5 text-xs">
                          {run.ok ? "성공" : `실패 — ${run.error ?? ""}`}
                        </td>
                        <td className="py-1.5 text-xs">{run.tables ?? "—"}</td>
                        <td className="py-1.5 text-xs">
                          {run.trigger === "schedule" ? "예약" : "수동"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section
            data-testid="redis-health"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Redis (분산 잠금)</h2>
              <span
                data-testid="redis-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  !data.redis.configured
                    ? MUTED_STYLE
                    : data.redis.ok
                      ? OK_STYLE
                      : FAIL_STYLE
                }`}
              >
                {!data.redis.configured
                  ? "미구성"
                  : data.redis.ok
                    ? "정상"
                    : "장애"}
              </span>
              <span className="text-xs text-zinc-500">
                {data.redis.latencyMs === null
                  ? "응답 없음"
                  : `응답 ${data.redis.latencyMs}ms`}
                {" · "}
                {duration(data.redis.outageThresholdMs)} 이상 지속되면 심각 경보
              </span>
            </div>
            <p className="mt-1 text-sm">{data.redis.detail}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Redis가 죽어도 <strong>LLM 호출은 계속됩니다</strong> — 예약 점검만
              멈춥니다.
              {data.redis.unhealthySince
                ? ` 장애 시작 ${new Date(data.redis.unhealthySince).toLocaleString("ko-KR")}.`
                : ""}
            </p>
          </section>

          <section
            data-testid="smtp-health"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">메일 경로 (SMTP)</h2>
              <span
                data-testid="smtp-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  !data.smtp.configured
                    ? MUTED_STYLE
                    : data.smtp.ok
                      ? OK_STYLE
                      : FAIL_STYLE
                }`}
              >
                {!data.smtp.configured
                  ? "미구성"
                  : data.smtp.ok
                    ? "연결 확인"
                    : "연결 실패"}
              </span>
              <span className="text-xs text-zinc-500">
                {data.smtp.host ?? "호스트 미설정"} · {data.smtp.latencyMs}ms
              </span>
              <button
                type="button"
                data-testid="verify-smtp"
                disabled={running !== null}
                onClick={() =>
                  void act(
                    "/ops/notifications/verify-smtp",
                    "메일 검증",
                    (result) => String(result.detail ?? ""),
                  )
                }
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {running === "메일 검증" ? "확인 중…" : "메일 경로 확인"}
              </button>
            </div>
            <p className="mt-1 text-sm">{data.smtp.detail}</p>
            <p className="mt-1 text-xs text-zinc-500">
              연결과 인증만 확인하고 <strong>메일은 보내지 않습니다</strong> —
              점검이 수신함을 채우면 안 됩니다.
            </p>
          </section>

          <p className="text-xs text-zinc-500">
            확인 시각 {new Date(data.checkedAt).toLocaleString("ko-KR")} · 복구
            절차는 docs/operations/disaster-recovery.md
          </p>
        </>
      ) : null}
    </main>
  );
}
