"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DesignReviewDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../../../lib/auth-client";
import { AuthImage } from "../../../product-profile/auth-image";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchRun(id: string): Promise<DesignReviewDto> {
  const response = await fetch(`${API_URL}/design-review/${id}`, authFetchInit());
  if (!response.ok) {
    throw new Error(`불러올 수 없습니다 (HTTP ${response.status})`);
  }
  return response.json();
}

export function DesignReviewDetail({ id }: { id: string }) {
  const [record, setRecord] = useState<DesignReviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRun(id)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [id]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!record) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  const r = record.result;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{record.category}</h1>
        {record.status === "SUCCESS" && <Badge tone="ok">성공</Badge>}
        {record.status === "FAILED" && <Badge tone="warn">실패</Badge>}
        {r && <Badge tone="ok">{r.overallScore}점</Badge>}
      </div>
      <p className="text-xs text-zinc-500">
        생성 {record.createdAt.replace("T", " ").slice(0, 19)} · id {record.id} · provider{" "}
        {record.provider ?? "-"}
      </p>
      {record.notes && <p className="text-sm text-zinc-600 dark:text-zinc-400">참고: {record.notes}</p>}

      {record.status === "FAILED" && (
        <p className="text-sm text-red-600 dark:text-red-400">{record.error}</p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">평가한 스크린샷 ({record.imageIds.length}장)</h2>
        <div className="flex flex-wrap gap-3">
          {record.imageIds.map((imageId) => (
            <AuthImage
              key={imageId}
              imageId={imageId}
              alt="평가한 스크린샷"
              className="h-40 w-40 rounded-lg object-cover"
            />
          ))}
        </div>
      </section>

      {r && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">평가 결과</h2>
          <Card title="총평">
            <p className="text-sm">{r.summary}</p>
          </Card>
          <Card title="세부 평가">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["레이아웃", r.layout],
                  ["타이포그래피", r.typography],
                  ["여백", r.whitespace],
                  ["사진 배치", r.imagePlacement],
                  ["색상 사용", r.colorUsage],
                  ["시선 흐름", r.visualHierarchy],
                  ["구매 유도력", r.purchaseMotivation],
                  ["모바일 UX", r.mobileUx],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-zinc-500">{label}</dt>
                  <dd className="text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="강점 / 개선점">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-zinc-500">강점</p>
                <ul className="list-inside list-disc text-sm">
                  {r.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500">개선점</p>
                <ul className="list-inside list-disc text-sm">
                  {r.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </section>
      )}

      <Link
        href="/design-review/history"
        className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
      >
        ← 이력으로 돌아가기
      </Link>
    </div>
  );
}
