"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ProductProfile, ProductProfileDto } from "@acos/shared";
import { authFetchInit } from "../../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchRun(id: string): Promise<ProductProfileDto> {
  const response = await fetch(`${API_URL}/product-profile/${id}`, authFetchInit());
  if (!response.ok) {
    throw new Error(`불러올 수 없습니다 (id: ${id}, HTTP ${response.status})`);
  }
  return response.json();
}

/** 두 버전 사이에 값이 다른 필드만 강조한다 — "변경된 항목 표시" */
function DiffRow({
  label,
  a,
  b,
}: {
  label: string;
  a: string;
  b: string;
}) {
  const changed = a !== b;
  return (
    <tr className={changed ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
      <th className="w-28 shrink-0 px-3 py-2 text-left align-top text-xs font-medium text-zinc-500">
        {label}
        {changed && (
          <span className="ml-1 text-amber-600 dark:text-amber-400" aria-label="변경됨">
            ●
          </span>
        )}
      </th>
      <td className="w-1/2 px-3 py-2 align-top text-sm">{a || "—"}</td>
      <td className="w-1/2 px-3 py-2 align-top text-sm">{b || "—"}</td>
    </tr>
  );
}

function fieldRows(profile: ProductProfile | null): Record<string, string> {
  if (!profile) return {};
  return {
    상품명: profile.productName,
    브랜드: profile.brand ?? "",
    모델: profile.model ?? "",
    재질: profile.material ?? "",
    특징: profile.features.join(" · "),
    구매포인트: profile.advantages.join(" · "),
    스펙: Object.entries(profile.specifications)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · "),
    사용방법: profile.usage ?? "",
    주의사항: profile.warnings.join(" · "),
    키워드: profile.keywords.join(", "),
  };
}

function CompareBody() {
  const searchParams = useSearchParams();
  const idA = searchParams.get("a");
  const idB = searchParams.get("b");
  const [a, setA] = useState<ProductProfileDto | null>(null);
  const [b, setB] = useState<ProductProfileDto | null>(null);
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

  const rowsA = fieldRows(a.profile);
  const rowsB = fieldRows(b.profile);
  const labels = Object.keys(rowsA);
  const headlineChanged = a.pageCopy?.headline !== b.pageCopy?.headline;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4">
        {[a, b].map((record, index) => (
          <div key={record.id}>
            <p className="text-xs font-medium text-zinc-500">
              버전 {index === 0 ? "A" : "B"} · {record.createdAt.replace("T", " ").slice(0, 16)}
            </p>
            <p className="truncate font-semibold">{record.profile?.productName}</p>
          </div>
        ))}
      </div>

      {/* HTML 나란히 비교 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[a, b].map((record) => (
          <iframe
            key={record.id}
            title={`상세페이지 미리보기 (${record.id})`}
            srcDoc={record.html ? `<style>${record.css ?? ""}</style>${record.html}` : "<p>HTML 없음</p>"}
            sandbox=""
            className="h-[600px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
        ))}
      </div>

      {/* 변경된 항목 표시 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">변경된 항목</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">필드</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">버전 A</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">버전 B</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <DiffRow
                label="대표 문구"
                a={a.pageCopy?.headline ?? ""}
                b={b.pageCopy?.headline ?? ""}
              />
              {labels.map((label) => (
                <DiffRow key={label} label={label} a={rowsA[label]} b={rowsB[label]} />
              ))}
            </tbody>
          </table>
        </div>
        {!headlineChanged && labels.every((l) => rowsA[l] === rowsB[l]) && (
          <p className="text-xs text-zinc-500">두 버전의 내용이 동일합니다.</p>
        )}
      </section>
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/product-profile/history"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 생성 이력
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">버전 비교</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <CompareBody />
      </Suspense>
    </main>
  );
}
