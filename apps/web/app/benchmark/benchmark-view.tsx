"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DesignReviewDto, ProductProfileDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../lib/auth-client";
import { captureAndReview } from "../../lib/design-review-capture";
import { AuthImage } from "../product-profile/auth-image";
import { BENCHMARK_IMAGE_IDS, BENCHMARK_KEY, BENCHMARK_PRODUCT_NAME, benchmarkVersionKey } from "./constants";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface VersionRow {
  profile: ProductProfileDto;
  label: string;
  review: DesignReviewDto | null;
  reviewLoading: boolean;
}

async function fetchAllProfiles(): Promise<ProductProfileDto[]> {
  const response = await fetch(`${API_URL}/product-profile?take=100`, authFetchInit());
  if (!response.ok) throw new Error(`불러올 수 없습니다 (HTTP ${response.status})`);
  const body = (await response.json()) as { results: ProductProfileDto[] };
  return body.results;
}

async function fetchReviewFor(productProfileId: string): Promise<DesignReviewDto | null> {
  const response = await fetch(
    `${API_URL}/design-review?take=1&productProfileId=${productProfileId}`,
    authFetchInit(),
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { results: DesignReviewDto[] };
  return body.results[0] ?? null;
}

function ScoreChart({ versions }: { versions: VersionRow[] }) {
  const scored = versions.filter((v) => v.review?.result);
  if (scored.length === 0) {
    return <p className="text-sm text-zinc-500">아직 점수가 기록된 버전이 없습니다.</p>;
  }
  const max = 100;
  return (
    <div className="flex items-end gap-3" style={{ height: 160 }}>
      {scored.map((v) => {
        const score = v.review!.result!.overallScore;
        const heightPct = Math.max(4, (score / max) * 100);
        return (
          <div key={v.profile.id} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-medium">{score}점</span>
            <div
              className="w-full rounded-t-md bg-blue-500 dark:bg-blue-400"
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-xs text-zinc-500">{v.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function VersionCard({
  version,
  onRunReview,
  running,
}: {
  version: VersionRow;
  onRunReview: (profile: ProductProfileDto) => void;
  running: boolean;
}) {
  const { profile, label, review, reviewLoading } = version;
  return (
    <Card title={`${label} · ${profile.createdAt.replace("T", " ").slice(0, 16)}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {profile.status === "SUCCESS" && <Badge tone="ok">생성 성공</Badge>}
          {profile.status === "FAILED" && <Badge tone="warn">생성 실패</Badge>}
          <Badge tone="ok">provider: {profile.provider ?? "-"}</Badge>
          {reviewLoading && <Badge tone="ok">점수 조회 중…</Badge>}
          {review?.result && <Badge tone="ok">AI 참고 점수 {review.result.overallScore}점 (승인 기준 아님)</Badge>}
          {review && !review.result && <Badge tone="warn">AI 참고 채점 실패</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/product-profile/history/${profile.id}`}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            HTML 상세 보기
          </Link>
          <button
            type="button"
            disabled={running || !profile.html}
            onClick={() => onRunReview(profile)}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "캡처+AI 참고 채점 중…" : review ? "AI 참고 채점 다시 실행" : "AI 참고 채점 실행 (참고용)"}
          </button>
          {review && (
            <Link
              href={`/design-review/history/${review.id}`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              리뷰 상세 보기
            </Link>
          )}
        </div>
        {profile.html && (
          <iframe
            title={`${label} 미리보기`}
            srcDoc={`<style>${profile.css ?? ""}</style>${profile.html}`}
            sandbox=""
            className="h-64 w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
          />
        )}
      </div>
    </Card>
  );
}

export function BenchmarkView() {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const all = await fetchAllProfiles();
      const matching = all
        .filter((p) => benchmarkVersionKey(p.imageIds) === BENCHMARK_KEY)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const rows: VersionRow[] = matching.map((profile, index) => ({
        profile,
        label: `V${index + 1}`,
        review: null,
        reviewLoading: true,
      }));
      setVersions(rows);
      const withReviews = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          review: await fetchReviewFor(row.profile.id),
          reviewLoading: false,
        })),
      );
      setVersions(withReviews);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/product-profile`,
        authFetchInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: BENCHMARK_IMAGE_IDS }),
        }),
      );
      const body = (await response.json()) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
        throw new Error(message ?? `재생성 실패 (HTTP ${response.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재생성 실패");
    } finally {
      setRegenerating(false);
    }
  }, [load]);

  const runReview = useCallback(
    async (profile: ProductProfileDto) => {
      if (!profile.html) return;
      setRunningId(profile.id);
      setError(null);
      try {
        await captureAndReview({
          html: profile.html,
          css: profile.css ?? "",
          fileName: `benchmark-${profile.id}.png`,
          category: `Benchmark: ${BENCHMARK_PRODUCT_NAME}`,
          notes: `Benchmark Product 참고용 AI 채점 — 최종 판단은 사람이 한다. ProductProfile ${profile.id}`,
          productProfileId: profile.id,
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "디자인 리뷰 실행 실패");
      } finally {
        setRunningId(null);
      }
    },
    [load],
  );

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!versions) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <Card title="기준 사진 (변경·삭제하지 않음)">
        <div className="flex flex-wrap gap-3">
          {BENCHMARK_IMAGE_IDS.map((imageId) => (
            <AuthImage
              key={imageId}
              imageId={imageId}
              alt="Benchmark 분사기 사진"
              className="h-24 w-24 rounded-lg object-cover"
            />
          ))}
        </div>
      </Card>

      <Card title="AI 참고 점수 추이 (승인 기준 아님 — 최종 판단은 사람이 직접 화면을 보고 합니다)">
        <ScoreChart versions={versions} />
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={regenerating}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {regenerating ? "새 버전 생성 중…" : "같은 사진으로 새 버전 생성"}
        </button>
        <button
          type="button"
          disabled={selected.length < 2}
          onClick={() => {
            window.location.href = `/benchmark/compare?ids=${selected.join(",")}`;
          }}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          선택한 {selected.length}개 버전 비교
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {versions
          .slice()
          .reverse()
          .map((version) => (
            <div key={version.profile.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-6 h-4 w-4 shrink-0"
                checked={selected.includes(version.profile.id)}
                onChange={() =>
                  setSelected((prev) => {
                    if (prev.includes(version.profile.id)) {
                      return prev.filter((x) => x !== version.profile.id);
                    }
                    if (prev.length >= 3) return [...prev.slice(1), version.profile.id];
                    return [...prev, version.profile.id];
                  })
                }
                aria-label="비교 대상으로 선택"
              />
              <div className="flex-1">
                <VersionCard
                  version={version}
                  onRunReview={runReview}
                  running={runningId === version.profile.id}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
