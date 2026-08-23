"use client";

import { useEffect, useRef, useState } from "react";
import {
  MultiApiError,
  fetchMultiGeneration,
  fetchPageImageUrl,
  type FieldVerificationDto,
  type Level1DetailPageDto,
  type Level1MultiGenerationDto,
  type VerifiedProductFacts,
} from "./multi-client";

interface PageWithImage {
  page: Level1DetailPageDto;
  imageUrl: string | null;
}

const UNVERIFIED = "확인되지 않음";

const FACT_ROWS: { key: keyof VerifiedProductFacts; label: string }[] = [
  { key: "name", label: "제품명" },
  { key: "brand", label: "브랜드" },
  { key: "model", label: "모델명" },
  { key: "manufacturer", label: "제조사" },
  { key: "originCountry", label: "제조국/원산지" },
  { key: "materials", label: "소재" },
  { key: "dimensions", label: "규격/크기" },
  { key: "includedComponents", label: "구성품" },
  { key: "cautions", label: "주의사항" },
];

const ROLE_LABEL: Record<string, string> = {
  HERO: "대표 이미지",
  FEATURES: "핵심 특징",
  USE: "사용 장면",
  COMPONENTS: "구성품",
  GALLERY: "갤러리",
};

/** factsVerification의 field 이름(VerifiedProductFacts 키)을 화면 라벨로 바꾼다(T1-196). */
const VERIFICATION_FIELD_LABEL: Record<string, string> = {
  brand: "브랜드",
  model: "모델명",
  manufacturer: "제조사",
  originCountry: "제조국/원산지",
  dimensions: "규격/크기",
};

function formatFact(value: string | string[] | null): string {
  if (value === null) return UNVERIFIED;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : UNVERIFIED;
  return value;
}

function roleLabel(role: string): string {
  return ROLE_LABEL[role.trim().toUpperCase()] ?? role;
}

/**
 * 완성된 상세페이지 전체를 한 화면에서 스크롤로 볼 수 있게 조립한다
 * (T1-195). visual section 이미지는 generation.pages를 pageIndex 순서
 * 그대로 따르고, 정확성이 필요한 PRODUCT INFO는 이미지가 아니라
 * 구조화된 HTML(dl)로 렌더링해 한글이 깨지지 않는다 — 마지막 COMPONENTS
 * 섹션 바로 뒤(없으면 맨 끝)에 배치한다.
 */
