"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  KpiSettingChangeDto,
  KpiThresholdDto,
  KpiTrendReportDto,
  OperationsKpiDto,
  OpsAuditDto,
  OpsEventDto,
  OpsSettingsDto,
} from "@acos/shared";
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
 *
 * ## 추세·임계값 설정·변경 이력 (TASK-4001, CTO 정책 4001-②③)
 *
 * 현재값만으로는 아무 행동도 만들어지지 않습니다 — 사람이 알아야 하는
 * 것은 **"나아지는 중인가"** 이고, 그건 두 번 재야 압니다. 그래서 추세를
 * 함께 보여 주되, **한 점으로 선을 긋지 않습니다**: 스냅샷이 하나뿐이면
 * "0% 변화"가 아니라 "추세를 낼 수 없음"입니다.
 *
 * 임계값은 여기서 바꿉니다. 바꾸면 화면 색이 바뀌므로 **느슨하게 바꾼
 * 것은 그렇다고 적고**, 그 변경이 언제 누구에 의해 일어났는지도 같은
 * 화면에 남깁니다 — 기준을 내려 초록을 산 사실이 화면 밖에 있으면,
 * 다음에 이 화면을 보는 사람은 상태가 좋아진 줄 압니다.
 */

const TREND_LABEL: Record<string, string> = {
  improving: "나아지는 중",
  worsening: "나빠지는 중",
  flat: "변화 없음",
  unknown: "낼 수 없음",
};

