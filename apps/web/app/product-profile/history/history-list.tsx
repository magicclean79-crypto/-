"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProductProfileDto } from "@acos/shared";
import { Badge } from "@acos/ui";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** 사진 구성이 같으면 "같은 제품의 다른 버전"으로 본다(재생성은 항상 같은 imageIds로 실행된다) */
function versionKey(imageIds: string[]): string {
  return [...imageIds].sort().join(",");
}

function formatDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

async function fetchHistory(): Promise<ProductProfileDto[]> {
  const response = await fetch(`${API_URL}/product-profile?take=100`, authFetchInit());
  if (!response.ok) {
    throw new Error(`이력을 불러올 수 없습니다 (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { results: ProductProfileDto[] };
  return body.results;
}

export function HistoryList() {
  const router = useRouter();
  const [items, setItems] = useState<ProductProfileDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    fetchHistory()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  // 같은 사진 구성(=같은 제품)이 몇 번 생성됐는지 — "버전 N개" 표시용
  const versionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items ?? []) {
      const key = versionKey(item.imageIds);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!items) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        아직 생성한 결과가 없습니다.{" "}
        <Link href="/product-profile" className="underline">
          여기서 첫 상세페이지를 만들어보세요.
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          총 {items.length}건 · 체크박스로 2개를 고르면 나란히 비교할 수 있습니다.
        </p>
        <button
          type="button"
          disabled={selected.length !== 2}
          onClick={() =>
            router.push(`/product-profile/history/compare?a=${selected[0]}&b=${selected[1]}`)
          }
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          선택한 2개 비교
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const count = versionCounts.get(versionKey(item.imageIds)) ?? 1;
          return (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggleSelect(item.id)}
                aria-label="비교 대상으로 선택"
                className="h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">
                    {item.profile?.productName ?? "(상품명 없음)"}
                  </p>
                  {item.status === "SUCCESS" && <Badge tone="ok">성공</Badge>}
                  {item.status === "FAILED" && <Badge tone="warn">실패</Badge>}
                  {(item.status === "PENDING" || item.status === "RUNNING") && (
                    <Badge tone="warn">{item.status}</Badge>
                  )}
                  {count > 1 && <Badge tone="ok">버전 {count}개</Badge>}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatDateTime(item.createdAt)} · 사진 {item.imageIds.length}장 ·{" "}
                  {item.provider ?? "provider 미기록"}
                </p>
              </div>
              <Link
                href={`/product-profile/history/${item.id}`}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                보기
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
