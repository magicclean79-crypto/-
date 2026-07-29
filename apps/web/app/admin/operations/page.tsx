"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  DrStatusDto,
  OperationsReadinessDto,
  ProtectionStateDto,
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

/** 복구 목표용 — 확인하지 못한 값은 "확인 불가"로, 0으로 채우지 않는다 */
function span(ms: number | null): string {
  if (ms === null) {
    return "확인 불가";
  }
  if (ms >= 24 * 60 * 60 * 1000) {
    return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}일`;
  }
  if (ms >= 60 * 60 * 1000) {
    return `${(ms / (60 * 60 * 1000)).toFixed(1)}시간`;
  }
  if (ms >= 60 * 1000) {
    return `${Math.round(ms / 60_000)}분`;
  }
  return `${Math.round(ms / 1000)}초`;
}

const PROTECTION_LABEL: Record<ProtectionStateDto, string> = {
  enabled: "켜짐",
  disabled: "꺼짐",
  unknown: "확인 불가",
};

/** 리허설을 즉시 부르는 변경 사건 (CTO 결정 1801-⑤) */
const TRIGGER_LABEL: Record<string, string> = {
  "dr-change": "재해 복구 절차 변경",
  "db-major-change": "데이터베이스 대규모 변경",
  "pitr-adoption": "PITR 도입",
};

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
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillBy, setDrillBy] = useState("");
  const [drillFindings, setDrillFindings] = useState("");

  /** 사슬 판정은 여러 곳에서 쓰므로 한 번만 꺼낸다 */
  const backupIntegrityChain = data?.enterprise.backupIntegrity.chain;

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

  /** 리허설 결과 기록 (CTO 결정 1701-⑤) — 실패도 남긴다 */
  async function submitDrill(ok: boolean) {
    setRunning("리허설 기록");
    setNote(null);
    try {
      const response = await fetch(`${API_URL}/ops/drills`, {
        ...authFetchInit(),
        method: "POST",
        headers: {
          ...(authFetchInit().headers ?? {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ok,
          performedBy: drillBy.trim(),
          findings: drillFindings.trim() || undefined,
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `리허설 기록 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setNote(
        ok
          ? "복구 리허설을 성공으로 기록했습니다."
          : "복구 리허설을 실패로 기록했습니다 — 절차를 고치세요.",
      );
      setDrillOpen(false);
      setDrillFindings("");
      await load();
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setRunning(null);
    }
  }

  /**
   * 리허설 요구 취소 (CTO 결정 1901-② — 삭제는 금지, 취소만 허용).
   *
   * 지운 요구는 왜 지웠는지 남지 않는다. 취소는 남는다.
   */
  async function cancelRequirement(id: string) {
    const reason = window.prompt(
      "취소 사유를 남기세요 (기록에 남습니다). 요구는 삭제되지 않고 취소로 표시됩니다.",
    );
    if (!reason?.trim()) {
      return;
    }
    setRunning("요구 취소");
    setNote(null);
    try {
      const response = await fetch(
        `${API_URL}/ops/drills/requirements/${id}/cancel`,
        {
          ...authFetchInit(),
          method: "POST",
          headers: {
            ...(authFetchInit().headers ?? {}),
            "content-type": "application/json",
          },
          body: JSON.stringify({ cancelledBy: "admin", reason: reason.trim() }),
        },
      );
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `요구 취소 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setNote("요구를 취소했습니다 — 기록은 사유와 함께 남습니다.");
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
            data-testid="recovery-objectives"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">복구 목표 (RPO · RTO)</h2>
              <span
                data-testid="objectives-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.objectives.status]}`}
              >
                {DR_LABEL[data.enterprise.objectives.status]}
              </span>
              <span className="text-xs text-zinc-500">
                손실 한도 {span(data.enterprise.objectives.rpoTargetMs)} · 복구
                한도 {span(data.enterprise.objectives.rtoTargetMs)}
              </span>
            </div>
            <p className="mt-1 text-sm">{data.enterprise.objectives.detail}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs text-zinc-500">
                  지금 무너지면 잃는 구간 (RPO)
                </dt>
                <dd
                  data-testid="rpo-value"
                  className={`mt-1 text-lg font-semibold ${
                    data.enterprise.objectives.rpoMet === false
                      ? "text-amber-700 dark:text-amber-300"
                      : ""
                  }`}
                >
                  {span(data.enterprise.objectives.rpoMs)}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs text-zinc-500">
                  복원에 걸린 시간 (RTO, 측정치)
                </dt>
                <dd
                  data-testid="rto-value"
                  className={`mt-1 text-lg font-semibold ${
                    data.enterprise.objectives.rtoMet === false
                      ? "text-amber-700 dark:text-amber-300"
                      : ""
                  }`}
                >
                  {span(data.enterprise.objectives.rtoMs)}
                </dd>
              </div>
            </dl>
          </section>

          <section
            data-testid="backup-protection"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-lg font-semibold">백업 보호</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li
                data-testid="integrity-status"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.integrity.status]}`}
                  >
                    {DR_LABEL[data.enterprise.integrity.status]}
                  </span>
                  <strong>덤프 무결성</strong>
                </div>
                <p className="mt-1">{data.enterprise.integrity.detail}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  받자마자 목차를 읽어 봅니다 — 읽히지 않는 덤프를 복원하려는
                  순간에 알면 늦습니다.
                </p>
              </li>
              <li
                data-testid="offsite-status"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.offsite.status]}`}
                  >
                    {DR_LABEL[data.enterprise.offsite.status]}
                  </span>
                  <strong>원격 복제</strong>
                  <span className="text-xs text-zinc-500">
                    {data.enterprise.offsite.configured
                      ? `사본 ${data.enterprise.offsite.copies}개`
                      : "꺼짐 (BACKUP_OFFSITE)"}
                  </span>
                </div>
                <p className="mt-1">{data.enterprise.offsite.detail}</p>
              </li>
              <li
                data-testid="storage-protection"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.storageProtection.status]}`}
                  >
                    {DR_LABEL[data.enterprise.storageProtection.status]}
                  </span>
                  <strong>이미지 저장소 보호</strong>
                  <span className="text-xs text-zinc-500">
                    버전 관리{" "}
                    {PROTECTION_LABEL[
                      data.enterprise.storageProtection.versioning
                    ]}{" "}
                    · 복제{" "}
                    {PROTECTION_LABEL[
                      data.enterprise.storageProtection.replication
                    ]}
                  </span>
                </div>
                <p className="mt-1">
                  {data.enterprise.storageProtection.detail}
                </p>
              </li>
              <li
                data-testid="backup-performance"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.performance.status]}`}
                  >
                    {DR_LABEL[data.enterprise.performance.status]}
                  </span>
                  <strong>백업 소요 시간</strong>
                  <span className="text-xs text-zinc-500">
                    2초 미만 정상 · 2~10초 주의 · 10초 3회 연속 경보 · 30초 심각
                  </span>
                </div>
                <p className="mt-1">{data.enterprise.performance.detail}</p>
              </li>
              <li
                data-testid="backup-chain"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[backupIntegrityChain!.status]}`}
                  >
                    {DR_LABEL[backupIntegrityChain!.status]}
                  </span>
                  <strong>백업 사슬 연속성</strong>
                  <span className="text-xs text-zinc-500">
                    {backupIntegrityChain!.actual}/
                    {backupIntegrityChain!.expected}회
                  </span>
                </div>
                <p className="mt-1">{backupIntegrityChain!.detail}</p>
                {/* 창을 올렸다면 숨기지 않는다 (CTO 결정 2001-①) */}
                {backupIntegrityChain!.windowSource === "clamped" ? (
                  <p
                    data-testid="chain-window-clamped"
                    className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                  >
                    {backupIntegrityChain!.windowDetail}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-zinc-500">
                  개별 백업이 모두 성공이어도 사슬은 끊길 수 있습니다 —
                  <strong> 돌지 않은 백업은 아무 데도 기록되지 않습니다.</strong>
                </p>
              </li>
              <li
                data-testid="remote-integrity"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.backupIntegrity.remote.status]}`}
                  >
                    {DR_LABEL[data.enterprise.backupIntegrity.remote.status]}
                  </span>
                  <strong>원격 사본 무결성</strong>
                  <button
                    type="button"
                    data-testid="verify-remote"
                    disabled={running !== null}
                    onClick={() =>
                      void act(
                        "/ops/backup/verify-remote",
                        "원격 사본 검증",
                        (result) => String(result.detail ?? ""),
                      )
                    }
                    className="ml-auto rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
                  >
                    {running === "원격 사본 검증"
                      ? "내려받는 중…"
                      : "원격 사본 검증 (전송 비용)"}
                  </button>
                </div>
                <p className="mt-1">
                  {data.enterprise.backupIntegrity.remote.detail}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {data.enterprise.backupIntegrity.remote.scheduled
                    ? `자동 대조 주기 ${span(data.enterprise.backupIntegrity.remote.intervalMs)} — 마지막 백업 1건만 내려받습니다.`
                    : "자동 대조가 예약되어 있지 않습니다 — 운영에서만 주 1회 자동으로 돕니다 (전송 비용)."}
                </p>
              </li>
              <li
                data-testid="storage-standard"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.backupIntegrity.storageStandard.status]}`}
                  >
                    {DR_LABEL[data.enterprise.backupIntegrity.storageStandard.status]}
                  </span>
                  <strong>운영 저장소 표준</strong>
                </div>
                <p className="mt-1">
                  {data.enterprise.backupIntegrity.storageStandard.detail}
                </p>
              </li>
              <li
                data-testid="database-scale"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.backupIntegrity.scale.status]}`}
                  >
                    {DR_LABEL[data.enterprise.backupIntegrity.scale.status]}
                  </span>
                  <strong>데이터베이스 규모</strong>
                  <span className="text-xs text-zinc-500">
                    재평가 기준 10 · 50 · 100GB
                  </span>
                </div>
                <p className="mt-1">
                  {data.enterprise.backupIntegrity.scale.detail}
                </p>
              </li>
              <li
                data-testid="backup-bucket-protection"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.backupBucket.protection.status]}`}
                  >
                    {DR_LABEL[data.enterprise.backupBucket.protection.status]}
                  </span>
                  <strong>백업 버킷 보호</strong>
                  <span className="text-xs text-zinc-500">
                    버전 관리{" "}
                    {
                      PROTECTION_LABEL[
                        data.enterprise.backupBucket.protection.versioning
                      ]
                    }{" "}
                    · 복제{" "}
                    {
                      PROTECTION_LABEL[
                        data.enterprise.backupBucket.protection.replication
                      ]
                    }
                  </span>
                </div>
                <p className="mt-1">
                  {data.enterprise.backupBucket.protection.detail}
                </p>
              </li>
              <li
                data-testid="backup-bucket"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      data.enterprise.backupBucket.separated ? OK_STYLE : WARN_STYLE
                    }`}
                  >
                    {data.enterprise.backupBucket.separated ? "분리됨" : "같은 버킷"}
                  </span>
                  <strong>백업 버킷</strong>
                  <span className="text-xs text-zinc-500">
                    {data.enterprise.backupBucket.name}
                  </span>
                </div>
                <p className="mt-1">
                  {data.enterprise.backupBucket.separated
                    ? "이미지 버킷과 분리되어 있습니다 — 한 쪽이 사라져도 다른 쪽이 남습니다."
                    : "이미지 버킷과 같습니다 — 그 버킷이 사라지면 이미지와 백업이 함께 사라집니다."}
                </p>
              </li>
              <li
                data-testid="restore-target"
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.restoreTarget.status]}`}
                  >
                    {DR_LABEL[data.enterprise.restoreTarget.status]}
                  </span>
                  <strong>복원 대상 분리</strong>
                </div>
                <p className="mt-1">{data.enterprise.restoreTarget.detail}</p>
              </li>
            </ul>
          </section>

          <section
            data-testid="recovery-drill"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">복구 리허설</h2>
              <span
                data-testid="drill-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${DR_STYLE[data.enterprise.drill.status]}`}
              >
                {DR_LABEL[data.enterprise.drill.status]}
              </span>
              <span className="text-xs text-zinc-500">
                {data.enterprise.drill.intervalDays}일마다 · 다음 예정{" "}
                {data.enterprise.drill.dueAt
                  ? new Date(data.enterprise.drill.dueAt).toLocaleDateString(
                      "ko-KR",
                    )
                  : "미정"}
                {data.enterprise.drill.overdueDays > 0
                  ? ` · ${data.enterprise.drill.overdueDays}일 지남`
                  : ""}
              </span>
              <button
                type="button"
                data-testid="record-drill"
                disabled={running !== null}
                onClick={() => setDrillOpen((open) => !open)}
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {drillOpen ? "닫기" : "리허설 기록"}
              </button>
            </div>
            <p className="mt-1 text-sm">{data.enterprise.drill.detail}</p>
            <p className="mt-1 text-xs text-zinc-500">
              리허설은 사람이 합니다 — 화면은 <strong>한 사실을 기록</strong>하고,
              안 하면 드러나게 할 뿐입니다. 절차는
              docs/operations/disaster-recovery.md.
            </p>

            {drillOpen ? (
              <div
                data-testid="drill-form"
                className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <label className="block text-xs text-zinc-500">
                  수행자
                  <input
                    data-testid="drill-performer"
                    value={drillBy}
                    onChange={(event) => setDrillBy(event.target.value)}
                    placeholder="이름 또는 계정"
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="mt-2 block text-xs text-zinc-500">
                  발견 사항 (절차의 어디가 어긋났는지)
                  <textarea
                    data-testid="drill-findings"
                    value={drillFindings}
                    onChange={(event) => setDrillFindings(event.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="drill-success"
                    disabled={running !== null || drillBy.trim() === ""}
                    onClick={() => void submitDrill(true)}
                    className="rounded-lg border border-emerald-400 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    성공으로 기록
                  </button>
                  <button
                    type="button"
                    data-testid="drill-failure"
                    disabled={running !== null || drillBy.trim() === ""}
                    onClick={() => void submitDrill(false)}
                    className="rounded-lg border border-red-400 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    실패로 기록
                  </button>
                  <span className="self-center text-xs text-zinc-500">
                    실패한 리허설이 더 값집니다 — 사고 전에 절차가 깨진 것을
                    알아낸 것입니다.
                  </span>
                </div>
              </div>
            ) : null}

            {/* 재기동 후 자동 등록 확인 (CTO 결정 2001-④) — Runbook의 확인
                절차가 이 칸을 본다. 로그를 뒤지게 만들면 아무도 확인하지 않는다 */}
            <div
              data-testid="auto-registration"
              className="mt-3 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    data.enterprise.drill.autoRegistration.registered === null
                      ? DR_STYLE.manual
                      : data.enterprise.drill.autoRegistration.registered
                        ? DR_STYLE.warn
                        : DR_STYLE.pass
                  }`}
                >
                  {data.enterprise.drill.autoRegistration.registered === null
                    ? "확인 불가"
                    : data.enterprise.drill.autoRegistration.registered
                      ? "등록됨"
                      : "등록 없음"}
                </span>
                <strong>기동 시 Major Migration 자동 등록</strong>
                <span className="text-zinc-500">
                  {data.enterprise.drill.autoRegistration.checkedAt === null
                    ? "확인 기록 없음"
                    : new Date(
                        data.enterprise.drill.autoRegistration.checkedAt,
                      ).toLocaleString("ko-KR")}
                </span>
              </div>
              <p className="mt-1">
                {data.enterprise.drill.autoRegistration.detail}
              </p>
              {data.enterprise.drill.autoRegistration.applied.length > 0 ? (
                <p className="mt-1 text-zinc-500">
                  적용된 Major Migration:{" "}
                  {data.enterprise.drill.autoRegistration.applied.join(" · ")}
                </p>
              ) : null}
              <p className="mt-1 text-zinc-500">
                자동 등록은 <strong>기동 시 1회</strong>만 일어납니다 — 재기동
                후 이 칸을 확인하세요 (CTO 결정 2001-④).
              </p>
            </div>

            {data.enterprise.drill.pendingTriggers.length > 0 ? (
              <div
                data-testid="drill-triggers"
                className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                <strong>변경 후 리허설 미수행</strong> —{" "}
                {data.enterprise.drill.pendingTriggers
                  .map((trigger) => TRIGGER_LABEL[trigger] ?? trigger)
                  .join(" · ")}
                <ul className="mt-2 list-inside list-disc text-xs">
                  {data.enterprise.drill.requirements
                    .filter(
                      (entry) =>
                        entry.satisfiedAt === null && entry.cancelledAt === null,
                    )
                    .map((entry) => (
                      <li key={entry.id}>
                        {entry.description} ({entry.registeredBy},{" "}
                        {new Date(entry.createdAt).toLocaleDateString("ko-KR")})
                        <button
                          type="button"
                          data-testid={`cancel-requirement-${entry.id}`}
                          disabled={running !== null}
                          onClick={() => void cancelRequirement(entry.id)}
                          className="ml-2 rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-medium hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900"
                        >
                          취소
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            {/* 취소된 요구도 보인다 — 삭제하지 않으므로 기록이 남는다 (결정 1901-②) */}
            {data.enterprise.drill.requirements.some(
              (entry) => entry.cancelledAt !== null,
            ) ? (
              <div
                data-testid="cancelled-requirements"
                className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              >
                <strong>취소된 요구</strong> — 삭제하지 않고 사유와 함께
                남깁니다.
                <ul className="mt-2 list-inside list-disc">
                  {data.enterprise.drill.requirements
                    .filter((entry) => entry.cancelledAt !== null)
                    .map((entry) => (
                      <li key={entry.id}>
                        {entry.description} — {entry.cancelReason} (
                        {entry.cancelledBy})
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            {data.enterprise.drill.history.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1">시각</th>
                      <th className="py-1">결과</th>
                      <th className="py-1">수행자</th>
                      <th className="py-1">발견 사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.enterprise.drill.history.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 text-xs">
                          {new Date(entry.createdAt).toLocaleString("ko-KR")}
                        </td>
                        <td className="py-1.5 text-xs">
                          {entry.ok ? "성공" : "실패"}
                        </td>
                        <td className="py-1.5 text-xs">{entry.performedBy}</td>
                        <td className="py-1.5 text-xs">
                          {entry.findings ?? "—"}
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
