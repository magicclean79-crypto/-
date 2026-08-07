"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { DesignReviewDto, ProductProfile, ProductProfileDto } from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

interface VersionData {
  profile: ProductProfileDto;
  review: DesignReviewDto | null;
}

async function fetchProfile(id: string): Promise<ProductProfileDto> {
  const response = await fetch(`${API_URL}/product-profile/${id}`, authFetchInit());
  if (!response.ok) throw new Error(`불러올 수 없습니다 (id: ${id}, HTTP ${response.status})`);
  return response.json();
}

async function fetchReview(productProfileId: string): Promise<DesignReviewDto | null> {
  const response = await fetch(
    `${API_URL}/design-review?take=1&productProfileId=${productProfileId}`,
    authFetchInit(),
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { results: DesignReviewDto[] };
  return body.results[0] ?? null;
}

function profileFieldRows(profile: ProductProfile | null): Record<string, string> {
  if (!profile) return {};
  return {
    상품명: profile.productName,
    브랜드: profile.brand ?? "",
    특징: profile.features.join(" · "),
    구매포인트: profile.advantages.join(" · "),
    주의사항: profile.warnings.join(" · "),
  };
}

function reviewFieldRows(review: DesignReviewDto | null): Record<string, string> {
  const r = review?.result;
  if (!r) return { "디자인 점수": "리뷰 없음", 총평: "" };
  return {
    "디자인 점수": `${r.overallScore}점`,
    레이아웃: r.layout,
    "사진 배치": r.imagePlacement,
    "구매 유도력": r.purchaseMotivation,
    "모바일 UX": r.mobileUx,
    개선점: r.improvements.join(" · "),
    총평: r.summary,
  };
}

function DiffRow({ label, values }: { label: string; values: string[] }) {
  const allSame = values.every((v) => v === values[0]);
  return (
    <tr className={allSame ? "" : "bg-amber-50 dark:bg-amber-950/30"}>
      <th className="w-28 shrink-0 px-3 py-2 text-left align-top text-xs font-medium text-zinc-500">
        {label}
      </th>
      {values.map((value, i) => (
        <td key={i} className="w-1/3 px-3 py-2 align-top text-sm">
          {value || "—"}
        </td>
      ))}
    </tr>
  );
}

function CompareBody() {
  const searchParams = useSearchParams();
  const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const [data, setData] = useState<VersionData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length < 2) {
      setError("비교할 버전의 id가 2개 이상 필요합니다 (?ids=a,b,c).");
      return;
    }
    Promise.all(
      ids.map(async (id) => ({
        profile: await fetchProfile(id),
        review: await fetchReview(id),
      })),
    )
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("ids")]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  const gridClass = GRID_COLS[data.length] ?? "grid-cols-1";
  const profileRowsList = data.map((d) => profileFieldRows(d.profile.profile));
  const profileLabels = Object.keys(profileRowsList[0] ?? {});
  const reviewRowsList = data.map((d) => reviewFieldRows(d.review));
  const reviewLabels = Object.keys(reviewRowsList[0] ?? {});

  return (
    <div className="flex flex-col gap-8">
      <div className={`grid gap-4 ${gridClass}`}>
        {data.map(({ profile, review }, index) => (
          <div key={profile.id}>
            <p className="text-xs font-medium text-zinc-500">
              V{index + 1} · {profile.createdAt.replace("T", " ").slice(0, 16)}
            </p>
            <p className="truncate font-semibold">
              생성: {profile.provider ?? "-"}
              {review?.result && ` · 디자인 점수 ${review.result.overallScore}점 (${review.provider})`}
            </p>
          </div>
        ))}
      </div>

      <div className={`grid gap-4 ${gridClass}`}>
        {data.map(({ profile }) => (
          <iframe
            key={profile.id}
            title={`상세페이지 미리보기 (${profile.id})`}
            srcDoc={profile.html ? `<style>${profile.css ?? ""}</style>${profile.html}` : "<p>HTML 없음</p>"}
            sandbox=""
            className="h-[500px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Product Profile 변경된 항목</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {profileLabels.map((label) => (
                <DiffRow
                  key={label}
                  label={label}
                  values={profileRowsList.map((rows) => rows[label] ?? "")}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Gemini 디자인 리뷰 비교</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {reviewLabels.map((label) => (
                <DiffRow
                  key={label}
                  label={label}
                  values={reviewRowsList.map((rows) => rows[label] ?? "")}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">
          점수가 "리뷰 없음"이면 해당 버전에서 아직 "디자인 리뷰 실행" 버튼을 누르지 않은
          상태입니다 — Benchmark 화면에서 실행할 수 있습니다.
        </p>
      </section>
    </div>
  );
}

export default function BenchmarkComparePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/benchmark" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Benchmark Product
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Benchmark 버전 비교</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <CompareBody />
      </Suspense>
    </main>
  );
}
