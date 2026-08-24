"use client";

import { useEffect, useRef, useState } from "react";
import {
  MultiApiError,
  fetchAssetImageUrl,
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

interface AssetWithImage {
  assetId: string;
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

function byRole(pages: Level1DetailPageDto[], role: string): Level1DetailPageDto[] {
  return pages.filter((p) => p.status === "SUCCEEDED" && p.pageRole.trim().toUpperCase() === role);
}

/**
 * 완성된 상세페이지 전체를 실제 판매용 상업 레이아웃으로 조립한다(T1-197).
 * 배치·계층은 `generation.designSystem`(백엔드 규칙이 고른 template +
 * design token, `apps/api/src/level1-multi/design-system.ts`)을 그대로
 * 구현만 한다 — 색·간격을 이 컴포넌트가 스스로 정하지 않는다.
 *
 * HERO/GALLERY는 Gemini 생성물이 아니라 원본 업로드 사진(가공 없음)을
 * 그대로 쓴다 — 가장 눈에 많이 띄는 자리에서 생성 리스크를 제거하기
 * 위함(MASTER_GUIDE "제품 동일성이 이미지 품질보다 우선"). 핵심 포인트·
 * 제품 디테일·사용/구성 섹션은 Gemini가 실제 제품 사진을 reference로
 * 받아 만든 클로즈업/장면 이미지를 쓴다(원본 3장을 좌표 없이 임의로
 * 잘라내는 것보다, 실제로 그 부분을 보고 구도를 잡은 결과가 더
 * 정확하다고 판단했다).
 */
export default function DetailPageView({ generationId }: { generationId: string }) {
  const [generation, setGeneration] = useState<Level1MultiGenerationDto | null>(null);
  const [pageImages, setPageImages] = useState<PageWithImage[]>([]);
  const [assetImages, setAssetImages] = useState<AssetWithImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchMultiGeneration(generationId);
        if (cancelled) return;
        setGeneration(result);

        const loadedPages = await Promise.all(
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
        setPageImages(loadedPages);

        const rawAssetIds = result.productFactsProvenance?.actualProductAssetIds ?? [];
        const loadedAssets = await Promise.all(
          rawAssetIds.map(async (assetId) => {
            try {
              const imageUrl = await fetchAssetImageUrl(assetId);
              return { assetId, imageUrl };
            } catch {
              return { assetId, imageUrl: null };
            }
          }),
        );
        if (cancelled) return;
        setAssetImages(loadedAssets);
        objectUrlsRef.current = [
          ...loadedPages.map((p) => p.imageUrl).filter((v): v is string => Boolean(v)),
          ...loadedAssets.map((a) => a.imageUrl).filter((v): v is string => Boolean(v)),
        ];
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
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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

  const tokens = generation.designSystem.tokens;
  const facts = generation.verifiedProductFacts;
  const orderedPages = [...generation.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const imageByPageId = new Map(pageImages.map((p) => [p.page.id, p.imageUrl]));
  const rawAssetUrlById = new Map(assetImages.map((a) => [a.assetId, a.imageUrl]));

  const heroPages = byRole(orderedPages, "HERO");
  const featuresPages = byRole(orderedPages, "FEATURES");
  const usePages = byRole(orderedPages, "USE");
  const componentsPages = byRole(orderedPages, "COMPONENTS");
  const galleryRolePages = byRole(orderedPages, "GALLERY");

  const rawHeroAssetId = generation.productFactsProvenance?.actualProductAssetIds?.[0] ?? null;
  const rawHeroUrl = rawHeroAssetId ? rawAssetUrlById.get(rawHeroAssetId) ?? null : null;
  const heroFallbackPage = heroPages[0];
  const heroImageUrl = rawHeroUrl ?? (heroFallbackPage ? imageByPageId.get(heroFallbackPage.id) ?? null : null);

  const benefitPages = featuresPages.slice(0, 3);
  const detailPages = [...featuresPages.slice(3), ...galleryRolePages];
  const usageSectionPages = [...usePages, ...componentsPages];

  const closingGalleryAssetIds = generation.productFactsProvenance?.actualProductAssetIds ?? [];

  const failedCount = generation.pages.filter((p) => p.status === "FAILED").length;
  const succeededCount = generation.pages.filter((p) => p.status === "SUCCEEDED").length;
  const aiCallCount = (generation.analysisProvider ? 1 : 0) + generation.pages.length;
  const conflicts = generation.factsVerification.filter((f) => f.status === "conflict");

  const heroValueProp = heroFallbackPage?.sectionDescription ?? null;

  const specChips: { label: string; value: string }[] = [];
  if (facts?.dimensions) specChips.push({ label: "규격", value: facts.dimensions });
  if (facts?.materials && facts.materials.length > 0) specChips.push({ label: "소재", value: facts.materials.join(", ") });
  if (facts?.originCountry) specChips.push({ label: "원산지", value: facts.originCountry });
  if (facts?.manufacturer) specChips.push({ label: "제조사", value: facts.manufacturer });

  const pageStyle: React.CSSProperties = {
    background: tokens.background,
    color: tokens.text,
    fontFamily: tokens.fontBody,
  };
  const headingStyle: React.CSSProperties = { fontFamily: tokens.fontHeading, color: tokens.text };
  const mutedStyle: React.CSSProperties = { color: tokens.mutedText };
  const dividerStyle: React.CSSProperties = { borderTop: tokens.dividerStyle };
  // Tailwind는 런타임에 조립한 클래스 문자열(예: `pt-[${value}]`)을 빌드 시점에
  // 스캔할 수 없어 인라인 style로 처리한다 — clamp()로 모바일→데스크톱 토큰
  // 값 사이를 부드럽게 보간한다(별도 브레이크포인트 클래스 불필요).
  const sectionPaddingBlock = `clamp(${tokens.sectionSpacing.mobile}, 6vw, ${tokens.sectionSpacing.desktop})`;
  const sectionPadding: React.CSSProperties = {
    paddingTop: sectionPaddingBlock,
    paddingBottom: sectionPaddingBlock,
  };

  return (
    <main data-testid="detail-page-view" style={pageStyle} className="min-h-screen">
      <div className="mx-auto flex flex-col px-5" style={{ maxWidth: tokens.maxWidth }}>
        {generation.status === "PARTIAL" && (
          <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
            일부 섹션 생성에 실패했습니다({failedCount}개). 성공한 섹션만 표시합니다.
          </p>
        )}

        {/* 1. HERO */}
        <section data-testid="detail-page-hero" className="flex flex-col gap-6 pt-8" style={sectionPadding}>
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt={facts?.name ?? "제품 대표 이미지"}
              className="w-full object-cover"
              style={{ borderRadius: tokens.imageRadius, aspectRatio: "4 / 5" }}
            />
          ) : (
            <div
              className="flex aspect-square w-full items-center justify-center border border-dashed text-xs"
              style={{ ...mutedStyle, borderRadius: tokens.imageRadius }}
            >
              대표 이미지를 불러올 수 없습니다
            </div>
          )}
          <div className="flex flex-col gap-3">
            <h1 style={{ ...headingStyle, fontSize: tokens.headingScale.hero, lineHeight: 1.25, fontWeight: 700 }}>
              {facts?.name ?? "상세페이지"}
            </h1>
            {heroValueProp && (
              <p style={{ ...mutedStyle, fontSize: tokens.bodyScale.base, lineHeight: 1.6 }}>{heroValueProp}</p>
            )}
            {specChips.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {specChips.map((chip) => (
                  <div key={chip.label} className="flex flex-col gap-0.5 border-t pt-2" style={{ borderColor: tokens.accentSoft }}>
                    <dt
                      style={{ color: tokens.mutedText, fontSize: tokens.headingScale.label, letterSpacing: "0.04em" }}
                      className="uppercase"
                    >
                      {chip.label}
                    </dt>
                    <dd style={{ fontSize: tokens.bodyScale.small, fontWeight: 600 }}>{chip.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>

        {/* 2. 핵심 포인트 */}
        {benefitPages.length > 0 && (
          <section
            data-testid="detail-page-benefits"
            style={{ ...dividerStyle, ...sectionPadding }}
            className="flex flex-col gap-10"
          >
            <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h2, fontWeight: 700 }}>핵심 포인트</h2>
            <div
              className="grid gap-8"
              style={{ gridTemplateColumns: `repeat(${tokens.grid.benefitColumns}, minmax(0, 1fr))` }}
            >
              {benefitPages.map((page, i) => {
                const imageUrl = imageByPageId.get(page.id) ?? null;
                return (
                  <figure key={page.id} data-testid="detail-page-benefit" className="flex flex-col gap-3">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={page.title ?? "핵심 포인트"}
                        className="w-full object-cover"
                        style={{ borderRadius: tokens.imageRadius, aspectRatio: "5 / 4" }}
                      />
                    ) : (
                      <div
                        className="flex aspect-[5/4] w-full items-center justify-center border border-dashed text-xs"
                        style={{ ...mutedStyle, borderRadius: tokens.imageRadius }}
                      >
                        이미지를 불러올 수 없습니다
                      </div>
                    )}
                    <figcaption className="flex flex-col gap-1">
                      <span style={{ color: tokens.accent, fontSize: tokens.headingScale.label, fontWeight: 700 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ ...headingStyle, fontSize: tokens.headingScale.h3, fontWeight: 600 }}>
                        {page.title ?? roleLabel(page.pageRole)}
                      </span>
                      {page.sectionDescription && (
                        <span style={{ ...mutedStyle, fontSize: tokens.bodyScale.small }}>{page.sectionDescription}</span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        {/* 3. 제품 디테일 */}
        {detailPages.length > 0 && (
          <section
            data-testid="detail-page-details"
            style={{ ...dividerStyle, ...sectionPadding }}
            className="flex flex-col gap-10"
          >
            <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h2, fontWeight: 700 }}>제품 디테일</h2>
            <div className="flex flex-col gap-10">
              {detailPages.map((page) => {
                const imageUrl = imageByPageId.get(page.id) ?? null;
                return (
                  <div key={page.id} data-testid="detail-page-detail-item" className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={page.title ?? "제품 디테일"}
                        className="w-full object-cover sm:w-2/3"
                        style={{ borderRadius: tokens.imageRadius, aspectRatio: "4 / 3" }}
                      />
                    ) : (
                      <div
                        className="flex aspect-[4/3] w-full items-center justify-center border border-dashed text-xs sm:w-2/3"
                        style={{ ...mutedStyle, borderRadius: tokens.imageRadius }}
                      >
                        이미지를 불러올 수 없습니다
                      </div>
                    )}
                    <div className="flex flex-col gap-1 sm:w-1/3">
                      <span style={{ ...headingStyle, fontSize: tokens.headingScale.h3, fontWeight: 600 }}>
                        {page.title ?? roleLabel(page.pageRole)}
                      </span>
                      {page.sectionDescription && (
                        <span style={{ ...mutedStyle, fontSize: tokens.bodyScale.small, lineHeight: 1.6 }}>
                          {page.sectionDescription}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. 사용 / 구성 */}
        {usageSectionPages.length > 0 && (
          <section
            data-testid="detail-page-usage"
            style={{ ...dividerStyle, ...sectionPadding }}
            className="flex flex-col gap-10"
          >
            <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h2, fontWeight: 700 }}>사용 / 구성</h2>
            <div className="flex flex-col gap-10">
              {usageSectionPages.map((page) => {
                const imageUrl = imageByPageId.get(page.id) ?? null;
                return (
                  <figure key={page.id} data-testid="detail-page-usage-item" className="flex flex-col gap-3">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={page.title ?? roleLabel(page.pageRole)}
                        className="w-full object-cover"
                        style={{ borderRadius: tokens.imageRadius, aspectRatio: "16 / 10" }}
                      />
                    ) : (
                      <div
                        className="flex aspect-[16/10] w-full items-center justify-center border border-dashed text-xs"
                        style={{ ...mutedStyle, borderRadius: tokens.imageRadius }}
                      >
                        이미지를 불러올 수 없습니다
                      </div>
                    )}
                    <figcaption className="flex flex-col gap-1">
                      <span style={{ ...headingStyle, fontSize: tokens.headingScale.h3, fontWeight: 600 }}>
                        {page.title ?? roleLabel(page.pageRole)}
                      </span>
                      {page.sectionDescription && (
                        <span style={{ ...mutedStyle, fontSize: tokens.bodyScale.small }}>{page.sectionDescription}</span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        {orderedPages.some((p) => p.status === "FAILED") && (
          <p data-testid="detail-page-section-failed" className="pb-4 text-xs" style={mutedStyle}>
            일부 섹션 생성 실패:{" "}
            {orderedPages
              .filter((p) => p.status === "FAILED")
              .map((p) => `${roleLabel(p.pageRole)}(${p.errorMessage ?? "알 수 없는 오류"})`)
              .join(", ")}
          </p>
        )}

        {/* 5. 신뢰 / 사양 */}
        {facts && (
          <section
            data-testid="detail-page-product-info"
            style={{ ...dividerStyle, ...sectionPadding }}
          >
            <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h2, fontWeight: 700 }} className="mb-6">
              제품 정보
            </h2>
            <table className="w-full border-collapse" style={{ fontSize: tokens.bodyScale.small }}>
              <tbody>
                {FACT_ROWS.map(({ key, label }) => {
                  const value = formatFact(facts[key] as string | string[] | null);
                  const unverified = value === UNVERIFIED;
                  return (
                    <tr key={key} style={{ borderTop: tokens.dividerStyle }}>
                      <th
                        scope="row"
                        className="w-32 py-3 pr-4 text-left align-top font-normal sm:w-40"
                        style={mutedStyle}
                      >
                        {label}
                      </th>
                      <td className="py-3 align-top" style={unverified ? { ...mutedStyle, fontStyle: "italic" } : undefined}>
                        {value}
                      </td>
                    </tr>
                  );
                })}
                {Object.keys(facts.specs).length > 0 && (
                  <tr style={{ borderTop: tokens.dividerStyle }}>
                    <th scope="row" className="w-32 py-3 pr-4 text-left align-top font-normal sm:w-40" style={mutedStyle}>
                      주요 사양
                    </th>
                    <td className="py-3 align-top">
                      {Object.entries(facts.specs)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {conflicts.length > 0 && (
              <div
                data-testid="detail-page-facts-conflict"
                className="mt-4 flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
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
        )}

        {/* 6. 하단 — 제조사 정보 및 고지 (제품 데이터에 근거한 항목만) */}
        <section
          data-testid="detail-page-notice"
          style={{ ...dividerStyle, ...sectionPadding }}
        >
          <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h3, fontWeight: 700 }} className="mb-3">
            제조사 정보 및 주의사항
          </h2>
          <div className="flex flex-col gap-1" style={{ ...mutedStyle, fontSize: tokens.bodyScale.small, lineHeight: 1.7 }}>
            <p>제조사: {facts?.manufacturer ?? UNVERIFIED}</p>
            <p>제조국/원산지: {facts?.originCountry ?? UNVERIFIED}</p>
            {facts && facts.cautions.length > 0 ? (
              facts.cautions.map((caution, i) => <p key={i}>· {caution}</p>)
            ) : (
              <p>포장지·라벨에서 확인된 주의사항이 없습니다.</p>
            )}
            <p className="mt-2">
              위 정보는 업로드된 실제 제품 사진을 AI가 읽고 OCR 원문과 교차 검증한 값입니다. 확인되지 않은 항목은
              &ldquo;{UNVERIFIED}&rdquo;로 표시됩니다.
            </p>
          </div>
        </section>

        {/* 7. GALLERY — 원본 제품 사진 */}
        {closingGalleryAssetIds.length > 0 && (
          <section
            data-testid="detail-page-gallery"
            style={{ ...dividerStyle, ...sectionPadding }}
          >
            <h2 style={{ ...headingStyle, fontSize: tokens.headingScale.h2, fontWeight: 700 }} className="mb-6">
              실제 제품 사진
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {closingGalleryAssetIds.map((assetId) => {
                const url = rawAssetUrlById.get(assetId);
                return url ? (
                  <img
                    key={assetId}
                    src={url}
                    alt="실제 제품 사진"
                    className="w-full object-cover"
                    style={{ borderRadius: tokens.imageRadius, aspectRatio: "4 / 3" }}
                  />
                ) : null;
              })}
            </div>
          </section>
        )}

        {generation.ocrResults.length > 0 && (
          <details data-testid="detail-page-ocr-results" className="pb-8 pt-4" style={dividerStyle}>
            <summary className="cursor-pointer text-xs" style={mutedStyle}>
              OCR 원문 보기 (업로드 사진 전체 · 감사/근거용)
            </summary>
            <div className="mt-3 flex flex-col gap-3">
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
            </div>
          </details>
        )}

        <footer
          data-testid="detail-page-metadata"
          className="flex flex-col gap-1 border-t border-zinc-200 pb-8 pt-4 text-xs text-zinc-400"
        >
          <p>생성 ID: {generation.id}</p>
          <p>
            섹션: 성공 {succeededCount}장 · 실패 {failedCount}장 · AI 호출 수(분석 1회 + 섹션 이미지): {aiCallCount}회
          </p>
          {generation.productFactsProvenance && (
            <p>
              제품 정보 근거: {generation.productFactsProvenance.provider ?? "미확인"}/
              {generation.productFactsProvenance.model ?? "미확인"} 비전 분석 — 업로드 사진{" "}
              {generation.productFactsProvenance.analyzedAssetIds.length}장 분석, 그중 실제 제품 사진{" "}
              {generation.productFactsProvenance.actualProductAssetIds.length}장을 원본/시각 reference로 사용
            </p>
          )}
          <p data-testid="detail-page-design-system">
            디자인 템플릿: {generation.designSystem.templateId} — {generation.designSystem.reason}
          </p>
        </footer>
      </div>
    </main>
  );
}
