"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MultiApiError,
  createMultiProduct,
  createMultiProject,
  fetchMultiGeneration,
  fetchPageImageUrl,
  startMultiGeneration,
  uploadMultiAsset,
  type Level1DetailPageDto,
  type Level1MultiGenerationDto,
  type VerifiedProductFacts,
} from "./multi-client";

type Phase = "idle" | "uploading" | "generating" | "done" | "error";

interface PreviewPhoto {
  file: File;
  url: string;
}

interface PageWithImage {
  page: Level1DetailPageDto;
  imageUrl: string | null;
}

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "PARTIAL", "FAILED"]);

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

const UNVERIFIED = "확인되지 않음";

function formatFact(value: string | string[] | null): string {
  if (value === null) return UNVERIFIED;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : UNVERIFIED;
  return value;
}

/**
 * LEVEL 2 다중 상세페이지 생성 화면 (T1-191).
 *
 * [사진 업로드] → [상세페이지 생성] → 진행률(N/M) → 완성된 여러 장 순서대로
 * 표시 → 하단 제품 정보 패널. 내부적으로는 기존 LEVEL1 project/product/
 * asset API(T1-188)를 그대로 호출해 저장하지만, `/level1`·`/level1-generate`
 * 화면으로 이동시키지 않는다.
 */
