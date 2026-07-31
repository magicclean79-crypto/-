"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { GoLiveChecklistDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 최종 Go-Live 체크리스트. (TASK-4501, Sprint 45 — CTO 정책 4501-⑤)
 *
 * 런북이 "하는 순서"를 보여 준다면, 이 화면은 마지막 질문 하나에 답합니다 —
 * **이제 운영이라고 말해도 되는가.**
 *
 * ## 이 화면이 하지 않는 일
 *
 * 1. **새로 판정하지 않습니다.** 항목마다 어느 판정을 인용했는지가 붙어
 *    있습니다 — 두 화면이 다른 말을 할 때 그것을 숨길 수 없어야 합니다.
 * 2. **검증 전에 진행률을 앞세우지 않습니다.** 검증이 성공하지 않은 상태에서
 *    "7/8 완료"라고 크게 적으면, 빠진 하나가 전부인 상황에서 숫자가 진행을
 *    흉내 냅니다.
 * 3. **선언하지 않습니다.** 마지막 문장은 사람이 씁니다.
 */

const STATE_LABEL: Record<string, string> = {
  met: "충족",
  unmet: "미충족",
  // **통과가 아니다** — 확인하지 못한 것이다
  unknown: "확인 못 함",
};

const STATE_STYLE: Record<string, string> = {
  met: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  unmet: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  // 회색으로 두면 초록 옆에서 조용한 칸이 되고, 조용한 칸은 괜찮은 칸으로
  // 읽힌다 — 그래서 테두리를 준다
  unknown:
    "border border-zinc-400 bg-transparent text-zinc-700 dark:border-zinc-500 dark:text-zinc-300",
};

const VERDICT_LABEL: Record<string, string> = {
  "not-started": "아직 시작하지 않음",
  incomplete: "남은 조건이 있음",
  declarable: "선언 가능 (선언은 사람이 합니다)",
};

export default function GoLivePage() {
  const [board, setBoard] = useState<GoLiveChecklistDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/ops/go-live`, authFetchInit());
      if (!response.ok) {
        setBoard(null);
        setError("Go-Live 화면을 읽지 못했습니다 (ADMIN 로그인이 필요합니다).");
        return;
      }
      setBoard((await response.json()) as GoLiveChecklistDto);
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
        <h1 className="text-2xl font-semibold">최종 Go-Live 체크리스트</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          이 화면은 다른 판정을 인용만 하고 여기서 다시 판정하지 않습니다.
          확인하지 못한 항목은 통과가 아니라 확인 못 한 것으로 셉니다.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}
      {error !== null ? (
        <p data-testid="go-live-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {board !== null ? (
        <>
          <section
            data-testid="go-live-summary"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">판정</h2>
              <span
                data-testid="go-live-verdict"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  board.verdict === "declarable"
                    ? STATE_STYLE.met
                    : board.verdict === "not-started"
                      ? STATE_STYLE.unknown
                      : STATE_STYLE.unmet
                }`}
              >
                {VERDICT_LABEL[board.verdict] ?? board.verdict}
              </span>
              {/*
                검증 전에는 진행률을 크게 쓰지 않는다 — 빠진 하나가 전부인
                상황에서 숫자가 진행을 흉내 낸다.
              */}
              {board.verdict === "not-started" ? null : (
                <span
                  data-testid="go-live-progress"
                  className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {board.met}/{board.total} 조건
                </span>
              )}
            </div>
            <p
              data-testid="go-live-detail"
              className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
            >
              {board.detail}
            </p>
          </section>

          <section
            data-testid="go-live-validation"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-lg font-medium">마지막 실 Validation</h2>
            {board.lastValidation === null ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                아직 한 번도 돌린 적이 없습니다 — 실패가 아니라 안 한
                것입니다. 준비가 끝나면 POST /ops/validation-run/execute가
                실행합니다.
              </p>
            ) : (
              <div className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <p data-testid="validation-detail">
                  {board.lastValidation.detail}
                </p>
                <p className="text-xs text-zinc-500">
                  실 호출 {board.lastValidation.realCalls}건 · 스텁 응답{" "}
                  {board.lastValidation.stubbedCalls}건 ·{" "}
                  {new Date(board.lastValidation.startedAt).toLocaleString("ko-KR")}
                </p>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Go-Live 조건</h2>
            <ul data-testid="go-live-items" className="space-y-2">
              {board.items.map((item) => (
                <li
                  key={item.id}
                  data-testid={`go-live-item-${item.id}`}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <span
                      data-testid={`go-live-state-${item.id}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATE_STYLE[item.state] ?? STATE_STYLE.unknown
                      }`}
                    >
                      {STATE_LABEL[item.state] ?? item.state}
                    </span>
                    <code
                      data-testid={`go-live-source-${item.id}`}
                      className="text-xs text-zinc-500"
                    >
                      {item.source}
                    </code>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {item.detail}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">왜: {item.why}</p>
                  <p className="text-xs text-zinc-500">증거: {item.evidence}</p>
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
