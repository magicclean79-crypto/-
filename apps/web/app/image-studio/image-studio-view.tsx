"use client";

import { useEffect, useState } from "react";
import type { GenerateHeroImageResult, ImageDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import type { ImageCategory } from "@acos/shared";
import { AuthImage } from "../product-profile/auth-image";
import { BENCHMARK_IMAGE_IDS } from "../benchmark/constants";
import { imageStudioFetch } from "./api-client";
import { CategoryPanel } from "./category-panel";
import { DetailPagePanel } from "./detail-page-panel";
import { ProductStoryPanel } from "./product-story-panel";
import { UserRequirementPanel } from "./user-requirement-panel";

const CATEGORIES: ImageCategory[] = ["HERO", "USAGE_SCENE", "DETAIL", "FEATURE_HIGHLIGHT", "COMPONENTS"];

/**
 * 참조 사진 후보들의 photoType(DESIGN/INFO)을 조회한다 (T1-99) — 포장지·
 * 라벨·스펙표 등 상품 분석 전용(INFO) 사진은 AI 참조로 선택할 수 없게
 * 화면에서부터 막는다. 서버(`image-gen.service.ts`의 `assertNotInfoImage`·
 * `photoType: "DESIGN"` 필터)가 이미 이중으로 막고 있으므로, 이 조회가
 * 실패하거나 값이 없어도(예: 아직 분류되지 않은 사진) 안전한 기본값은
 * "선택 가능"이다 — 화면에서 잘못 막는 것보다, 서버가 최종적으로 막는
 * 쪽이 더 신뢰할 수 있는 방어선이다.
 */
async function fetchPhotoTypes(imageIds: string[]): Promise<Map<string, ImageDto["photoType"]>> {
  const map = new Map<string, ImageDto["photoType"]>();
  if (imageIds.length === 0) return map;
  try {
    const body = await imageStudioFetch<{ results: ImageDto[] }>(
      `/image-gen/images?ids=${imageIds.join(",")}`,
    );
    for (const image of body.results) {
      map.set(image.id, image.photoType ?? null);
    }
  } catch {
    // 조회 실패 시 조용히 빈 맵 — 위 주석대로 "선택 가능"이 안전한 기본값이다
  }
  return map;
}

async function generateHero(imageId: string, backgroundPrompt: string): Promise<GenerateHeroImageResult> {
  return imageStudioFetch<GenerateHeroImageResult>("/image-gen/hero", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId, backgroundPrompt: backgroundPrompt || undefined }),
  });
}

function StepCard({ label, image, description }: { label: string; image: ImageDto; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge tone="ok">{label}</Badge>
        <span className="text-xs text-zinc-500">{description}</span>
      </div>
      <AuthImage
        imageId={image.id}
        alt={label}
        className="h-64 w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
      />
    </div>
  );
}