export default function MultiView() {
  const [photos, setPhotos] = useState<PreviewPhoto[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Level1MultiGenerationDto | null>(null);
  const [pageImages, setPageImages] = useState<PageWithImage[]>([]);
  const productIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PreviewPhoto[]>([]);
  const pageImagesRef = useRef<PageWithImage[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  photosRef.current = photos;
  pageImagesRef.current = pageImages;

  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
      pageImagesRef.current.forEach((p) => {
        if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
      });
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const handleSelectFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const next = Array.from(fileList).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...next]);
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const loadPageImages = useCallback(async (pages: Level1DetailPageDto[]) => {
    const loaded = await Promise.all(
      pages.map(async (page) => {
        if (page.status !== "SUCCEEDED") return { page, imageUrl: null };
        try {
          const imageUrl = await fetchPageImageUrl(page.id);
          return { page, imageUrl };
        } catch {
          return { page, imageUrl: null };
        }
      }),
    );
    pageImagesRef.current.forEach((p) => {
      if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
    });
    setPageImages(loaded);
  }, []);

  const poll = useCallback(
    async (generationId: string) => {
      try {
        const result = await fetchMultiGeneration(generationId);
        setGeneration(result);

        const total = result.pages.length;
        const done = result.pages.filter((p) => p.status !== "PENDING").length;
        if (result.status === "ANALYZING") {
          setStatusMessage("AI가 사진을 분석하고 상세페이지 구성을 결정하고 있습니다…");
        } else if (total > 0) {
          setStatusMessage(`상세페이지 이미지 생성 중 (${done}/${total})…`);
        } else {
          setStatusMessage("상세페이지를 생성하고 있습니다…");
        }

        if (TERMINAL_STATUSES.has(result.status)) {
          await loadPageImages(result.pages);
          if (result.status === "FAILED") {
            setPhase("error");
            setErrorMessage(result.errorMessage ?? "생성에 실패했습니다.");
          } else {
            setPhase("done");
            setStatusMessage(null);
          }
          return;
        }

        pollTimerRef.current = setTimeout(() => void poll(generationId), POLL_INTERVAL_MS);
      } catch (err) {
        setPhase("error");
        setErrorMessage(err instanceof MultiApiError ? err.message : "알 수 없는 오류");
      }
    },
    [loadPageImages],
  );

  const runGenerate = useCallback(
    async (productId: string) => {
      setPhase("generating");
      setErrorMessage(null);
      setPageImages([]);
      setStatusMessage("AI가 사진을 분석하고 있습니다…");
      try {
        const started = await startMultiGeneration(productId);
        setGeneration(started);
        pollTimerRef.current = setTimeout(() => void poll(started.id), POLL_INTERVAL_MS);
      } catch (err) {
        setPhase("error");
        setErrorMessage(err instanceof MultiApiError ? err.message : "알 수 없는 오류");
      }
    },
    [poll],
  );

  const handleGenerateClick = useCallback(async () => {
    if (photos.length === 0) return;
    setPhase("uploading");
    setErrorMessage(null);
    setGeneration(null);
    setPageImages([]);
    try {
      let productId = productIdRef.current;
      if (!productId) {
        setStatusMessage("업로드 준비 중…");
        const project = await createMultiProject(`LEVEL2 생성 ${new Date().toISOString()}`);
        const product = await createMultiProduct(project.id);
        productId = product.id;
        productIdRef.current = productId;
      }

      setStatusMessage(`사진 ${photos.length}장 업로드 중…`);
      for (const photo of photos) {
        await uploadMultiAsset(productId, photo.file);
      }

      await runGenerate(productId);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof MultiApiError ? err.message : "알 수 없는 오류");
    }
  }, [photos, runGenerate]);

  const handleRetry = useCallback(() => {
    if (!productIdRef.current) return;
    void runGenerate(productIdRef.current);
  }, [runGenerate]);

  const isBusy = phase === "uploading" || phase === "generating";
  const facts = generation?.verifiedProductFacts ?? null;
  const succeededPages = pageImages.filter((p) => p.imageUrl);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-xl font-bold">상세페이지 생성 (다중 페이지)</h1>
      <p className="text-sm text-zinc-500">
        제품 사진을 여러 장 올리고 버튼 한 번을 누르면, AI가 사진을 분석해 상세페이지를 여러 장의
        이미지로 나눠 만들고, 검증된 제품 정보를 하단에 함께 보여줍니다.
      </p>

      <section className="flex flex-col gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={isBusy}
          onChange={(event) => {
            handleSelectFiles(event.target.files);
            event.target.value = "";
          }}
          data-testid="multi-file-input"
        />

        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2" data-testid="multi-preview-grid">
            {photos.map((photo, index) => (
              <div key={photo.url} className="relative">
                <img
                  src={photo.url}
                  alt={`업로드 사진 ${index + 1}`}
                  className="aspect-square w-full rounded object-cover"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => removePhoto(index)}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white"
                  aria-label={`사진 ${index + 1} 제거`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={photos.length === 0 || isBusy}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          data-testid="multi-generate-button"
        >
          {isBusy ? "생성 중…" : "상세페이지 생성"}
        </button>
      </section>

      {isBusy && (
        <section className="flex items-center gap-2 text-sm text-zinc-600" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          <span data-testid="multi-progress-message">{statusMessage}</span>
        </section>
      )}

      {phase === "error" && errorMessage && (
        <section className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p>생성에 실패했습니다: {errorMessage}</p>
          {productIdRef.current && (
            <button
              type="button"
              onClick={handleRetry}
              className="mt-2 rounded border border-red-400 px-3 py-1 text-xs text-red-700"
            >
              다시 시도
            </button>
          )}
        </section>
      )}

      {(phase === "done" || (phase === "error" && succeededPages.length > 0)) && (
        <section className="flex flex-col gap-4" data-testid="multi-result">
          {generation?.status === "PARTIAL" && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
              일부 페이지 생성에 실패했습니다({pageImages.filter((p) => p.page.status === "FAILED").length}장). 성공한
              페이지만 아래에 표시합니다.
            </p>
          )}
          {generation && (
            <a
              href={`/level2-generate/${generation.id}`}
              className="self-start text-xs text-blue-600 underline"
              data-testid="multi-permalink-link"
            >
              이 상세페이지의 고정 링크 열기 →
            </a>
          )}
          <h2 className="text-sm font-semibold">완성된 상세페이지 ({succeededPages.length}장)</h2>
          <div className="flex flex-col gap-3">
            {succeededPages.map(({ page, imageUrl }) => (
              <figure key={page.id} className="flex flex-col gap-1" data-testid="multi-page-image">
                <img
                  src={imageUrl ?? undefined}
                  alt={page.title ?? `${page.pageIndex}번 페이지`}
                  className="w-full rounded border border-zinc-200"
                />
                <figcaption className="text-xs text-zinc-400">
                  {page.pageIndex}. {page.title ?? page.pageRole} ({page.pageRole})
                </figcaption>
              </figure>
            ))}
          </div>

          {facts && (
            <section
              className="flex flex-col gap-2 rounded border border-zinc-200 p-4"
              data-testid="multi-product-facts"
            >
              <h3 className="text-sm font-semibold">제품 정보</h3>
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
            </section>
          )}

          <button
            type="button"
            onClick={handleRetry}
            className="self-start rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600"
          >
            다시 생성
          </button>
        </section>
      )}
    </main>
  );
}