const TREND_BADGE: Record<string, string> = {
  improving: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  worsening: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  flat: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  unknown: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

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
  // TASK-4001 — 추세 · 임계값 설정 · 변경 이력
  const [trend, setTrend] = useState<KpiTrendReportDto | null>(null);
  const [thresholds, setThresholds] = useState<KpiThresholdDto[]>([]);
  const [history, setHistory] = useState<KpiSettingChangeDto[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const get = async <T,>(path: string): Promise<T | null> => {
        const response = await fetch(`${API_URL}${path}`, authFetchInit());
        return response.ok ? ((await response.json()) as T) : null;
      };
      const [next, nextEvents, nextAudit, nextTrend, nextSettings, nextHistory] =
        await Promise.all([
          get<OperationsKpiDto>("/ops/kpi"),
          get<OpsEventDto[]>("/ops/events?limit=20"),
          get<OpsAuditDto[]>("/ops/audit?limit=30"),
          get<KpiTrendReportDto>("/ops/kpi/trend"),
          get<OpsSettingsDto>("/ops/settings"),
          get<KpiSettingChangeDto[]>("/ops/kpi/history?limit=20"),
        ]);
      setKpi(next);
      setEvents(nextEvents ?? []);
      setAudit(nextAudit ?? []);
      setTrend(nextTrend);
      setThresholds(nextSettings?.thresholds ?? []);
      setHistory(nextHistory ?? []);
      setError(next === null ? "KPI를 읽지 못했습니다 (ADMIN 로그인이 필요합니다)." : null);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 임계값을 저장한다 (CTO 정책 4001-③).
   *
   * 값을 비우면 **해제**입니다 — 기본값으로 되돌리는 것이고, 삭제가
   * 아닙니다. 저장이 거절되면 그 이유를 그대로 보여 줍니다: 범위 밖의
   * 값은 임계값이 아니라 임계값을 없앤 것이고, 그건 조용히 넘어가면 안
   * 되는 거절입니다.
   */
  const saveThreshold = useCallback(
    async (key: string, raw: string) => {
      setSaving(key);
      setSaveError(null);
      try {
        const response = await fetch(`${API_URL}/admin/settings/${key}`, {
          ...authFetchInit(),
          method: "PUT",
          headers: {
            ...(authFetchInit().headers as Record<string, string>),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: raw.trim() === "" ? null : raw.trim() }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          setSaveError(body?.message ?? "저장하지 못했습니다.");
          return;
        }
        await load();
      } catch {
        setSaveError("API 서버에 연결할 수 없습니다.");
      } finally {
        setSaving(null);
      }
    },
    [load],
  );

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
            {/* 느슨하게 바꾼 임계값은 위쪽에서 먼저 말한다 */}
            {kpi.relaxed > 0 ? (
              <span
                data-testid="kpi-relaxed-count"
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              >
                느슨해진 임계값 {kpi.relaxed}개
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{kpi.detail}</p>
          {/* 받아들이지 않은 설정은 조용히 버리지 않는다 */}
          {kpi.rejected.length > 0 ? (
            <ul
              data-testid="kpi-rejected"
              className="mt-2 space-y-1 rounded-lg border border-amber-200 p-2 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300"
            >
              {kpi.rejected.map((row) => (
                <li key={row.key}>
                  받아들이지 않은 설정 <code>{row.key}</code> — {row.reason}
                </li>
              ))}
            </ul>
          ) : null}

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
                {/*
                  임계값을 바꿔 초록이 된 것과 실제로 좋아진 것은 다르다
                  (TASK-3901, 정책 3901-②). 숫자만으로는 보이지 않으므로
                  카드가 직접 말한다.
                */}
                {card.threshold !== null ? (
                  <p
                    data-testid={`kpi-threshold-${card.id}`}
                    className="mt-1 text-xs text-zinc-500"
                  >
                    {card.threshold}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 추세 — 현재값만으로는 나아지는지 알 수 없다 (TASK-4001, 정책 4001-②) */}
      <section
        data-testid="kpi-trend"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">추세</h2>
          {trend !== null ? (
            <span className="text-xs text-zinc-500">최근 {trend.windowDays}일</span>
          ) : null}
          {trend !== null && trend.worsening > 0 ? (
            <span
              data-testid="trend-worsening-count"
              className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
            >
              나빠지는 중 {trend.worsening}개
            </span>
          ) : null}
          {trend !== null && trend.unknown > 0 ? (
            <span
              data-testid="trend-unknown-count"
              className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              낼 수 없음 {trend.unknown}개
            </span>
          ) : null}
        </div>
        {trend === null ? (
          <p className="mt-2 text-sm text-zinc-500">추세를 읽지 못했습니다.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {trend.detail}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {/* 한 번도 안 찍은 것을 "오늘 찍었다"로 적지 않는다 */}
              {trend.lastTakenAt === null
                ? "아직 스냅샷이 없습니다 — 두 점이 쌓여야 추세가 됩니다."
                : `마지막 스냅샷 ${new Date(trend.lastTakenAt).toLocaleString("ko-KR")}`}
            </p>
            <ul data-testid="trend-list" className="mt-3 grid gap-2 sm:grid-cols-3">
              {trend.trends.map((row) => (
                <li
                  key={row.kpiId}
                  data-testid={`trend-${row.kpiId}`}
                  className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{row.title}</span>
                    <span
                      data-testid={`trend-direction-${row.kpiId}`}
                      className={`rounded-full px-2 py-0.5 text-xs ${TREND_BADGE[row.direction] ?? TREND_BADGE.unknown}`}
                    >
                      {TREND_LABEL[row.direction] ?? row.direction}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {row.detail}
                  </p>
                  {/*
                    기준이 움직인 구간에서는 색의 변화가 상태의 변화가 아니다
                    (정책 3901-②의 연장) — 카드가 직접 말한다.
                  */}
                  {row.thresholdChanged ? (
                    <p
                      data-testid={`trend-threshold-changed-${row.kpiId}`}
                      className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                    >
                      이 구간에 임계값이 바뀌었습니다 — 색의 변화를 상태의 변화로
                      읽지 마세요.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 임계값 설정 — 바꾸면 화면 색이 바뀐다 (TASK-4001, 정책 4001-③) */}
      <section
        data-testid="kpi-thresholds"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-lg font-medium">임계값 설정</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          임계값을 바꾸면 <strong>아무것도 나아지지 않았는데 화면이 초록이 될 수
          있습니다</strong>. 그래서 기본값보다 느슨하게 바꾼 값은 그렇다고
          적습니다. 비우고 저장하면 기본값으로 되돌아갑니다.
        </p>
        {saveError !== null ? (
          <p
            data-testid="threshold-error"
            className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {saveError}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {thresholds.map((row) => (
            <li
              key={row.id}
              data-testid={`threshold-${row.id}`}
              className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{row.title}</span>
                <span className="text-xs text-zinc-500">
                  {row.direction === "lower-is-better" ? "작을수록 좋음" : "클수록 좋음"}
                  {" · "}
                  {row.min}~{row.max}
                  {row.unit}
                </span>
                {row.relaxed ? (
                  <span
                    data-testid={`threshold-relaxed-${row.id}`}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  >
                    느슨해진 기준 — 초록을 산 것입니다
                  </span>
                ) : null}
                {!row.isDefault && !row.relaxed ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    기본값보다 엄격
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(["good", "watch"] as const).map((bound) => (
                  <label key={bound} className="flex items-center gap-1 text-xs">
                    <span className="text-zinc-500">
                      {bound === "good" ? "정상 경계" : "주의 경계"}
                    </span>
                    <input
                      data-testid={`threshold-input-${row.id}-${bound}`}
                      type="number"
                      defaultValue={bound === "good" ? row.good : row.watch}
                      className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      onBlur={(event) => {
                        const current = String(bound === "good" ? row.good : row.watch);
                        if (event.target.value.trim() === current) {
                          return;
                        }
                        void saveThreshold(
                          `kpi.threshold.${row.id}.${bound}`,
                          event.target.value,
                        );
                      }}
                    />
                  </label>
                ))}
                <span className="text-xs text-zinc-500">
                  기본 {row.defaultGood}/{row.defaultWatch}
                  {row.unit}
                </span>
                {saving !== null && saving.startsWith(`kpi.threshold.${row.id}.`) ? (
                  <span className="text-xs text-zinc-500">저장 중…</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 임계값 변경 이력 — 기준이 언제 왜 움직였는가 (정책 4001-③) */}
      <section
        data-testid="kpi-setting-history"
        className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-lg font-medium">임계값 변경 이력</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          기준이 움직인 사실이 화면 밖에 있으면, 다음에 이 화면을 보는 사람은
          <strong> 상태가 좋아진 줄 압니다</strong>.
        </p>
        {history.length === 0 ? (
          <p data-testid="setting-history-empty" className="mt-3 text-sm text-zinc-500">
            임계값을 바꾼 기록이 없습니다 — 지금 판정은 전부 기본 기준입니다.
          </p>
        ) : (
          <ul data-testid="setting-history-list" className="mt-3 space-y-1 text-sm">
            {history.map((row) => (
              <li
                key={row.id}
                data-testid="setting-history-item"
                className="flex flex-wrap items-baseline gap-2 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-900"
              >
                <span className="font-medium">{row.title}</span>
                <span className="text-xs text-zinc-500">
                  {row.before ?? "기본값"} → {row.after ?? "기본값"}
                </span>
                {/* 판정할 수 없는 것은 안전해 보이게 적지 않는다 */}
                {row.relaxed === true ? (
                  <span
                    data-testid="setting-history-relaxed"
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  >
                    느슨해짐
                  </span>
                ) : row.relaxed === false ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    엄격해짐
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    방향을 판정할 수 없음
                  </span>
                )}
                <span className="text-xs text-zinc-500">
                  {row.actor ?? "알 수 없음"} ·{" "}
                  {new Date(row.createdAt).toLocaleString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
