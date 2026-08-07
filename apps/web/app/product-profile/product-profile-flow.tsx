"use client";

import { useCallback, useRef, useState } from "react";
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_FILE_SIZE,
  type ImageDto,
  type OcrResultDto,
  type ProductProfileDto,
} from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit, getAuthToken } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type UploadStatus = "uploading" | "done" | "error";
type OcrStatus = "idle" | "running" | "done" | "error";

interface UploadItem {
  id: string;
  fileName: string;
  fileSize: number;
  previewUrl: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  image?: ImageDto;
  ocrStatus: OcrStatus;
  ocrText?: string | null;
  ocrConfidence?: number | null;
  ocrError?: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

/** STEP 1 — 사진 업로드 (드래그앤드롭 지원, 여러 장 가능) */
function uploadWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<ImageDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as {
          images?: ImageDto[];
          message?: string | string[];
        };
        if (xhr.status >= 200 && xhr.status < 300 && body.images?.[0]) {
          resolve(body.images[0]);
        } else {
          const message = Array.isArray(body.message)
            ? body.message.join(", ")
            : body.message;
          reject(new Error(message ?? `업로드 실패 (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("API 서버에 연결할 수 없습니다."));
    xhr.open("POST", `${API_URL}/uploads/images`);
    xhr.withCredentials = true;
    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

/** STEP 2 — OCR 실행 (실 Google Cloud Vision, mock 아님) */
async function runOcr(imageId: string): Promise<OcrResultDto> {
  const response = await fetch(
    `${API_URL}/images/${imageId}/ocr`,
    authFetchInit({ method: "POST" }),
  );
  const body = (await response.json()) as OcrResultDto & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new Error(message ?? `OCR 실행 실패 (HTTP ${response.status})`);
  }
  return body;
}

/** STEP 3+4+5 — 이미지 특징 분석 + Product Profile 통합 + 상세페이지 카피/HTML 생성 (실 OpenAI Vision) */
async function runProductProfile(imageIds: string[]): Promise<ProductProfileDto> {
  const response = await fetch(
    `${API_URL}/product-profile`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageIds }),
    }),
  );
  const body = (await response.json()) as ProductProfileDto & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new Error(message ?? `분석 실행 실패 (HTTP ${response.status})`);
  }
  return body;
}

/** STEP 5 결과 다운로드 — 서버에 저장된 완전한 HTML 문서를 그대로 받아 파일로 저장한다 */
async function downloadHtml(id: string, productName: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/product-profile/${id}/html`,
    authFetchInit({ method: "GET" }),
  );
  if (!response.ok) {
    throw new Error(`다운로드 실패 (HTTP ${response.status})`);
  }
  const html = await response.text();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${productName.replace(/[\\/:*?"<>|]/g, "_") || "product-page"}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ProductProfileFlow() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [runningOcrAll, setRunningOcrAll] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProductProfileDto | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const startUpload = useCallback(
    (files: File[]) => {
      const errors: string[] = [];
      const accepted: File[] = [];

      for (const file of files) {
        if (!(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
          errors.push(`${file.name}: 지원하지 않는 형식 (${file.type || "unknown"})`);
        } else if (file.size > UPLOAD_MAX_FILE_SIZE) {
          errors.push(`${file.name}: 10MB 초과 (${formatBytes(file.size)})`);
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length > UPLOAD_MAX_FILES) {
        errors.push(`한 번에 최대 ${UPLOAD_MAX_FILES}개까지 업로드할 수 있습니다.`);
        accepted.length = UPLOAD_MAX_FILES;
      }
      setRejected(errors);
      setProfile(null);
      setAnalyzeError(null);

      for (const file of accepted) {
        const id = crypto.randomUUID();
        setItems((prev) => [
          {
            id,
            fileName: file.name,
            fileSize: file.size,
            previewUrl: URL.createObjectURL(file),
            progress: 0,
            status: "uploading" as const,
            ocrStatus: "idle" as const,
          },
          ...prev,
        ]);

        uploadWithProgress(file, (percent) => updateItem(id, { progress: percent }))
          .then((image) => updateItem(id, { status: "done", progress: 100, image }))
          .catch((error: Error) =>
            updateItem(id, { status: "error", error: error.message }),
          );
      }
    },
    [updateItem],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      startUpload(Array.from(event.dataTransfer.files));
    },
    [startUpload],
  );

  const doneItems = items.filter((item) => item.status === "done" && item.image);

  const runOcrForItem = useCallback(
    async (item: UploadItem) => {
      if (!item.image) return;
      updateItem(item.id, { ocrStatus: "running", ocrError: undefined });
      try {
        const result = await runOcr(item.image.id);
        updateItem(item.id, {
          ocrStatus: result.status === "SUCCESS" ? "done" : "error",
          ocrText: result.extractedText,
          ocrConfidence: result.confidence,
          ocrError: result.status === "SUCCESS" ? undefined : (result.error ?? "OCR 실패"),
        });
      } catch (error) {
        updateItem(item.id, {
          ocrStatus: "error",
          ocrError: error instanceof Error ? error.message : "OCR 실행 실패",
        });
      }
    },
    [updateItem],
  );

  const runOcrForAll = useCallback(async () => {
    setRunningOcrAll(true);
    // 실 Provider 호출을 순차 실행한다(동시 실행이 아니라 예산·순서를 지킨다)
    for (const item of doneItems) {
      if (item.ocrStatus === "idle" || item.ocrStatus === "error") {
        await runOcrForItem(item);
      }
    }
    setRunningOcrAll(false);
  }, [doneItems, runOcrForItem]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setDownloadError(null);
    setProfile(null);
    try {
      const result = await runProductProfile(doneItems.map((item) => item.image!.id));
      setProfile(result);
    } catch (error) {
      setAnalyzeError(
        error instanceof Error ? error.message : "분석 실행에 실패했습니다.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [doneItems]);

  const downloadCurrentHtml = useCallback(async () => {
    if (!profile) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadHtml(profile.id, profile.profile?.productName ?? "product-page");
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "다운로드에 실패했습니다.",
      );
    } finally {
      setDownloading(false);
    }
  }, [profile]);

  return (
    <div className="flex flex-col gap-8">
      {/* STEP 1 — 사진 업로드 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">STEP 1 · 사진 업로드</h2>
        <div
          role="button"
          tabIndex={0}
          aria-label="상품 사진 업로드"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          }`}
        >
          <span className="text-4xl">📸</span>
          <p className="font-medium">
            상품 사진을 여기에 끌어다 놓거나 클릭해서 선택하세요
          </p>
          <p className="text-sm text-zinc-500">
            JPG · PNG · WebP · GIF, 파일당 최대 10MB, 한 번에 최대{" "}
            {UPLOAD_MAX_FILES}개
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_ALLOWED_MIME_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => {
              startUpload(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>

        {rejected.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <ul className="list-inside list-disc">
              {rejected.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <img
                  src={item.previewUrl}
                  alt={item.fileName}
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{item.fileName}</p>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatBytes(item.fileSize)}
                    </span>
                    {item.status === "uploading" && (
                      <Badge tone="warn">업로드 중 {item.progress}%</Badge>
                    )}
                    {item.status === "done" && <Badge tone="ok">업로드 완료</Badge>}
                    {item.status === "error" && <Badge tone="warn">업로드 실패</Badge>}
                    {item.ocrStatus === "running" && <Badge tone="warn">OCR 실행 중</Badge>}
                    {item.ocrStatus === "done" && <Badge tone="ok">OCR 완료</Badge>}
                    {item.ocrStatus === "error" && <Badge tone="warn">OCR 실패</Badge>}
                  </div>
                  {item.status === "error" && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {item.error}
                    </p>
                  )}
                  {item.ocrStatus === "done" && (
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      OCR:{" "}
                      {item.ocrText && item.ocrText.length > 0
                        ? item.ocrText
                        : "(추출된 텍스트 없음)"}
                      {item.ocrConfidence != null &&
                        ` · 신뢰도 ${item.ocrConfidence.toFixed(2)}`}
                    </p>
                  )}
                  {item.ocrStatus === "error" && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      OCR: {item.ocrError}
                    </p>
                  )}
                </div>
                {item.status === "done" && item.ocrStatus !== "running" && (
                  <button
                    type="button"
                    onClick={() => void runOcrForItem(item)}
                    className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {item.ocrStatus === "idle" ? "OCR 실행" : "다시 실행"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* STEP 2 — OCR 일괄 실행 */}
      {doneItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">STEP 2 · OCR 실행</h2>
          <div>
            <button
              type="button"
              onClick={() => void runOcrForAll()}
              disabled={runningOcrAll}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {runningOcrAll ? "OCR 실행 중…" : `업로드된 사진 ${doneItems.length}장 전체 OCR 실행`}
            </button>
          </div>
        </section>
      )}

      {/* STEP 3+4+5 — 이미지 분석 + Product Profile 통합 + 상세페이지 카피/HTML 생성 */}
      {doneItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            STEP 3+4+5 · 이미지 분석 → Product Profile 통합 → 상세페이지 HTML 생성
          </h2>
          <p className="text-sm text-zinc-500">
            실제 OpenAI 호출 3건(이미지 특징 분석 + Profile 통합 + 상세페이지
            카피 생성)이 실행됩니다 — 소액이지만 실제 과금이 발생합니다. HTML
            렌더링 자체는 LLM 호출 없이 결정적으로 생성됩니다. OCR을 먼저
            실행해 두면 정확도가 올라가지만 필수는 아닙니다.
          </p>
          <div>
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={analyzing}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {analyzing
                ? "생성 중… (수 초 소요)"
                : `사진 ${doneItems.length}장으로 상세페이지 생성`}
            </button>
          </div>
          {analyzeError && (
            <p className="text-sm text-red-600 dark:text-red-400">{analyzeError}</p>
          )}
        </section>
      )}

      {/* 결과 — Product Profile JSON */}
      {profile && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">결과 · Product Profile</h2>
            {profile.status === "SUCCESS" && <Badge tone="ok">생성 완료</Badge>}
            {profile.status === "FAILED" && <Badge tone="warn">생성 실패</Badge>}
          </div>

          {profile.status === "FAILED" && (
            <p className="text-sm text-red-600 dark:text-red-400">{profile.error}</p>
          )}

          {profile.status === "SUCCESS" && profile.profile && (
            <Card title={profile.profile.productName}>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-zinc-500">브랜드</dt>
                  <dd>{profile.profile.brand ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">모델</dt>
                  <dd>{profile.profile.model ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">재질</dt>
                  <dd>{profile.profile.material ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">확신도</dt>
                  <dd>{(profile.profile.confidence * 100).toFixed(0)}%</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-zinc-500">용도</dt>
                  <dd>{profile.profile.usage ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-zinc-500">특징</dt>
                  <dd>
                    {profile.profile.features.length > 0
                      ? profile.profile.features.join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-zinc-500">사양</dt>
                  <dd>
                    {Object.entries(profile.profile.specifications).length > 0
                      ? Object.entries(profile.profile.specifications)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">장점</dt>
                  <dd>
                    {profile.profile.advantages.length > 0
                      ? profile.profile.advantages.join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">주의사항</dt>
                  <dd>
                    {profile.profile.warnings.length > 0
                      ? profile.profile.warnings.join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-zinc-500">키워드</dt>
                  <dd>
                    {profile.profile.keywords.length > 0
                      ? profile.profile.keywords.join(", ")
                      : "—"}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          {profile.status === "SUCCESS" && profile.html && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">STEP 5 · 상세페이지 HTML 미리보기</h3>
                <button
                  type="button"
                  onClick={() => void downloadCurrentHtml()}
                  disabled={downloading}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {downloading ? "다운로드 중…" : "HTML 파일로 다운로드"}
                </button>
              </div>
              {downloadError && (
                <p className="text-sm text-red-600 dark:text-red-400">{downloadError}</p>
              )}
              {profile.pageCopy && (
                <p className="text-sm text-zinc-500">
                  대표 문구: “{profile.pageCopy.headline}”
                </p>
              )}
              <iframe
                title="상세페이지 미리보기"
                srcDoc={`<style>${profile.css ?? ""}</style>${profile.html}`}
                sandbox=""
                className="h-[640px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
              />
              <p className="text-xs text-zinc-500">
                이 실행 결과는 서버에 저장되어 있습니다 — 링크: {" "}
                <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">
                  GET /product-profile/{profile.id}
                </code>{" "}
                로 나중에 다시 열어볼 수 있습니다.
              </p>
            </div>
          )}

          <details className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Product Profile JSON 원본 보기
            </summary>
            <pre className="max-h-[480px] overflow-auto px-4 pb-4 text-xs">
              {JSON.stringify(profile, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
