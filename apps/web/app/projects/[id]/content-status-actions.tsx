"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { allowedTransitions } from "@acos/core";
import type { ContentStatus } from "@acos/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ACTION_LABELS: Record<ContentStatus, string> = {
  DRAFT: "DRAFT로 되돌리기",
  REVIEW: "검토 요청 (REVIEW)",
  PUBLISHED: "발행 (PUBLISHED)",
  ARCHIVED: "보관 (ARCHIVED)",
};

/**
 * 발행 파이프라인 상태 변경 UI (TASK-0704).
 * 현재 상태에서 가능한 전이(@acos/core allowedTransitions)만 버튼으로
 * 노출한다 — 규칙의 원천은 core 하나이며 최종 검증은 API가 수행한다.
 */
export function ContentStatusActions({
  projectId,
  contentId,
  status,
}: {
  projectId: string;
  contentId: string;
  status: ContentStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = allowedTransitions(status);

  async function transition(target: ContentStatus) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/projects/${projectId}/contents/${contentId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: target }),
        },
      );
      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        setError(data.message ?? `실패 (HTTP ${response.status})`);
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    }
    setBusy(false);
    router.refresh();
  }

  if (targets.length === 0) {
    return (
      <span className="text-xs text-zinc-400">종결됨 (전이 불가)</span>
    );
  }

  return (
    <div
      data-testid="content-status-actions"
      className="flex flex-wrap items-center gap-2"
    >
      {targets.map((target) => (
        <button
          key={target}
          type="button"
          disabled={busy}
          onClick={() => transition(target)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
            target === "PUBLISHED"
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          }`}
        >
          {ACTION_LABELS[target]}
        </button>
      ))}
      {error ? (
        <span data-testid="content-status-error" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
