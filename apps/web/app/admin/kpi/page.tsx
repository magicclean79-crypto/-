"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OperationsKpiDto, OpsAuditDto, OpsEventDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 운영 KPI 대시보드. (TASK-3801, Sprint 38 — CTO 정책 3801-③④)
 *
 * 판정은 이미 일곱 군데에 있었습니다. 문제는 **사람이 일곱 군데를 돌지
 * 않는다**는 것이었고, 안 돌면 나빠지는 것을 늦게 압니다. 이 화면은 그
 * 일곱을 한 줄씩으로 줄입니다.
 *
 * ## 이 화면이 지키는 규칙
 *
 * **모르는 것을 초록으로 칠하지 않습니다.** 표본이 없는 지표는 `0`이 아니라
 * **"낼 수 없음"** 으로 나오고, 그 칸은 회색입니다. 절반을 모르는데 전부
 * 초록인 대시보드는 없는 편이 낫습니다 — 그것은 사람을 안심시키는 도구이지
 * 운영 도구가 아닙니다.
 *
 * 그리고 **좋아 보이는 0에 주석을 답니다**: "장애 0건"은 장애가 없었다는
 * 뜻일 수도, 아무도 적지 않았다는 뜻일 수도 있습니다.
 */

const STATUS_STYLE: Record<string, string> = {
  good: "border-emerald-200 dark:border-emerald-900",
  watch: "border-amber-200 dark:border-amber-900",
  bad: "border-red-300 dark:border-red-900",
  // 모르는 것은 초록도 빨강도 아니다 — 회색이다
  unknown: "border-zinc-200 dark:border-zinc-800",
};

const STATUS_LABEL: Record<string, string> = {
  good: "정상",
  watch: "주의",
  bad: "나쁨",
  unknown: "낼 수 없음",
};

const STATUS_BADGE: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  watch: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function OperationsKpiPage() {
  const [kpi, setKpi] = useState<OperationsKpiDto | null>(null);
  const [events, setEvents] = useState<OpsEventDto[]>([]);
  const [audit, setAudit] = useState<OpsAuditDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const get = async <T,>(path: string): Promise<T | null> => {
        const response = await fetch(`${API_URL}${path}`, authFetchInit());
        return response.ok ? ((await response.json()) as T) : null;
      };
      const [next, nextEvents, nextAudit] = await Promise.all([
        get<OperationsKpiDto>("/ops/kpi"),
        get<OpsEventDto[]>("/ops/events?limit=20"),
        get<OpsAuditDto[]>("/ops/audit?limit=30"),
      ]);
      setKpi(next);
      setEvents(nextEvents ?? []);
      setAudit(nextAudit ?? []);
      setError(next === null ? "KPI를 읽지 못했습니다 (ADMIN 로그인이 필요합니다)." : null);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← 홈으로
        </Link>
        <h1 className="text-2xl font-semibold">운영 KPI</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          판정은 일곱 군데에 흩어져 있었습니다 — 여기서 한 줄씩으로 봅니다.
          모르는 지표는 초록으로 칠하지 않습니다. (TASK-3801, CTO 정책 3801-①③④)
        </p>
      </header>

      {error ? (
        <p
          data-testid="kpi-error"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}

      {kpi ? (
        <section
          data-testid="kpi-board"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium">지표</h2>
            <span className="text-xs text-zinc-500">최근 {kpi.windowDays}일</span>
            {kpi.unknown > 0 ? (
              <span
                data-testid="kpi-unknown-count"
                className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                낼 수 없음 {kpi.unknown}개
              </span>
            ) : null}
            {kpi.bad > 0 ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                나쁨 {kpi.bad}개
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{kpi.detail}</p>

          <ul data-testid="kpi-cards" className="mt-3 grid gap-2 sm:grid-cols-3">
            {kpi.kpis.map((card) => (
              <li
                key={card.id}
                data-testid={`kpi-${card.id}`}
                className={`rounded-lg border p-3 ${STATUS_STYLE[card.status] ?? STATUS_STYLE.unknown}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{card.title}</span>
                  <span
                    data-testid={`kpi-status-${card.id}`}
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[card.status] ?? STATUS_BADGE.unknown}`}
                  >
                    {STATUS_LABEL[card.status] ?? card.status}
                  </span>
                </div>
                <p
                  data-testid={`kpi-value-${card.id}`}
                  className="mt-1 text-2xl font-semibold"
                >
                  {/* 표본이 없으면 0이 아니다 — 0은 "빨랐다"로 읽힌다 */}
                  {card.value === null ? (
                    <span className="text-base font-normal text-zinc-500">
                      낼 수 없음
                    </span>
                  ) : (
                    <>
                      {card.value}
                      <span className="ml-1 text-sm font-normal text-zinc-500">
                        {card.unit}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {card.basis}
                </p>
                {card.caveat !== null ? (
                  <p
                    data-testid={`kpi-caveat-${card.id}`}
                    className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                  >
                    {card.caveat}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 운영 이벤트 — 시스템이 관측한 상태 변화 */}
      <section
        data-testid="ops-events"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-lg font-medium">운영 이벤트</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          시스템이 관측한 <strong>상태 변화</strong>입니다 — 아래 감사 기록(사람이
          한 일)과 목적이 다릅니다.
        </p>
        {events.length === 0 ? (
          <p data-testid="events-empty" className="mt-3 text-sm text-zinc-500">
            아직 이벤트가 없습니다 — 활성화가 완료되거나 풀리는 순간에 생깁니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {events.map((event) => (
              <li
                key={event.id}
                data-testid="event-item"
                className={`rounded-lg border p-3 ${
                  event.urgent
                    ? "border-red-300 dark:border-red-900"
                    : "border-emerald-200 dark:border-emerald-900"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{event.title}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(event.createdAt).toLocaleString("ko-KR")}
                    {/* 못 보냈으면 못 보낸 채로 보여 준다 — "알렸다"고 적지 않는다 */}
                    {event.notifiedAt === null ? " · 알림 미발송" : ""}
                  </span>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{event.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 감사 기록 — 사람이 한 일 */}
      <section
        data-testid="ops-audit"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-lg font-medium">운영 감사 기록</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <strong>실패한 시도도 남습니다</strong> — 거절된 시도는 그 자체가
          신호입니다. 조회는 남기지 않습니다.
        </p>
        {audit.length === 0 ? (
          <p data-testid="audit-empty" className="mt-3 text-sm text-zinc-500">
            기록된 변경이 없습니다.
          </p>
        ) : (
          <ul data-testid="audit-list" className="mt-3 space-y-1 text-sm">
            {audit.map((row) => (
              <li
                key={row.id}
                data-testid="audit-item"
                className="flex flex-wrap items-baseline gap-2 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-900"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.outcome === "ok"
                      ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  }`}
                >
                  {row.outcome === "ok" ? "성공" : `실패 ${row.statusCode ?? ""}`}
                </span>
                <span className="font-medium">{row.title}</span>
                <span className="text-xs text-zinc-500">
                  {row.actorEmail ?? "알 수 없음"} ·{" "}
                  {new Date(row.createdAt).toLocaleString("ko-KR")}
                  {row.detail === null ? "" : ` · ${row.detail}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
