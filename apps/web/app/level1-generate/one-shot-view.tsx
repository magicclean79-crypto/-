"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OneShotApiError,
  createOneShotProduct,
  createOneShotProject,
  fetchGenerationImageUrl,
  generateOneShotDetailPage,
  uploadOneShotAsset,
  type Level1GenerationDto,
} from "./one-shot-client";

type Phase = "idle" | "uploading" | "generating" | "done" | "error";

interface PreviewPhoto {
  file: File;
  url: string;
}

/**
 * LEVEL 1 원샷 상세페이지 생성 화면 (T1-189).
 *
 * [사진 업로드] → 미리보기 → [상세페이지 생성] → 생성 중 → [완성된 이미지]
 * 이 화면 하나로 끝난다 — Product Profile/Design Profile/Composition/
 * Renderer 같은 중간 화면을 사용자에게 보여주지 않는다. 내부적으로는
 * 기존 LEVEL1 project/product/asset API(T1-188)를 그대로 호출해
 * 저장하지만, 그 화면(`/level1`)으로 이동시키지 않는다.
 */
export default function OneShotView() {
  const [photos, setPhotos] = useState<PreviewPhoto[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Level1GenerationDto | null>(null);
  const productIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PreviewPhoto[]>([]);
  const resultImageUrlRef = useRef<string | null>(null);
  photosRef.current = photos;
  resultImageUrlRef.current = resultImageUrl;

  // 언마운트될 때만 그 시점의 최신 blob URL을 전부 해제한다(ref로 최신값 참조).
  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
      if (resultImageUrlRef.current) URL.revokeObjectURL(resultImageUrlRef.current);
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

  const runGenerate = useCallback(
    async (productId: string) => {
      setPhase("generating");
      setStatusMessage("AI가 사진을 분석하고 상세페이지 이미지를 생성하고 있습니다…");
      setErrorMessage(null);
      try {
        const result = await generateOneShotDetailPage(productId);
        setGeneration(result);
        if (result.status === "SUCCEEDED") {
          const url = await fetchGenerationImageUrl(result.id);
          if (resultImageUrlRef.current) URL.revokeObjectURL(resultImageUrlRef.current);
          setResultImageUrl(url);
          setPhase("done");
          setStatusMessage(null);
        } else {
          setPhase("error");
          setErrorMessage(result.errorMessage ?? "생성에 실패했습니다.");
        }
      } catch (err) {
        setPhase("error");
        setErrorMessage(err instanceof OneShotApiError ? err.message : "알 수 없는 오류");
      }
    },
    [],
  );

  const handleGenerateClick = useCallback(async () => {
    if (photos.length === 0) return;
    setPhase("uploading");
    setErrorMessage(null);
    setResultImageUrl(null);
    setGeneration(null);
    try {
      let productId = productIdRef.current;
      if (!productId) {
        setStatusMessage("업로드 준비 중…");
        const project = await createOneShotProject(
          `원샷 생성 ${new Date().toISOString()}`,
        );
        const product = await createOneShotProduct(project.id);
        productId = product.id;
        productIdRef.current = productId;
      }

      setStatusMessage(`사진 ${photos.length}장 업로드 중…`);
      for (const photo of photos) {
        await uploadOneShotAsset(productId, photo.file);
      }

      await runGenerate(productId);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof OneShotApiError ? err.message : "알 수 없는 오류");
    }
  }, [photos, runGenerate]);

  const handleRetry = useCallback(() => {
    if (!productIdRef.current) return;
    void runGenerate(productIdRef.current);
  }, [runGenerate]);

  const isBusy = phase === "uploading" || phase === "generating";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-bold">상세페이지 생성</h1>
      <p className="text-sm text-zinc-500">
        제품 사진을 여러 장 올리고 버튼 한 번을 누르면, AI가 사진을 분석해 완성된 상세페이지
        이미지를 만듭니다.
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
          data-testid="one-shot-file-input"
        />

        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2" data-testid="one-shot-preview-grid">
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
          data-testid="one-shot-generate-button"
        >
          {isBusy ? "생성 중…" : "상세페이지 생성"}
        </button>
      </section>

      {isBusy && (
        <section className="flex items-center gap-2 text-sm text-zinc-600" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          <span>{statusMessage}</span>
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

      {phase === "done" && resultImageUrl && (
        <section className="flex flex-col gap-2" data-testid="one-shot-result">
          <h2 className="text-sm font-semibold">완성된 상세페이지</h2>
          <img
            src={resultImageUrl}
            alt="생성된 상세페이지"
            className="w-full rounded border border-zinc-200"
          />
          {generation && (
            <p className="text-xs text-zinc-400">
              provider: {generation.provider} · model: {generation.model}
            </p>
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
