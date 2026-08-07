"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { DesignReviewDto, DesignReviewResult } from "@acos/shared";
import { authFetchInit } from "../../../../lib/auth-client";
import { AuthImage } from "../../../product-profile/auth-image";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchRun(id: string): Promise<DesignReviewDto> {
  const response = await fetch(`${API_URL}/design-review/${id}`, authFetchInit());
  if (!response.ok) {
    throw new Error(`불러올 수 없습니다 (id: ${id}, HTTP ${response.status})`);
  }
  return response.json();
}

function DiffRow({ label, a, b }: { label: string; a: string; b: string }) {
  const changed = a !== b;
  return (
    <tr className={changed ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
      <th className="w-28 shrink-0 px-3 py-2 text-left align-top text-xs font-medium text-zinc-500">
        {label}
      </th>
      <td className="w-1/2 px-3 py-2 align-top text-sm">{a || "—"}</td>
      <td className="w-1/2 px-3 py-2 align-top text-sm">{b || "—"}</td>
    </tr>
  );
}

function fieldRows(result: DesignReviewResult | null): Record<string, string> {
  if (!result) return {};
  return {
    레이아웃: result.layout,
    타이포그래피: result.typography,
    여백: result.whitespace,
    "사진 배치": result.imagePlacement,
    "색상 사용": result.colorUsage,
    "시선 흐름": result.visualHierarchy,
    "구매 유도력": result.purchaseMotivation,
    "모바일 UX": result.mobileUx,
    강점: result.strengths.join(" · "),
    개선점: result.improvements.join(" · "),
    총평: result.summary,
  };
}

function CompareBody() {
  const searchParams = useSearchParams();
  const idA = searchParams.get("a");
  const idB = searchParams.get("b");
  const [a, setA] = useState<DesignReviewDto | null>(null);
  const [b, setB] = useState<DesignReviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idA || !idB) {
      setError("비교할 두 결과의 id가 필요합니다 (?a=...&b=...).");
      return;
    }
    Promise.all([fetchRun(idA), fetchRun(idB)])
      .then(([recordA, recordB]) => {
        setA(recordA);
        setB(recordB);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [idA, idB]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!a || !b) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  const rowsA = fieldRows(a.result);
  const rowsB = fieldRows(b.result);
  const labels = Object.keys(rowsA);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4">
        {[a, b].map((record, index) => (
          <div key={record.id}>
            <p className="text-xs font-medium text-zinc-500">
              {index === 0 ? "A" : "B"} · {record.createdAt.replace("T", " ").slice(0, 16)}
            </p>
            <p className="truncate font-semibold">
              provider: {record.provider ?? "-"} {record.result && `· ${record.result.overallScore}점`}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[a, b].map((record) => (
          <div key={record.id} className="flex flex-wrap gap-2">
            {record.imageIds.map((imageId) => (
              <AuthImage
                key={imageId}
                imageId={imageId}
                alt="평가한 스크린샷"
                className="h-32 w-32 rounded-lg object-cover"
              />
            ))}
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Provider별 평가 비교</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">항목</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">
                  {a.provider ?? "A"}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">
                  {b.provider ?? "B"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {labels.map((label) => (
                <DiffRow key={label} label={label} a={rowsA[label]} b={rowsB[label]} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/design-review/history"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 디자인 리뷰 이력
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Provider 비교</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <CompareBody />
      </Suspense>
    </main>
  );
}
