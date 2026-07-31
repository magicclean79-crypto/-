"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { NotificationHealthDto, OpsOverviewDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 통합 운영 대시보드. (TASK-4601, Sprint 46 — CTO 정책 4601-⑤)
 *
 * 네 갈래를 한 화면에 모읍니다: Validation · Attribution · Notification ·
 * Recovery.
 *
 * ## 이 화면이 하지 않는 일
 *
 * 1. **새로 판정하지 않습니다.** 칸마다 어느 판정을 인용했는지가 붙어
 *    있습니다 — 두 화면이 다른 말을 할 때 그것을 숨길 수 없어야 합니다.
 * 2. **한 줄 요약이 못 본 것을 감추지 않습니다.** 못 읽은 갈래가 있으면
 *    요약 문장이 그것을 **먼저** 말합니다. 뒤에 붙이면 앞부분만 읽힙니다.
 * 3. **확인 못 한 칸을 정상 옆에 조용히 두지 않습니다.**
 */

const STATUS_LABEL: Record<string, string> = {
  ok: "정상",
  warn: "주의",
  fail: "실패",
  // **통과가 아니다** — 확인하지 못한 것이다
  unknown: "확인 못 함",
};

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  // 회색으로 두면 초록 옆에서 조용한 칸이 되고, 조용한 칸은 괜찮은 칸으로
  // 읽힌다 — 그래서 테두리를 준다
  unknown:
    "border border-zinc-400 bg-transparent text-zinc-700 dark:border-zinc-500 dark:text-zinc-300",
};

const CHANNEL_VERDICT_LABEL: Record<string, string> = {
  reached: "도달",
  failing: "닿지 않음",
  // 죽은 것인지 조용한 것인지 **모른다**
  silent: "확인 안 됨",
  never: "한 번도 못 닿음",
  disabled: "쓰지 않음",
};

const CHANNEL_VERDICT_STYLE: Record<string, string> = {
  reached: STATUS_STYLE.ok,
  failing: STATUS_STYLE.fail,
  silent: STATUS_STYLE.unknown,
  never: STATUS_STYLE.warn,
  disabled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function OpsOverviewPage() {
  const [overview, setOverview] = useState<OpsOverviewDto | null>(null);
  const [health, setHealth] = useState<NotificationHealthDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewResponse, healthResponse] = await Promise.all([
        fetch(`${API_URL}/ops/overview`, authFetchInit()),
        fetch(`${API_URL}/ops/notifications/health`, authFetchInit()),
      ]);
      if (!overviewResponse.ok) {
        setOverview(null);
        setError("통합 운영 화면을 읽지 못했습니다 (ADMIN 로그인이 필요합니다).");
        return;
      }
      setOverview((await overviewResponse.json()) as OpsOverviewDto);
      // 알림 상세를 못 읽어도 통합 화면은 뜹니다 — 한 갈래가 죽었다고
      // 화면이 통째로 죽으면 사람은 다시 화면 네 개를 열게 됩니다.
      setHealth(
        healthResponse.ok
          ? ((await healthResponse.json()) as NotificationHealthDto)
          : null,
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

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 홈
        </Link>
        <h1 className="text-2xl font-semibold">통합 운영 상태</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Validation · Attribution · Notification · Recovery를 한 화면에
          모읍니다. 이 화면은 다른 판정을 인용만 하고 여기서 다시 판정하지
          않습니다.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}
      {error !== null ? (
        <p data-testid="overview-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {overview !== null ? (
        <>
          <section
            data-testid="overview-summary"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">전체</h2>
              <span
                data-testid="overview-status"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  STATUS_STYLE[overview.status] ?? STATUS_STYLE.unknown
                }`}
              >
                {STATUS_LABEL[overview.status] ?? overview.status}
              </span>
              {/*
                못 읽은 것과 판정을 유보한 것을 가릅니다 (라이브에서 고침).
                둘 다 통과가 아니지만 사람이 할 일이 다릅니다 — 앞은 고칠
                버그이고 뒤는 근거가 더 필요한 일입니다.
              */}
              {overview.unread > 0 ? (
                <span
                  data-testid="overview-unread"
                  className="rounded-full border border-zinc-400 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-500 dark:text-zinc-300"
                >
                  읽지 못한 갈래 {overview.unread}개
                </span>
              ) : null}
              {overview.undecided > 0 ? (
                <span
                  data-testid="overview-undecided"
                  className="rounded-full border border-zinc-400 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-500 dark:text-zinc-300"
                >
                  판정 유보 {overview.undecided}개
                </span>
              ) : null}
            </div>
            <p
              data-testid="overview-detail"
              className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
            >
              {overview.detail}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">갈래</h2>
            <ul data-testid="overview-tiles" className="space-y-2">
              {overview.tiles.map((tile) => (
                <li
                  key={tile.id}
                  data-testid={`overview-tile-${tile.id}`}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tile.title}</span>
                    <span
                      data-testid={`overview-tile-status-${tile.id}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[tile.status] ?? STATUS_STYLE.unknown
                      }`}
                    >
                      {tile.status === "unknown"
                        ? tile.read
                          ? "판정 유보"
                          : "읽지 못함"
                        : (STATUS_LABEL[tile.status] ?? tile.status)}
                    </span>
                    <code
                      data-testid={`overview-tile-source-${tile.id}`}
                      className="text-xs text-zinc-500"
                    >
                      {tile.source}
                    </code>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">묻는 것: {tile.question}</p>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {tile.detail}
                  </p>
                  {tile.next !== null ? (
                    <p
                      data-testid={`overview-tile-next-${tile.id}`}
                      className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                    >
                      다음: {tile.next}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {health !== null ? (
            <section
              data-testid="overview-channels"
              className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="text-lg font-medium">
                알림 채널 (최근 {health.windowHours}시간)
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {health.detail}
              </p>
              <ul className="space-y-1">
                {health.channels.map((channel) => (
                  <li
                    key={channel.channel}
                    data-testid={`channel-${channel.channel}`}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-medium">{channel.channel}</span>
                    <span
                      data-testid={`channel-verdict-${channel.channel}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        CHANNEL_VERDICT_STYLE[channel.verdict] ?? STATUS_STYLE.unknown
                      }`}
                    >
                      {CHANNEL_VERDICT_LABEL[channel.verdict] ?? channel.verdict}
                    </span>
                    <span className="text-xs text-zinc-500">{channel.detail}</span>
                  </li>
                ))}
              </ul>
              <p
                data-testid="owner-contacts"
                className="text-xs text-zinc-500"
              >
                {health.ownersDetail}
              </p>
              <p data-testid="teams-format" className="text-xs text-zinc-500">
                {health.teamsFormatDetail}
              </p>
            </section>
          ) : null}

          <p className="text-xs text-zinc-500">
            확인한 시각 {new Date(overview.checkedAt).toLocaleString("ko-KR")}
          </p>
        </>
      ) : null}
    </main>
  );
}
