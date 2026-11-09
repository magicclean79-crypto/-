"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DesignReviewDto, ProductProfileDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../../lib/auth-client";
import { captureAndReview } from "../../../lib/design-review-capture";
import { BENCHMARK_IMAGE_IDS, benchmarkVersionKey, BENCHMARK_KEY } from "../constants";
import { LIVING_GOODS_TEMPLATE_CATALOG } from "./template-catalog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface SlotState {
  profile: ProductProfileDto | null;
  review: DesignReviewDto | null;
  generating: boolean;
  reviewing: boolean;
  error: string | null;
}

async function fetchAllProfiles(): Promise<ProductProfileDto[]> {
  const response = await fetch(`${API_URL}/product-profile?take=200`, authFetchInit());
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

async function generateTemplate(templateKey: string): Promise<ProductProfileDto> {
  const response = await fetch(
    `${API_URL}/product-profile`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds: BENCHMARK_IMAGE_IDS, templateKey }),
    }),
  );
  const body = (await response.json()) as ProductProfileDto & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `생성 실패 (HTTP ${response.status})`);
  }
  return body;
}

export function TemplatesView() {
  const [slots, setSlots] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(
      LIVING_GOODS_TEMPLATE_CATALOG.map((t) => [
        t.key,
        { profile: null, review: null, generating: false, reviewing: false, error: null },
      ]),
    ),
  );
  const [loaded, setLoaded] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);

  const loadExisting = useCallback(async () => {
    const all = await fetchAllProfiles();
    const matching = all.filter((p) => benchmarkVersionKey(p.imageIds) === BENCHMARK_KEY);
    const next: Record<string, SlotState> = { ...slots };
    for (const entry of LIVING_GOODS_TEMPLATE_CATALOG) {
      const latest = matching
        .filter((p) => p.templateKey === entry.key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (latest) {
        const review = await fetchReviewFor(latest.id);
        next[entry.key] = { ...next[entry.key], profile: latest, review };
      }
    }
    setSlots(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  const generateOne = useCallback(async (templateKey: string) => {
    setSlots((prev) => ({
      ...prev,
      [templateKey]: { ...prev[templateKey], generating: true, error: null },
    }));
    try {
      const profile = await generateTemplate(templateKey);
      setSlots((prev) => ({
        ...prev,
        [templateKey]: { ...prev[templateKey], profile, review: null, generating: false },
      }));
    } catch (err) {
      setSlots((prev) => ({
        ...prev,
        [templateKey]: {
          ...prev[templateKey],
          generating: false,
          error: err instanceof Error ? err.message : "생성 실패",
        },
      }));
    }
  }, []);

  const generateAll = useCallback(async () => {
    setGeneratingAll(true);
    await Promise.all(LIVING_GOODS_TEMPLATE_CATALOG.map((t) => generateOne(t.key)));
    setGeneratingAll(false);
  }, [generateOne]);

  const runReview = useCallback(async (templateKey: string) => {
    const slot = slots[templateKey];
    if (!slot.profile?.html) return;
    setSlots((prev) => ({ ...prev, [templateKey]: { ...prev[templateKey], reviewing: true, error: null } }));
    try {
      const review = await captureAndReview({
        html: slot.profile.html,
        css: slot.profile.css ?? "",
        fileName: `template-${templateKey}.png`,
        category: `생활용품 Template 비교 (${templateKey})`,
        notes: "참고용 AI 채점 — 최종 승인은 사람이 직접 판단",
        productProfileId: slot.profile.id,
      });
      setSlots((prev) => ({ ...prev, [templateKey]: { ...prev[templateKey], review, reviewing: false } }));
    } catch (err) {
      setSlots((prev) => ({
        ...prev,
        [templateKey]: {
          ...prev[templateKey],
          reviewing: false,
          error: err instanceof Error ? err.message : "채점 실패",
        },
      }));
    }
  }, [slots]);

  if (!loaded) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => void generateAll()}
        disabled={generatingAll}
        className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {generatingAll ? "5개 템플릿 생성 중… (수십 초 소요)" : "5개 템플릿 모두 생성"}
      </button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {LIVING_GOODS_TEMPLATE_CATALOG.map((entry) => {
          const slot = slots[entry.key];
          return (
            <Card key={entry.key} title={entry.name}>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{entry.description}</p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {entry.traits.map((trait) => (
                    <div key={trait.label}>
                      <dt className="font-medium text-zinc-500">{trait.label}</dt>
                      <dd>{trait.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generateOne(entry.key)}
                    disabled={slot.generating}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {slot.generating ? "생성 중…" : slot.profile ? "다시 생성" : "이 템플릿 생성"}
                  </button>
                  {slot.profile?.html && (
                    <button
                      type="button"
                      onClick={() => void runReview(entry.key)}
                      disabled={slot.reviewing}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {slot.reviewing ? "채점 중…" : "AI 참고 채점 (선택)"}
                    </button>
                  )}
                  {slot.review?.result && (
                    <Badge tone="ok">참고 점수 {slot.review.result.overallScore}점</Badge>
                  )}
                </div>

                {slot.error && <p className="text-xs text-red-600 dark:text-red-400">{slot.error}</p>}

                {slot.profile?.status === "FAILED" && (
                  <p className="text-xs text-red-600 dark:text-red-400">{slot.profile.error}</p>
                )}

                {slot.profile?.html ? (
                  <iframe
                    title={`${entry.name} 미리보기`}
                    srcDoc={`<style>${slot.profile.css ?? ""}</style>${slot.profile.html}`}
                    sandbox=""
                    className="h-[520px] w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
                    아직 생성되지 않음
                  </div>
                )}

                {slot.profile && (
                  <Link
                    href={`/product-profile/history/${slot.profile.id}`}
                    className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
                  >
                    전체 화면으로 상세 보기 →
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
