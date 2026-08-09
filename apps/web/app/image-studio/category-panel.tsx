"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  GenerateImageCandidatesResult,
  ImageCategory,
  ImageDto,
} from "@acos/shared";
import { IMAGE_CATEGORY_LABELS } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../lib/auth-client";
import { AuthImage } from "../product-profile/auth-image";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function generateCandidates(
  imageId: string,
  category: ImageCategory,
  style: string,
): Promise<GenerateImageCandidatesResult> {
  const response = await fetch(
    `${API_URL}/image-gen/candidates`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, category, style: style || undefined }),
    }),
  );
  const body = (await response.json()) as GenerateImageCandidatesResult & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `생성 실패 (HTTP ${response.status})`);
  }
  return body;
}

async function fetchCandidates(sourceImageId: string, category: ImageCategory): Promise<ImageDto[]> {
  const response = await fetch(
    `${API_URL}/image-gen/candidates?sourceImageId=${sourceImageId}&category=${category}`,
    authFetchInit(),
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { results: ImageDto[] };
  return body.results;
}

async function selectImage(imageId: string): Promise<ImageDto> {
  const response = await fetch(
    `${API_URL}/image-gen/select`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    }),
  );
  return response.json();
}

const STYLE_PRESETS = [
  "",
  "더 고급스럽게",
  "더 감성적으로",
  "더 프리미엄하게",
  "더 밝게",
  "더 실사용 느낌으로",
  "더 미니멀하게",
  "완전히 새롭게",
];