export default function DetailPageView({ generationId }: { generationId: string }) {
  const [generation, setGeneration] = useState<Level1MultiGenerationDto | null>(null);
  const [pageImages, setPageImages] = useState<PageWithImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageImagesRef = useRef<PageWithImage[]>([]);
  pageImagesRef.current = pageImages;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchMultiGeneration(generationId);
        if (cancelled) return;
        setGeneration(result);

        const loaded = await Promise.all(
          result.pages
            .filter((page) => page.status === "SUCCEEDED")
            .map(async (page) => {
              try {
                const imageUrl = await fetchPageImageUrl(page.id);
                return { page, imageUrl };
              } catch {
                return { page, imageUrl: null };
              }
            }),
        );
        if (cancelled) return;
        setPageImages(loaded);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof MultiApiError ? err.message : "알 수 없는 오류");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      pageImagesRef.current.forEach((p) => {
        if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
      });
    };
  }, [generationId]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <p role="status" data-testid="detail-page-loading" className="text-sm text-zinc-500">
          상세페이지를 불러오는 중…
        </p>
      </main>
    );
  }

  if (error || !generation) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <p role="alert" data-testid="detail-page-error" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          상세페이지를 불러올 수 없습니다: {error ?? "알 수 없는 오류"}
        </p>
      </main>
    );
  }

  const facts = generation.verifiedProductFacts;
  const orderedPages = [...generation.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const lastComponentsIndex = [...orderedPages]
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.pageRole.trim().toUpperCase() === "COMPONENTS")
    .map(({ i }) => i)
    .pop();
  const productInfoInsertAfter = lastComponentsIndex ?? orderedPages.length - 1;

  const imageByPageId = new Map(pageImages.map((p) => [p.page.id, p.imageUrl]));
  const succeededCount = generation.pages.filter((p) => p.status === "SUCCEEDED").length;
  const failedCount = generation.pages.filter((p) => p.status === "FAILED").length;
  const aiCallCount = (generation.analysisProvider ? 1 : 0) + generation.pages.length;

  const conflicts = generation.factsVerification.filter((f) => f.status === "conflict");

  const productInfoSection = facts ? (
    <section
      key="product-info"
      data-testid="detail-page-product-info"
      className="flex flex-col gap-2 rounded border border-zinc-200 p-4"
    >
      <h2 className="text-sm font-semibold">제품 정보</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        {FACT_ROWS.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className={formatFact(facts[key] as string | string[] | null) === UNVERIFIED ? "text-zinc-400" : ""}>
              {formatFact(facts[key] as string | string[] | null)}
            </dd>
          </div>
        ))}
        {Object.keys(facts.specs).length > 0 && (
          <>
            <dt className="text-zinc-500">주요 사양</dt>
            <dd>
              {Object.entries(facts.specs)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </dd>
          </>
        )}
      </dl>
      {conflicts.length > 0 && (
        <div
          data-testid="detail-page-facts-conflict"
          className="mt-2 flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
        >
          <p className="font-semibold">OCR 원문과 AI 분석이 다르게 말하는 항목이 있습니다 — 사람이 원문을 직접 확인해야 합니다.</p>
          {conflicts.map((f: FieldVerificationDto) => (
            <p key={f.field}>
              {VERIFICATION_FIELD_LABEL[f.field] ?? f.field}:{" "}
              {f.observations.map((o) => `${o.source === "vision-analysis" ? "AI 분석" : o.source} = "${o.value}"`).join(" / ")}
            </p>
          ))}
        </div>
      )}
    </section>
  ) : null;

  const sections: React.ReactNode[] = [];
  orderedPages.forEach((page, index) => {
    if (page.status === "SUCCEEDED") {
      const imageUrl = imageByPageId.get(page.id);
      sections.push(
        <figure
          key={page.id}
          data-testid="detail-page-section"
          data-page-role={page.pageRole}
          className="flex flex-col gap-2"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={page.title ?? roleLabel(page.pageRole)}
              className="w-full rounded border border-zinc-200"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-zinc-300 text-xs text-zinc-400">
              이미지를 불러올 수 없습니다
            </div>
          )}
          {page.sectionDescription && (
            <p data-testid="detail-page-section-description" className="text-sm text-zinc-700">
              {page.sectionDescription}
            </p>
          )}
          <figcaption className="text-xs text-zinc-400">
            {page.pageIndex}. {page.title ?? roleLabel(page.pageRole)} ({roleLabel(page.pageRole)})
            {page.descriptionConfidence !== null && (
              <> · 설명 신뢰도 {Math.round(page.descriptionConfidence * 100)}%</>
            )}
          </figcaption>
        </figure>,
      );
    } else if (page.status === "FAILED") {
      sections.push(
        <div
          key={page.id}
          data-testid="detail-page-section-failed"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700"
        >
          {page.pageIndex}. {roleLabel(page.pageRole)} 섹션 생성 실패: {page.errorMessage ?? "알 수 없는 오류"}
        </div>,
      );
    }
    if (index === productInfoInsertAfter && productInfoSection) {
      sections.push(productInfoSection);
    }
  });
  if (orderedPages.length === 0 && productInfoSection) {
    sections.push(productInfoSection);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-6" data-testid="detail-page-view">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{facts?.name ?? "상세페이지"}</h1>
        {generation.status === "PARTIAL" && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
            일부 섹션 생성에 실패했습니다({failedCount}개). 성공한 섹션만 표시합니다.
          </p>
        )}
      </header>

      <div className="flex flex-col gap-6">{sections}</div>

      {generation.ocrResults.length > 0 && (
        <section
          data-testid="detail-page-ocr-results"
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
        >
          <h2 className="text-sm font-semibold">OCR 원문 (업로드 사진 전체)</h2>
          {generation.ocrResults.map((r) => (
            <div key={r.assetId} className="flex flex-col gap-1 border-t border-zinc-100 pt-2 text-xs first:border-t-0 first:pt-0">
              <p className="text-zinc-500">
                사진 {r.assetId} · {r.status ?? "미실행"}
                {r.confidence !== null && <> · 신뢰도 {Math.round(r.confidence * 100)}%</>}
                {r.boundingBoxCount > 0 && <> · 텍스트 블록 {r.boundingBoxCount}개</>}
              </p>
              {r.extractedText ? (
                <pre className="whitespace-pre-wrap rounded bg-zinc-50 p-2 text-zinc-700">{r.extractedText}</pre>
              ) : (
                <p className="text-zinc-400">{r.error ?? "인식된 글자가 없습니다."}</p>
              )}
            </div>
          ))}
        </section>
      )}

      <footer
        data-testid="detail-page-metadata"
        className="flex flex-col gap-1 border-t border-zinc-200 pt-4 text-xs text-zinc-400"
      >
        <p>생성 ID: {generation.id}</p>
        <p>
          섹션: 성공 {succeededCount}장 · 실패 {failedCount}장 · AI 호출 수(분석 1회 + 섹션 이미지):{" "}
          {aiCallCount}회
        </p>
        {generation.productFactsProvenance && (
          <p>
            제품 정보 근거: {generation.productFactsProvenance.provider ?? "미확인"}/
            {generation.productFactsProvenance.model ?? "미확인"} 비전 분석 — 업로드 사진{" "}
            {generation.productFactsProvenance.analyzedAssetIds.length}장 분석, 그중 실제 제품 사진{" "}
            {generation.productFactsProvenance.actualProductAssetIds.length}장을 시각 섹션 reference로 사용
          </p>
        )}
      </footer>
    </main>
  );
}
