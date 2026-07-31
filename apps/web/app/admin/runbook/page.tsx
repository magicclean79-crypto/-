"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivationRunbookDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 운영 활성화 런북. (TASK-4401, Sprint 44 — CTO 정책 4401-⑤)
 *
 * 준비 화면(`/admin/readiness`)이 **시작해도 되는가**에 답한다면, 이 화면은
 * **시작한 다음 무엇을 어떤 순서로 하고 잘못되면 어떻게 되돌리는가**에
 * 답합니다.
 *
 * 체크리스트와 런북의 차이는 세 가지입니다: **되돌리는 법**, **누가
 * 하는가**, **무엇이 증거인가**. 특히 되돌리는 법이 안 적힌 단계는, 사고가
 * 났을 때 그 자리에서 지어내게 됩니다.
 *
 * 이 화면도 **새로 판정하지 않습니다** — 각 단계의 상태는 이미 있는 판정을
 * 인용하고, 못 읽은 단계는 "확인 못 함"입니다.
 */

const STATE_LABEL: Record<string, string> = {
  done: "완료",
  pending: "대기",
  blocked: "막힘",
  // **통과가 아니다**
  unknown: "확인 못 함",
};

const STATE_STYLE: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  blocked: "bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900",
  unknown:
    "border border-zinc-400 bg-transparent text-zinc-700 dark:border-zinc-500 dark:text-zinc-300",
};

export default function ActivationRunbookPage() {
  const [runbook, setRunbook] = useState<ActivationRunbookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/ops/runbook`, authFetchInit());
      if (!response.ok) {
        setRunbook(null);
        setError("런북을 읽지 못했습니다 (ADMIN 로그인이 필요합니다).");
        return;
      }
      setRunbook((await response.json()) as ActivationRunbookDto);
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
        <h1 className="text-2xl font-semibold">운영 활성화 런북</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          시작해도 되는지는 운영 준비 화면이 답합니다. 이 화면은 그다음 —
          무엇을 어떤 순서로 하고, 잘못되면 어떻게 되돌리는지 — 를 적습니다.
          되돌릴 수 없는 단계는 그렇게 적혀 있습니다.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}
      {error !== null ? (
        <p data-testid="runbook-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {runbook !== null ? (
        <>
          <section
            data-testid="runbook-summary"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">진행</h2>
              <span
                data-testid="runbook-progress"
                className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {runbook.done}/{runbook.total} 단계
              </span>
              {runbook.waitingOnPeople.length > 0 ? (
                <span
                  data-testid="runbook-waiting"
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  사람이 줘야 하는 단계 {runbook.waitingOnPeople.length}건
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {runbook.detail}
            </p>
          </section>

          <ol data-testid="runbook-steps" className="space-y-2">
            {runbook.steps.map((step, index) => (
              <li
                key={step.id}
                data-testid={`runbook-${step.id}`}
                className={`rounded-xl border p-4 ${
                  step.id === runbook.nextStepId
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-500">{index + 1}.</span>
                  <span className="font-medium">{step.title}</span>
                  <span
                    data-testid={`runbook-state-${step.id}`}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATE_STYLE[step.state] ?? STATE_STYLE.unknown
                    }`}
                  >
                    {STATE_LABEL[step.state] ?? step.state}
                  </span>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {step.owner === "operator" ? "사람이 줘야 함" : "우리가 함"}
                  </span>
                  {/*
                    되돌릴 수 없는 단계 — 여기서부터 외부에 흔적이 남고 돈이
                    나갑니다.
                  */}
                  {step.irreversible ? (
                    <span
                      data-testid={`runbook-irreversible-${step.id}`}
                      className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
                    >
                      되돌릴 수 없음
                    </span>
                  ) : null}
                  {step.id === runbook.nextStepId ? (
                    <span
                      data-testid="runbook-next"
                      className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      다음 단계
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {step.why}
                </p>
                <p className="mt-1 text-xs text-zinc-500">증거: {step.evidence}</p>
                {/*
                  되돌리는 법을 화면에 함께 둡니다 — 사고가 났을 때 문서를
                  찾으러 가면 그 자리에서 지어내게 됩니다.
                */}
                <p
                  data-testid={`runbook-rollback-${step.id}`}
                  className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                >
                  되돌리기: {step.rollback}
                </p>
                <p className="mt-2 text-sm">{step.detail}</p>
                <code
                  data-testid={`runbook-source-${step.id}`}
                  className="text-xs text-zinc-500"
                >
                  {step.source}
                </code>
              </li>
            ))}
          </ol>

          <p className="text-xs text-zinc-500">
            확인한 시각 {new Date(runbook.checkedAt).toLocaleString("ko-KR")}
          </p>
        </>
      ) : null}
    </main>
  );
}