export function CategoryPanel({ category, sourceImageId }: { category: ImageCategory; sourceImageId: string }) {
  const [allVersions, setAllVersions] = useState<ImageDto[]>([]);
  const [versionIndex, setVersionIndex] = useState(0); // 0 = 최신
  const [style, setStyle] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const results = await fetchCandidates(sourceImageId, category);
    setAllVersions(results);
    setVersionIndex(0);
  }, [sourceImageId, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const versionNumbers = [...new Set(allVersions.map((v) => v.groupVersion ?? 0))].sort((a, b) => b - a);
  const currentVersion = versionNumbers[versionIndex];
  const currentCandidates = allVersions.filter((v) => v.groupVersion === currentVersion);
  const expandedCandidate = currentCandidates.find((c) => c.id === expandedId) ?? null;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await generateCandidates(sourceImageId, category, style);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setRunning(false);
    }
  };

  const pick = async (imageId: string) => {
    await selectImage(imageId);
    await load();
  };

  return (
    <Card title={IMAGE_CATEGORY_LABELS[category]}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {STYLE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset || "스타일 방향 선택 (선택)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {running ? "생성 중…" : currentCandidates.length > 0 ? "재생성 (새 버전)" : "생성"}
          </button>
          {versionNumbers.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <button
                type="button"
                disabled={versionIndex >= versionNumbers.length - 1}
                onClick={() => setVersionIndex((i) => i + 1)}
                className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
              >
                ← 이전 버전
              </button>
              <span>V{currentVersion}</span>
              <button
                type="button"
                disabled={versionIndex <= 0}
                onClick={() => setVersionIndex((i) => i - 1)}
                className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
              >
                다음 버전 →
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {currentCandidates.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
            아직 생성되지 않음
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {currentCandidates.map((candidate, i) => (
              <div key={candidate.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => void pick(candidate.id)}
                  className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1 ${
                    candidate.selected ? "border-emerald-600" : "border-transparent"
                  }`}
                >
                  <AuthImage
                    imageId={candidate.id}
                    alt={`${IMAGE_CATEGORY_LABELS[category]} ${String.fromCharCode(65 + i)}`}
                    className="h-32 w-full rounded object-cover"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">{String.fromCharCode(65 + i)}</span>
                    {candidate.selected && <Badge tone="ok">선택됨</Badge>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedId((id) => (id === candidate.id ? null : candidate.id))}
                  className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {expandedId === candidate.id ? "상세 닫기" : "상세보기"}
                </button>
              </div>
            ))}
          </div>
        )}

        {expandedCandidate && (
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 text-xs dark:border-zinc-700">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <div>
                <dt className="text-zinc-500">생성 Provider</dt>
                <dd className="font-medium">
                  {expandedCandidate.generationMetadata?.provider ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">생성 Model</dt>
                <dd className="font-medium">{expandedCandidate.generationMetadata?.model ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">생성 시간</dt>
                <dd className="font-medium">
                  {new Date(expandedCandidate.createdAt).toLocaleString("ko-KR")}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">생성 Category</dt>
                <dd className="font-medium">
                  {expandedCandidate.category
                    ? IMAGE_CATEGORY_LABELS[expandedCandidate.category]
                    : "-"}
                </dd>
              </div>
            </dl>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium text-emerald-700 dark:text-emerald-400">
                  Gemini에 전달된 참조 이미지
                  {expandedCandidate.generationMetadata?.referenceImages
                    ? ` (${expandedCandidate.generationMetadata.referenceImages.length}장)`
                    : ""}
                </p>
                <ul className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40">
                  {(expandedCandidate.generationMetadata?.referenceImages ?? []).map((ref) => (
                    <li key={ref.id} className="flex items-center gap-1.5 py-0.5">
                      <span className="rounded bg-emerald-600 px-1 text-[10px] text-white">
                        {ref.photoType ?? "생성"}
                      </span>
                      <span>{ref.role}</span>
                    </li>
                  ))}
                  {!expandedCandidate.generationMetadata?.referenceImages && (
                    <li className="text-zinc-400">(기록 없음 — 이전 버전 이미지)</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium text-amber-700 dark:text-amber-400">
                  OCR 전용 — Gemini에 전달하지 않음
                  {expandedCandidate.generationMetadata?.excludedInfoImages
                    ? ` (${expandedCandidate.generationMetadata.excludedInfoImages.length}장)`
                    : ""}
                </p>
                <ul className="rounded bg-amber-50 p-2 dark:bg-amber-950/40">
                  {(expandedCandidate.generationMetadata?.excludedInfoImages ?? []).map((ref) => (
                    <li key={ref.id} className="py-0.5">
                      {ref.originalName}
                    </li>
                  ))}
                  {!expandedCandidate.generationMetadata?.excludedInfoImages && (
                    <li className="text-zinc-400">(기록 없음 — 이전 버전 이미지)</li>
                  )}
                </ul>
              </div>
            </div>

            {expandedCandidate.generationMetadata?.productPackage?.identification && (
              <div>
                <p className="mb-1 font-medium text-sky-700 dark:text-sky-400">
                  제품 자동 분석 결과 (T1-21)
                </p>
                {(() => {
                  const id =
                    expandedCandidate.generationMetadata.productPackage.identification;
                  const rows: [string, string][] = [
                    [
                      "바코드",
                      id.barcodes.length > 0
                        ? id.barcodes.map((b) => `${b.value} (${b.format})`).join(", ")
                        : "찾지 못함",
                    ],
                    ["법정 재질 분류", id.officialProductLabel ?? "찾지 못함"],
                    ["모델명", id.model ?? "찾지 못함"],
                    ["브랜드", id.brand ?? "찾지 못함"],
                    ["원산지", id.origin ?? "찾지 못함"],
                    [
                      "제조사 URL",
                      id.urls.length > 0 ? id.urls.map((u) => u.value).join(", ") : "찾지 못함",
                    ],
                    [
                      "제품 특정 여부",
                      id.identified
                        ? `특정됨 (${id.identifiedBy.join(" · ")})`
                        : "특정 안 됨 — 웹 조사 불가",
                    ],
                  ];
                  return (
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded bg-sky-50 p-2 dark:bg-sky-950/40">
                      {rows.map(([label, value]) => (
                        <div key={label} className="contents">
                          <dt className="text-zinc-500">{label}</dt>
                          <dd
                            className={
                              value === "찾지 못함" || value.startsWith("특정 안 됨")
                                ? "text-zinc-400"
                                : "font-medium"
                            }
                          >
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  );
                })()}
              </div>
            )}

            {expandedCandidate.generationMetadata?.productPackage?.crossVerification && (
              <div>
                <p className="mb-1 font-medium text-rose-700 dark:text-rose-400">
                  교차 검증 결과 (T1-23)
                </p>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded bg-rose-50 p-2 dark:bg-rose-950/40">
                  {expandedCandidate.generationMetadata.productPackage.crossVerification.fields.map(
                    (field) => (
                      <div key={field.field} className="contents">
                        <dt className="text-zinc-500">{field.field}</dt>
                        <dd
                          className={
                            field.status === "conflict"
                              ? "font-medium text-rose-600 dark:text-rose-400"
                              : field.status === "unknown"
                                ? "text-zinc-400"
                                : "font-medium"
                          }
                        >
                          {field.status === "unknown" && "찾지 못함"}
                          {field.status === "conflict" &&
                            `충돌 — ${field.observations
                              .map((o) => `${o.source}: ${o.value}`)
                              .join(" / ")} (자동으로 채우지 않음, 사람 판단 필요)`}
                          {(field.status === "agreed" || field.status === "single-source") &&
                            `${field.resolvedValue} (${field.observations
                              .map((o) => o.source)
                              .join(", ")})`}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            )}

            {expandedCandidate.generationMetadata?.productPackage?.research && (
              <div>
                <p className="mb-1 font-medium text-emerald-700 dark:text-emerald-400">
                  자동 조사 결과 (T1-22)
                </p>
                {(() => {
                  const research = expandedCandidate.generationMetadata.productPackage.research;
                  return (
                    <div className="space-y-2 rounded bg-emerald-50 p-2 dark:bg-emerald-950/40">
                      <p className="text-zinc-600 dark:text-zinc-300">
                        {research.status === "skipped" && "조사하지 않음"}
                        {research.status === "not_found" && "조사했으나 공식 출처를 찾지 못함"}
                        {research.status === "found" && "공식 출처를 찾음"}
                        {" — "}
                        {research.reason}
                      </p>
                      {research.findings.length > 0 && (
                        <ul className="space-y-1">
                          {research.findings.map((f, i) => (
                            <li key={`${f.sourceUrl}-${i}`} className="rounded bg-white/60 p-1.5 dark:bg-black/20">
                              <span className="font-medium">{f.sourceType}</span>
                              {" · "}
                              <a
                                href={f.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {f.sourceUrl}
                              </a>
                              <p className="text-zinc-500">{f.snippet}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      {research.excluded.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-zinc-500">
                            공식으로 인정하지 않아 버린 결과 {research.excluded.length}건
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-zinc-400">
                            {research.excluded.map((e, i) => (
                              <li key={`${e.url}-${i}`}>
                                {e.url} — {e.reason === "shopping-mall" ? "쇼핑몰 출처" : "출처 미확인"}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            <div>
              <p className="mb-1 font-medium">Gemini에 실제 전달된 Prompt</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 dark:bg-zinc-800">
                {expandedCandidate.generationMetadata?.prompt ?? "(기록된 Prompt가 없습니다)"}
              </pre>
            </div>

            {expandedCandidate.generationMetadata?.rawResponseText && (
              <div>
                <p className="mb-1 font-medium">Gemini 응답 텍스트</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 dark:bg-zinc-800">
                  {expandedCandidate.generationMetadata.rawResponseText}
                </pre>
              </div>
            )}

            <details className="rounded border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer px-2 py-1.5 font-medium">
                Product Package (JSON 원본 보기)
              </summary>
              <pre className="max-h-64 overflow-auto px-2 pb-2 whitespace-pre-wrap">
                {JSON.stringify(expandedCandidate.generationMetadata?.productPackage ?? null, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
}
