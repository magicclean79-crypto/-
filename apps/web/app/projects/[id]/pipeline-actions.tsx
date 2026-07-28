"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface PipelineActionsProps {
  projectId: string;
  latestVersion: number | null;
  latestStatus: string | null;
}

async function callApi(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json()) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message)
        ? data.message.join(", ")
        : data.message;
      return { ok: false, message: message ?? `실패 (HTTP ${response.status})` };
    }
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: "API 서버에 연결할 수 없습니다." };
  }
}

export function PipelineActions({
  projectId,
  latestVersion,
  latestStatus,
}: PipelineActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, path: string, method: string, body?: unknown) {
    setBusy(label);
    setError(null);
    const result = await callApi(path, method, body);
    if (!result.ok) {
      setError(result.message);
    }
    setBusy(null);
    router.refresh();
  }

  const buttonClass =
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("assemble", `/projects/${projectId}/product-object`, "POST")
          }
          className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
        >
          {busy === "assemble" ? "조립 중…" : "🧩 Product Object 조립"}
        </button>
        <button
          type="button"
          disabled={busy !== null || latestVersion === null || latestStatus !== "DRAFT"}
          onClick={() =>
            run(
              "ready",
              `/projects/${projectId}/product-object/${latestVersion}/status`,
              "PATCH",
              { status: "READY" },
            )
          }
          className={`${buttonClass} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          {busy === "ready" ? "전환 중…" : `✅ v${latestVersion ?? "-"} READY 전환`}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("content", `/projects/${projectId}/contents/generate`, "POST", {})}
          className={`${buttonClass} bg-violet-600 text-white hover:bg-violet-700`}
        >
          {busy === "content" ? "생성 중…" : "📄 상세페이지 생성"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
