"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  GenerateImageCandidatesResult,
  ImageCategory,
  ImageDto,
  ProductProfileDto,
} from "@acos/shared";
import {
  IMAGE_CATEGORY_LABELS,
  USER_REQUIREMENT_MAX_LENGTH,
  validateUserRequirementText,
} from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { AuthImage } from "../product-profile/auth-image";
import { imageStudioFetch } from "./api-client";
import { findProfileForSourceImage } from "./product-profile-lookup";

/**
 * 이 카테고리(생성 목적)만의 요구사항을 저장한다 (T1-99) — 비용 없음(DB
 * 값만 갱신). 다른 카테고리의 요구사항은 건드리지 않는다(부분 갱신,
 * `PATCH /product-profile/:id/user-requirement`의 `userRequirementsByCategory`).
 */
async function saveCategoryRequirement(
  profileId: string,
  category: ImageCategory,
  text: string,
): Promise<ProductProfileDto> {
  return imageStudioFetch<ProductProfileDto>(`/product-profile/${profileId}/user-requirement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequirementsByCategory: { [category]: text.trim() || null },
    }),
  });
}

async function generateCandidates(
  imageId: string,
  category: ImageCategory,
  style: string,
): Promise<GenerateImageCandidatesResult> {
  return imageStudioFetch<GenerateImageCandidatesResult>("/image-gen/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId, category, style: style || undefined }),
  });
}

async function fetchCandidates(sourceImageId: string, category: ImageCategory): Promise<ImageDto[]> {
  try {
    const body = await imageStudioFetch<{ results: ImageDto[] }>(
      `/image-gen/candidates?sourceImageId=${sourceImageId}&category=${category}`,
    );
    return body.results;
  } catch {
    return [];
  }
}

async function selectImage(imageId: string): Promise<ImageDto> {
  return imageStudioFetch<ImageDto>("/image-gen/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId }),
  });
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

  // 이 카테고리(생성 목적)만의 요구사항 (T1-99) — 대표 썸네일은 배경/구도,
  // 디테일샷은 강조할 부위, 사용 이미지는 상황, 구성품은 배치처럼 목적마다
  // 다른 요구사항을 독립적으로 입력한다.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [requirementText, setRequirementText] = useState("");
  const [requirementSaving, setRequirementSaving] = useState(false);
  const [requirementSaved, setRequirementSaved] = useState(false);
  const [requirementError, setRequirementError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const results = await fetchCandidates(sourceImageId, category);
    setAllVersions(results);
    setVersionIndex(0);
  }, [sourceImageId, category]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setRequirementSaved(false);
    setRequirementError(null);
    void findProfileForSourceImage(sourceImageId).then((profile) => {
      setProfileId(profile?.id ?? null);
      setRequirementText(profile?.userRequirementsByCategory?.[category] ?? "");
    });
  }, [sourceImageId, category]);

  const saveRequirement = async () => {
    if (!profileId) return;
    const validation = validateUserRequirementText(requirementText);
    if (!validation.ok) {
      setRequirementError(validation.reason ?? "요구사항을 확인해 주세요");
      return;
    }
    setRequirementSaving(true);
    setRequirementError(null);
    setRequirementSaved(false);
    try {
      await saveCategoryRequirement(profileId, category, requirementText);
      setRequirementSaved(true);
    } catch (err) {
      setRequirementError(err instanceof Error ? err.message : "요구사항 저장 실패");
    } finally {
      setRequirementSaving(false);
    }
  };

  const versionNumbers = [...new Set(allVersions.map((v) => v.groupVersion ?? 0))].sort((a, b) => b - a);
  const currentVersion = versionNumbers[versionIndex];
  const currentCandidates = allVersions.filter((v) => v.groupVersion === currentVersion);
  const expandedCandidate = currentCandidates.find((c) => c.id === expandedId) ?? null;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await generateCandidates(sourceImageId, category, style);
      // HTTP 200이어도 AI 호출 자체가 실패했을 수 있다 — 이전에는
      // 이 경우 candidates가 빈 채로 조용히 끝나(예외가 없어 catch를
      // 타지 않음) "아직 생성되지 않음"만 보여, 무엇이 실패했는지 알
      // 방법이 없었다(T1-136/T1-138, PROJECT_MEMORY M-26 "실패가
      // 성공처럼 보이는 것이 가장 위험하다"). 생성된 후보가 하나도
      // 없는데 실패가 기록됐으면 그 원인을 그대로 보여준다.
      if (result.candidates.length === 0 && result.failedCount > 0) {
        setError(
          `이미지 생성 ${result.failedCount}건 모두 실패: ${result.errors[0] ?? "원인 미상"}`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setRunning(false);
    }
  };

  const pick = async (imageId: string) => {
    try {
      await selectImage(imageId);
      await load();
    } catch (err) {
      // 이전에는 selectImage가 실패해도 결과를 검사하지 않아 조용히
      // 무시되었다(T1-119) — 이제 기존 오류 배너에 원인을 보여준다.
      setError(err instanceof Error ? err.message : "선택 실패");
    }
  };

  return (
    <Card title={IMAGE_CATEGORY_LABELS[category]}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
          <p className="text-[11px] text-zinc-400">
            이 목적({IMAGE_CATEGORY_LABELS[category]})만의 요구사항 — 예:{" "}
            {category === "HERO" && "배경/구도/분위기"}
            {category === "DETAIL" && "강조할 제품 부위/촬영 거리/구도"}
            {category === "USAGE_SCENE" && "사용 상황/환경"}
            {category === "COMPONENTS" && "확인된 구성품의 배치/표현"}
            {category === "FEATURE_HIGHLIGHT" && "강조할 기능/시각적 표현 방식"}
            {category === "OTHER" && "필요한 보조 설명 방식"}
            . 실제 제품과 충돌하면 반영되지 않습니다.
          </p>
          {profileId ? (
            <>
              <textarea
                value={requirementText}
                onChange={(e) => setRequirementText(e.target.value)}
                rows={2}
                maxLength={USER_REQUIREMENT_MAX_LENGTH}
                placeholder="예: 화이트 배경에 은은한 그림자만"
                className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveRequirement()}
                  disabled={requirementSaving}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {requirementSaving ? "저장 중…" : "이 목적 요구사항 저장"}
                </button>
                {requirementSaved && <Badge tone="ok">저장됨</Badge>}
              </div>
              {requirementError && (
                <p className="text-[11px] text-red-600 dark:text-red-400">{requirementError}</p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              이 사진에 대해 검증된 Product Profile이 아직 없어 목적별 요구사항을 저장할 수
              없습니다 — 먼저 Product Profile을 생성하세요.
            </p>
          )}
        </div>
        <p className="text-[11px] text-zinc-400">
          ② AI 이미지 생성 — 아래 버튼으로 이 카테고리의 후보를 만듭니다.
        </p>
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
          <>
            <p className="text-[11px] text-zinc-400">
              ③ 상세페이지에 쓸 이미지 선택 — 썸네일을 클릭하면 선택/해제됩니다(✓ 선택됨 =
              상세페이지에 포함). &quot;자동 선택됨&quot;은 검증을 통과한 최신 생성 결과가
              사람 확인 없이 파이프라인에 의해 골라진 것이고, &quot;선택됨(고정)&quot;은 이
              썸네일을 직접 클릭해 사람이 명시적으로 고른 것 — 이후 새로 생성해도 자동으로
              바뀌지 않습니다(다시 클릭해 해제하기 전까지).
            </p>
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
                    {candidate.selected && candidate.locked && <Badge tone="ok">선택됨(고정)</Badge>}
                    {candidate.selected && !candidate.locked && (
                      <Badge tone="info">자동 선택됨</Badge>
                    )}
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
          </>
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
                  AI에 전달된 참조 이미지
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
                  OCR 전용 — AI에 전달하지 않음
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

            {expandedCandidate.generationMetadata?.productPackage?.userRequirement && (
              <div>
                <p className="mb-1 font-medium text-purple-700 dark:text-purple-400">
                  사용자 요구사항 (이 목적에 저장된 값이 있으면 그 값, 없으면 공용 요구사항)
                </p>
                <p className="rounded bg-purple-50 p-2 whitespace-pre-wrap dark:bg-purple-950/40">
                  {expandedCandidate.generationMetadata.productPackage.userRequirement}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1 font-medium">AI에 실제 전달된 Prompt</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 dark:bg-zinc-800">
                {expandedCandidate.generationMetadata?.prompt ?? "(기록된 Prompt가 없습니다)"}
              </pre>
            </div>

            {expandedCandidate.generationMetadata?.rawResponseText && (
              <div>
                <p className="mb-1 font-medium">AI 응답 텍스트</p>
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
