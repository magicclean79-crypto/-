"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ReadinessBoardDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Production Readiness Dashboard. (TASK-4301, Sprint 43 — CTO 정책 4301-④)
 *
 * 지금 운영 상태를 알려면 화면 다섯 개를 열어야 했습니다: 활성화 조건 ·
 * 전환 검증 · 진단 · 준비 단계 · 비용. 각각은 정확한데 **한 번에 볼 수
 * 없어서** 실제로는 아무도 다 보지 않았습니다.
 *
 * ## 이 화면이 하지 않는 일: 새로 판정하는 것
 *
 * 대시보드를 만들 때 가장 하기 쉬운 실수는 자기만의 점수를 계산하는
 * 것입니다. 그러면 같은 사실에 두 개의 답이 생기고, 둘이 어긋나는 순간
 * 사람은 둘 다 안 믿습니다 — TASK-4101 라이브 검증에서 우리가 실제로 겪은
 * 결함입니다.
 *
 * 그래서 각 칸은 **어느 판정에서 온 값인지**(`source`)를 달고 다니고,
 * 진행률도 준비 단계 판정의 분모를 그대로 씁니다.
 *
 * ## 회색을 초록 옆에 두지 않습니다
 *
 * `unknown`은 "아직 모른다"이지 "괜찮다"가 아닙니다. 이 둘이 비슷하게
 * 보이면 모르는 항목이 많은 환경이 건강해 보입니다.
 */

const STATUS_LABEL: Record<string, string> = {
  ok: "정상",
  warn: "주의",
  fail: "실패",
  // **통과가 아니다** — 확인하지 못한 것이다
  unknown: "확인 못 함",
  blocked: "막힘",
};

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  // 회색으로 두면 초록 옆에서 조용한 칸이 되고, 조용한 칸은 괜찮은 칸으로
  // 읽힌다 — 그래서 테두리를 준다
  unknown:
    "border border-zinc-400 bg-transparent text-zinc-700 dark:border-zinc-500 dark:text-zinc-300",
  blocked: "bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900",
};

const READINESS_LABEL: Record<string, string> = {
  ready: "시작할 수 있음",
  blocked: "사람이 줄 것이 남음",
  "not-ready": "우리 쪽 일이 남음",
  unknown: "준비 판정을 읽지 못함",
};

export default function ReadinessBoardPage() {
  const [board, setBoard] = useState<ReadinessBoardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/ops/readiness-board`,
        authFetchInit(),
      );
      if (!response.ok) {
        setBoard(null);
        setError("운영 준비 화면을 읽지 못했습니다 (ADMIN 로그인이 필요합니다).");
        return;
      }
      setBoard((await response.json()) as ReadinessBoardDto);
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
        <h1 className="text-2xl font-semibold">운영 준비 상태</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          여섯 판정을 한 화면에 모읍니다. 이 화면은 다른 판정을 인용만 하고
          여기서 다시 판정하지 않습니다 — 같은 사실에 두 개의 답이 생기면
          어긋나는 순간 둘 다 못 믿게 됩니다.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}
      {error !== null ? (
        <p data-testid="board-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {board !== null ? (
        <>
          <section
            data-testid="readiness-summary"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">검증 준비</h2>
              <span
                data-testid="readiness-steps"
                className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {board.steps.done}/{board.steps.total} 단계
              </span>
              <span
                data-testid="readiness-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  board.readiness === "ready"
                    ? STATUS_STYLE.ok
                    : board.readiness === "unknown"
                      ? STATUS_STYLE.unknown
                      : STATUS_STYLE.warn
                }`}
              >
                {READINESS_LABEL[board.readiness] ?? board.readiness}
              </span>
              <span className="text-xs text-zinc-500">배포 단계 {board.tier}</span>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {board.detail}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">판정 모음</h2>
            <ul data-testid="readiness-tiles" className="space-y-2">
              {board.tiles.map((tile) => (
                <li
                  key={tile.id}
                  data-testid={`tile-${tile.id}`}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tile.title}</span>
                    <span
                      data-testid={`tile-status-${tile.id}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[tile.status] ?? STATUS_STYLE.unknown
                      }`}
                    >
                      {STATUS_LABEL[tile.status] ?? tile.status}
                    </span>
                    {/*
                      어느 판정에서 온 값인지 달고 다닌다 — 두 화면이 다른
                      말을 할 때 그것을 숨길 수 없어야 한다.
                    */}
                    <code
                      data-testid={`tile-source-${tile.id}`}
                      className="text-xs text-zinc-500"
                    >
                      {tile.source}
                    </code>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {tile.detail}
                  </p>
                  {tile.next !== null ? (
                    <p
                      data-testid={`tile-next-${tile.id}`}
                      className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                    >
                      다음: {tile.next}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-zinc-500">
            확인한 시각 {new Date(board.checkedAt).toLocaleString("ko-KR")}
          </p>
        </>
      ) : null}
    </main>
  );
}