export function ImageStudioView() {
  const [selectedIds, setSelectedIds] = useState<string[]>([BENCHMARK_IMAGE_IDS[0]]);
  const [activeId, setActiveId] = useState<string>(BENCHMARK_IMAGE_IDS[0]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateHeroImageResult | null>(null);
  // 참조 사진 후보별 photoType(DESIGN/INFO) — 상품 분석 전용(INFO)은
  // 선택 자체를 막는다 (T1-99).
  const [photoTypes, setPhotoTypes] = useState<Map<string, ImageDto["photoType"]>>(new Map());

  useEffect(() => {
    void fetchPhotoTypes(BENCHMARK_IMAGE_IDS).then((map) => {
      setPhotoTypes(map);
      // 분류 조회가 늦게 도착해 이미 INFO 사진이 선택돼 있었다면 제거한다
      // — 화면 방어선도 서버만큼 확실하게 만든다(T1-99, 이중 방어).
      setSelectedIds((prev) => {
        const filtered = prev.filter((id) => map.get(id) !== "INFO");
        return filtered.length > 0 ? filtered : [BENCHMARK_IMAGE_IDS[0]];
      });
    });
  }, []);

  // 선택 해제 등으로 활성 사진이 선택 목록에서 빠지면 첫 번째 선택 사진으로 되돌린다
  useEffect(() => {
    if (!selectedIds.includes(activeId)) {
      setActiveId(selectedIds[0]);
    }
  }, [selectedIds, activeId]);

  const toggleSelected = (imageId: string) => {
    // 상품 분석 전용(INFO) 사진은 애초에 클릭 핸들러가 붙지 않지만
    // (아래 렌더링에서 disabled 처리), 방어적으로 한 번 더 막는다.
    if (photoTypes.get(imageId) === "INFO") return;
    setSelectedIds((prev) => {
      if (prev.includes(imageId)) {
        // 최소 한 장은 선택되어 있어야 아래 카테고리 패널이 의미가 있다
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== imageId);
      }
      return [...prev, imageId];
    });
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await generateHero(selectedIds[0], prompt);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실행 실패");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title="① 제품 참조 사진 선택 → ② AI 이미지 생성 → ③ 상세페이지에 쓸 이미지 선택 → ④ Product Story·상세페이지 확인">
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              ① AI 참조에 사용할 실제 제품 사진 선택 (Benchmark 분사기 7장, 여러 장 선택 가능)
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              여기서 고른 사진은 AI가 실제 제품과 똑같은 제품을 그리도록 참고하는{" "}
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                제품 동일성 참조용
              </strong>
              입니다. <strong className="font-medium text-amber-700 dark:text-amber-400">
                이 사진 자체가 상세페이지에 자동으로 들어가지 않습니다
              </strong>
              — 상세페이지에 실제로 쓸 이미지는 아래 ③ 단계에서 AI 생성 후보 중 따로
              선택합니다. 포장지·라벨·사양표처럼{" "}
              <strong className="font-medium text-amber-700 dark:text-amber-400">
                상품 분석 전용으로 쓰인 사진은 여기서 선택할 수 없습니다
              </strong>
              (Product Analysis/OCR 데이터로만 남습니다).
            </p>
            <div className="flex flex-wrap gap-3">
              {BENCHMARK_IMAGE_IDS.map((imageId) => {
                const checked = selectedIds.includes(imageId);
                const photoType = photoTypes.get(imageId) ?? null;
                const isInfo = photoType === "INFO";
                return (
                  <div key={imageId} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      disabled={isInfo}
                      onClick={() => toggleSelected(imageId)}
                      aria-label={isInfo ? "상품 분석 전용 · 이미지 생성에 사용할 수 없음" : "AI 제품 참조용"}
                      className={`relative rounded-lg border-2 p-1 ${
                        isInfo
                          ? "cursor-not-allowed border-transparent opacity-40 grayscale"
                          : checked
                            ? "border-blue-600"
                            : "border-transparent"
                      }`}
                    >
                      <AuthImage imageId={imageId} alt="원본 후보" className="h-20 w-20 rounded object-cover" />
                      {checked && !isInfo && (
                        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                          ✓
                        </span>
                      )}
                    </button>
                    <span
                      className={`w-20 text-center text-[10px] leading-tight ${
                        isInfo
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {isInfo ? "상품 분석 전용 · 이미지 생성에 사용할 수 없음" : "AI 제품 참조용"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedIds.length > 1 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                선택 상태 확인 — 아래에서 작업할 사진 1장을 고르세요 ({selectedIds.length}장 선택됨)
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedIds.map((imageId) => {
                  const active = imageId === activeId;
                  return (
                    <button
                      key={imageId}
                      type="button"
                      onClick={() => setActiveId(imageId)}
                      className={`relative rounded-lg border-2 p-1 ${
                        active ? "border-emerald-600" : "border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      <AuthImage
                        imageId={imageId}
                        alt="선택한 원본"
                        className="h-14 w-14 rounded object-cover"
                      />
                      {active && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-emerald-600 px-1 text-[10px] text-white">
                          작업 중
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <UserRequirementPanel key={`req-${activeId}`} sourceImageId={activeId} />

          <div>
            <div className="mb-1 flex items-center gap-2">
              <AuthImage imageId={activeId} alt="작업 중인 사진" className="h-8 w-8 rounded object-cover" />
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                ② AI 이미지 생성 → ③ 상세페이지에 쓸 이미지 선택
              </h3>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              위에서 선택한 제품 참조 사진 + 검증된 Product Profile/Product Package + 요구사항을
              바탕으로 카테고리별 후보를 생성합니다(그룹마다 재생성·이전 버전 탐색 가능). 카드 안의
              후보 썸네일을 클릭(✓)하면 그 이미지가 상세페이지에 쓸 이미지로 선택됩니다 — 선택하지
              않으면 상세페이지에 쓰이지 않습니다.
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {CATEGORIES.map((category) => (
                <CategoryPanel key={`${activeId}-${category}`} category={category} sourceImageId={activeId} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              ④ Product Story 및 상세페이지 생성/확인
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              최종 상세페이지는 하나의 파이프라인(Product Story → Design Plan → 실제 제품 사진 +
              AI 생성 비주얼)으로만 만듭니다(T1-131). ④-A는 ③에서 선택한 이미지가 최종
              생성을 시작하기에 충분한지 먼저 확인하는 단계이고, ④-B가 실제로 최종 상세페이지를
              생성합니다.
            </p>
            <div className="flex flex-col gap-4">
              <DetailPagePanel key={activeId} sourceImageId={activeId} />
              <ProductStoryPanel key={`story-${activeId}`} sourceImageId={activeId} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="(참고) 대표 썸네일 빠른 테스트 — 배경 제거→생성→합성을 한 번에">
        <p className="mb-3 text-xs text-zinc-500">
          위 카테고리별 기능과 별개로, 예전에 만든 빠른 테스트용입니다.
        </p>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 밝은 베란다, 타일 바닥, 화분이 보이는 공간"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </Card>

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="self-start rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {running
          ? "실행 중… (배경 제거 → 배경 생성 → 합성, 실 AI 호출 3건, 수십 초 소요)"
          : "배경 제거 → 배경 생성 → 합성 실행"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <Card title="결과 — 4단계 그대로 보기">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard label="원본" image={result.original} description="사람이 찍은 원본 사진" />
            <StepCard
              label="배경 제거"
              image={result.backgroundRemoved}
              description="AI가 배경을 지운 결과"
            />
            <StepCard
              label="배경 생성"
              image={result.backgroundGenerated}
              description="AI가 새로 만든 배경"
            />
            <StepCard
              label="최종 합성"
              image={result.composited}
              description="제품을 새 배경에 합성한 최종 결과"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
