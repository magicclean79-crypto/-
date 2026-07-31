"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { JobMetricsDto, JobRunDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 작업 현황. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 오래 도는 작업이 **어디까지 갔고 왜 멈췄는지**를 보여 줍니다.
 *
 * ## 이 화면이 지키는 것
 *
 * 1. **사용자 문장을 보여 주고 원문을 보여 주지 않습니다.** 원문에 무엇이
 *    들어 있는지 미리 알 수 없습니다 — 원문은 로그에만 있습니다.
 * 2. **이어할 수 없는 실패에 이어하기 버튼을 두지 않습니다.** 눌러도 같은
 *    결과가 나오는 버튼은 없느니만 못합니다.
 * 3. **표본이 모자란 추세를 빠르다고 말하지 않습니다.**
 */

const STATUS_LABEL: Record<string, string> = {
  running: "진행 중",
  succeeded: "성공",
  failed: "실패",
};

const STATUS_STYLE: Record<string, string> = {
  running:
    "border border-zinc-400 bg-transparent text-zinc-700 dark:border-zinc-500 dark:text-zinc-300",
  succeeded:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const TREND_LABEL: Record<string, string> = {
  ok: "정상",
  slow: "느림",
  // **빠르다는 뜻이 아닙니다** — 표본이 모자란 것입니다
  insufficient: "판정 유보",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRunDto[] | null>(null);
  const [metrics, setMetrics] = useState<JobMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsResponse, metricsResponse] = await Promise.all([
        fetch(`${API_URL}/jobs?take=20`, authFetchInit()),
        fetch(`${API_URL}/jobs/metrics/stages`, authFetchInit()),
      ]);
      if (!jobsResponse.ok) {
        setJobs(null);
        setError("작업 목록을 읽지 못했습니다 (ADMIN 로그인이 필요합니다).");
        return;
      }
      setJobs(((await jobsResponse.json()) as { jobs: JobRunDto[] }).jobs);
      setMetrics(
        metricsResponse.ok ? ((await metricsResponse.json()) as JobMetricsDto) : null,
      );
      setError(null);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resume = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const response = await fetch(
          `${API_URL}/jobs/${id}/resume`,
          authFetchInit({ method: "POST" }),
        );
        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          setError(body.message ?? "이어하지 못했습니다.");
          return;
        }
        await load();
      } catch {
        setError("API 서버에 연결할 수 없습니다.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 홈
        </Link>
        <h1 className="text-2xl font-semibold">작업 현황</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          오래 도는 작업이 어디까지 갔고 왜 멈췄는지 보여 줍니다. 끝난 단계는
          체크포인트에 남아 있어, 이어할 수 있는 실패는 앞의 단계를 다시 사지
          않습니다.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}
      {error !== null ? (
        <p data-testid="jobs-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {jobs !== null ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">최근 작업</h2>
          {jobs.length === 0 ? (
            <p data-testid="jobs-empty" className="text-sm text-zinc-500">
              아직 실행한 작업이 없습니다 — 실패가 아니라 안 한 것입니다.
            </p>
          ) : (
            <ul data-testid="job-list" className="space-y-2">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  data-testid={`job-${job.id}`}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{job.kind}</span>
                    <span
                      data-testid={`job-status-${job.id}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[job.status] ?? STATUS_STYLE.running
                      }`}
                    >
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {job.completedStages.length}/{job.totalStages} 단계
                    </span>
                    {job.attempts > 1 ? (
                      <span className="text-xs text-zinc-500">시도 {job.attempts}회</span>
                    ) : null}
                    <code className="text-xs text-zinc-500">{job.id.slice(0, 8)}</code>
                  </div>

                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {job.detail}
                  </p>

                  {/*
                    사용자 문장만 보여 줍니다 — 원문에 무엇이 들어 있는지
                    우리는 미리 알 수 없고, 원문은 로그에만 있습니다.
                  */}
                  {job.userMessage !== null ? (
                    <p
                      data-testid={`job-message-${job.id}`}
                      className="mt-1 text-sm text-amber-700 dark:text-amber-400"
                    >
                      {job.userMessage}
                    </p>
                  ) : null}

                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(job.startedAt).toLocaleString("ko-KR")}
                    {job.totalMs === null ? "" : ` · ${job.totalMs}ms`}
                    {job.requestId === null ? "" : ` · 요청 ${job.requestId.slice(0, 8)}`}
                  </p>

                  {/*
                    눌러도 같은 결과가 나오는 버튼은 없느니만 못합니다.
                  */}
                  {job.resumable ? (
                    <button
                      type="button"
                      data-testid={`job-resume-${job.id}`}
                      onClick={() => void resume(job.id)}
                      disabled={busy === job.id}
                      className="mt-2 rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {busy === job.id ? "이어하는 중…" : "이어하기"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {metrics !== null ? (
        <section
          data-testid="job-metrics"
          className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-lg font-medium">단계별 성능</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{metrics.detail}</p>
          <ul className="space-y-1">
            {metrics.trends.map((trend) => (
              <li
                key={`${trend.kind}:${trend.stage}`}
                data-testid={`trend-${trend.stage}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-medium">{trend.stage}</span>
                <span
                  data-testid={`trend-verdict-${trend.stage}`}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    trend.verdict === "slow"
                      ? STATUS_STYLE.failed
                      : trend.verdict === "ok"
                        ? STATUS_STYLE.succeeded
                        : STATUS_STYLE.running
                  }`}
                >
                  {TREND_LABEL[trend.verdict] ?? trend.verdict}
                </span>
                <span className="text-xs text-zinc-500">{trend.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
