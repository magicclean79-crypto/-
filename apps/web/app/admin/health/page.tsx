"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ChecklistStatusDto,
  EnvCategoryDto,
  ReadinessReportDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<ChecklistStatusDto, string> = {
  pass: "통과",
  fail: "실패",
  warn: "경고",
  manual: "직접 확인",
};

const STATUS_STYLE: Record<ChecklistStatusDto, string> = {
  pass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  manual: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const CATEGORY_LABEL: Record<EnvCategoryDto, string> = {
  core: "기본",
  database: "데이터베이스",
  storage: "저장소",
  auth: "인증",
  llm: "LLM",
  ops: "운영",
};

/**
 * Health Dashboard (TASK-1202) —
 * "지금 배포해도 되는가"를 실제 상태로 보여준다.
 * 배포 체크리스트·구성 요소 점검·환경 검증·설정 현황을 한 화면에 모은다.
 */
export default function HealthDashboardPage() {
  const [data, setData] = useState<ReadinessReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/health/ready`,
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
      setData((await response.json()) as ReadinessReportDto);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight">배포 준비 상태</h1>
        <p className="mt-1 text-sm text-zinc-500">
          환경 검증 · 구성 요소 점검 · 배포 체크리스트 (ADMIN 전용)
        </p>
      </div>

      {error ? (
        <div
          data-testid="health-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <section
            data-testid="readiness-summary"
            className={`rounded-xl border p-4 ${
              data.ready
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
                : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="readiness-verdict"
                className="text-lg font-bold"
              >
                {data.ready ? "✅ 배포 가능" : "⛔ 배포 불가"}
              </span>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {data.nodeEnv}
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
                className="ml-auto rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-white/60 disabled:opacity-50 dark:border-zinc-700"
              >
                다시 검사
              </button>
            </div>
            <p className="mt-1 text-sm">
              통과 {data.summary.pass} · 실패 {data.summary.fail} · 경고{" "}
              {data.summary.warn} · 직접 확인 {data.summary.manual}
            </p>
            {data.summary.blockers.length > 0 ? (
              <ul
                data-testid="readiness-blockers"
                className="mt-2 list-inside list-disc text-sm"
              >
                {data.summary.blockers.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong> — {item.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section
            data-testid="checklist-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">배포 체크리스트</h2>
            <div className="mt-3 space-y-2">
              {data.checklist.map((item) => (
                <div
                  key={item.id}
                  data-testid="checklist-item"
                  className="flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.blocking ? (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-900">
                      배포 차단
                    </span>
                  ) : null}
                  <span className="w-full text-xs text-zinc-500">
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section
            data-testid="component-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">구성 요소</h2>
            <div className="mt-3 space-y-2">
              {data.components.map((component) => (
                <div
                  key={component.name}
                  data-testid="component-row"
                  className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
                >
                  <span className="w-24 font-mono text-xs">
                    {component.name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      component.ok ? STATUS_STYLE.pass : STATUS_STYLE.fail
                    }`}
                  >
                    {component.ok ? "정상" : "실패"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {component.detail} · {component.latencyMs}ms
                  </span>
                </div>
              ))}
              <p className="pt-2 text-xs text-zinc-500">
                Provider{" "}
                <span className="font-mono">
                  {data.providers.available.join(", ")}
                </span>{" "}
                (기본 <span className="font-mono">{data.providers.default}</span>)
                · 미적용 마이그레이션{" "}
                <span className="font-mono">
                  {data.pendingMigrations === null
                    ? "확인 불가"
                    : `${data.pendingMigrations}건`}
                </span>
              </p>
            </div>
          </section>

          {data.environment.errors.length > 0 ||
          data.environment.warnings.length > 0 ? (
            <section
              data-testid="env-issues"
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="text-sm font-semibold">환경 검증</h2>
              <ul className="mt-2 space-y-1">
                {[...data.environment.errors, ...data.environment.warnings].map(
                  (issue) => (
                    <li
                      key={`${issue.severity}-${issue.name}`}
                      data-testid="env-issue"
                      className="text-sm"
                    >
                      <span
                        className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                          issue.severity === "error"
                            ? STATUS_STYLE.fail
                            : STATUS_STYLE.warn
                        }`}
                      >
                        {issue.severity === "error" ? "오류" : "권고"}
                      </span>
                      <span className="font-mono text-xs">{issue.name}</span>{" "}
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {issue.message}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ) : null}

          <section
            data-testid="configuration-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">설정 현황</h2>
            <p className="mt-1 text-xs text-zinc-500">
              비밀 값은 설정 여부만 표시합니다 — 값은 화면에 나오지 않습니다.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                data-testid="configuration-table"
              >
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">변수</th>
                    <th className="py-1 pr-3 font-medium">분류</th>
                    <th className="py-1 pr-3 font-medium">값</th>
                    <th className="py-1 pr-3 font-medium">미설정 시</th>
                  </tr>
                </thead>
                <tbody>
                  {data.configuration.map((item) => (
                    <tr
                      key={item.name}
                      data-testid="configuration-row"
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {item.name}
                        {item.requiredInProduction ? (
                          <span className="ml-1 text-red-600 dark:text-red-400">
                            *
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">
                        {CATEGORY_LABEL[item.category]}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {item.secret
                          ? item.configured
                            ? "설정됨 (비공개)"
                            : "미설정"
                          : (item.value ?? "미설정")}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">
                        {item.fallback ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              <span className="text-red-600 dark:text-red-400">*</span> 운영 필수
              항목입니다. 운영 환경에서 누락되면 서버가 기동하지 않습니다.
            </p>
          </section>

          <p className="text-xs text-zinc-500">
            검사 시각 {new Date(data.checkedAt).toLocaleString("ko-KR")} · 운영
            절차는 <span className="font-mono">docs/operations/</span>의 런북과
            복구 가이드를 참고하세요.
          </p>
        </>
      ) : null}
    </main>
  );
}
