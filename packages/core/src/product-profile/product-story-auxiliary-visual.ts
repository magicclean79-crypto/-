import type { ProductProfile } from "@acos/shared";
import type { AssignedStorySection, ProductStory } from "./product-story";
import type { SectionDesignSpec, StoryDesignPlan } from "./product-story-design";

/**
 * Gemini 보조 비주얼(Auxiliary Visual) 계약. (T1-112)
 *
 * 지금까지 Gemini가 만드는 이미지는 전부 "제품 그 자체"였다(대표
 * 썸네일·사용 장면·디테일·구성품 — `image-gen.service.ts`). 이 파일은
 * 그것과는 **역할이 다른** 두 번째 종류의 Gemini 출력을 위한 계약을
 * 정의한다: 텍스트만으로 부족한 시각적 강조가 필요한 섹션에 붙이는
 * **장식·보조 그래픽**(추상 배경, 섹션 강조 아트) — 실제 제품 사진을
 * 대체하지 않고, 제품에 없는 형태·구성·사양을 새로 주장하지도 않는다.
 *
 * ## 이 파일이 하지 않는 것 (의도적)
 *
 * - **실제 Gemini API를 호출하지 않는다.** `planAuxiliaryVisuals`·
 *   `buildAuxiliaryVisualPrompt` 모두 순수 함수다 — 프롬프트 문자열과
 *   "무엇을 요청할 것인가"라는 계획만 만든다. 실제 호출은
 *   `ImageGenService.generateAuxiliaryVisual()`(T1-123, `apps/api/src/
 *   image-gen/image-gen.service.ts`)이 이 계획을 그대로 받아 수행한다 —
 *   DB 스키마·저장 없이(무상태, Product Story 자체와 같은 원칙) 호출자
 *   (`ProductProfileService.generateStory()`)가 결과를 바로
 *   `AuxiliaryVisualAsset`으로 조립해 렌더러에 넘긴다. (2026-08-12
 *   T1-112 시점에는 동시 진행 중인 다른 작업이 `image-gen.*`·
 *   `schema.prisma`를 함께 수정하고 있어 배선을 미뤘었다 — 그 위험은
 *   해소됐고, 이 파일의 계약(타입·프롬프트·선정 로직)은 그대로 재사용
 *   했다.)
 * - 이미지 바이트를 만들지 않는다. `AuxiliaryVisualAsset`은 호출자가
 *   실제 생성 결과(base64)를 채워 넣는 자리만 정의한다.
 *
 * ## 선정 규칙 — 왜 이 섹션에만 붙이는가
 *
 * 실제 제품 사진이 이미 배정된 섹션에는 보조 그래픽을 붙이지 않는다 —
 * "실제 제품 사진을 대체하지 말고 보조 비주얼로만 사용한다"는 요청
 * 사양이 명시한 우선순위다. 사진이 없는(`imageRole: "NONE"`) 섹션 중,
 * 근거 있는 카피가 있어(사진 없이도 텍스트만으로 이미 뜻이 전달되는)
 * 시각적 강조가 실제로 값어치 있는 경우만 고른다 — 모든 텍스트 섹션에
 * 기계적으로 붙이지 않는다(요청 사양 "실제로 가치가 있는 경우").
 */

export type AuxiliaryVisualRole = "SECTION_BACKDROP" | "ABSTRACT_EMPHASIS";

export interface AuxiliaryVisualSpec {
  sectionId: string;
  role: AuxiliaryVisualRole;
  /** 왜 이 섹션에 보조 그래픽이 필요한지 — 디버깅·사람 검토용 */
  reason: string;
  /** Gemini에 실제로 보낼 프롬프트 전문 — 결정적으로 생성된다(같은 입력 → 같은 문장) */
  promptText: string;
}

/**
 * 실제 생성 결과. `source: "gemini-auxiliary"`로 실제 제품 사진
 * (`StudioSelectedImage`, 암묵적으로 "product-photo")과 구분한다 —
 * 요청 사양 "Gemini가 생성한 보조 그래픽과 실제 제품 사진을 asset
 * metadata로 구분".
 */
export interface AuxiliaryVisualAsset {
  sectionId: string;
  role: AuxiliaryVisualRole;
  source: "gemini-auxiliary";
  mimeType: string;
  base64: string;
}

/** 장식이 의미 있는 레이아웃만 대상으로 한다 — 사진이 이미 있거나(있으면 그 사진이 우선) 순수 인용문(problem-empathy)은 대상에서 뺀다 */
const ELIGIBLE_LAYOUTS = new Set<SectionDesignSpec["layout"]>(["text-only", "feature-highlight"]);

/** 한 상세페이지당 최대 몇 개까지 보조 그래픽을 계획할지 — 무제한 생성으로 비용이 새는 것을 막는다 */
const MAX_AUXILIARY_VISUALS = 2;

const NEGATIVE_GUARDRAILS =
  "실제 제품의 형태·구성품·소재·색상·수치·인증을 새로 만들거나 암시하지 마세요. " +
  "글자·로고·상표를 그리지 마세요. 사람·제품 실물을 그리지 마세요 — 이 이미지는 " +
  "제품 사진이 아니라 텍스트 섹션을 보조하는 추상적 배경/강조 그래픽입니다.";

/**
 * Story + Design Plan + 실제 이미지 배정 결과에서, 보조 그래픽이 실제로
 * 값어치 있는 섹션만 골라 계획을 만든다. LLM 호출 없음 — 순수 함수.
 */
export function planAuxiliaryVisuals(
  story: ProductStory,
  assigned: AssignedStorySection[],
  designPlan: StoryDesignPlan,
): AuxiliaryVisualSpec[] {
  const designBySectionId = new Map(designPlan.sections.map((s) => [s.sectionId, s]));
  const specs: AuxiliaryVisualSpec[] = [];

  for (const item of assigned) {
    if (specs.length >= MAX_AUXILIARY_VISUALS) break;
    if (item.image) continue; // 실제 제품 사진이 있으면 그것이 우선 — 보조 그래픽을 붙이지 않는다
    if (item.section.copy.trim().length < 20) continue; // 텍스트 자체가 빈약하면 강조할 것이 없다

    const design = designBySectionId.get(item.section.sectionId);
    if (!design || !ELIGIBLE_LAYOUTS.has(design.layout)) continue;

    const role: AuxiliaryVisualRole = design.layout === "text-only" ? "SECTION_BACKDROP" : "ABSTRACT_EMPHASIS";
    specs.push({
      sectionId: item.section.sectionId,
      role,
      reason:
        design.layout === "text-only"
          ? "실제 제품 사진이 없는 텍스트 전용 섹션 — 추상 배경으로 시각적 무게를 보완"
          : "근거 있는 특징 카드인데 사진이 없음 — 강조 그래픽으로 카드의 시각적 존재감을 보완",
      promptText: buildAuxiliaryVisualPrompt(item.section.keyMessage, design.accentColor, role),
    });
  }

  return specs;
}

/**
 * Gemini에 실제로 보낼 프롬프트 문장을 만든다. 순수 함수 — 같은 입력이면
 * 항상 같은 문장이 나온다(재현 가능, 테스트 가능).
 */
export function buildAuxiliaryVisualPrompt(
  keyMessage: string,
  accentColor: string,
  role: AuxiliaryVisualRole,
): string {
  const intent =
    role === "SECTION_BACKDROP"
      ? "이 섹션의 배경으로 쓸 은은한 추상 그래픽을 만들어주세요."
      : "이 섹션의 핵심 메시지를 시각적으로 강조하는 추상 그래픽을 만들어주세요.";
  return [
    "[상세페이지 보조 그래픽 생성 — 제품 사진 아님]",
    intent,
    `이 섹션이 전달하려는 메시지: "${keyMessage}"`,
    `상세페이지의 강조색(${accentColor})과 어울리는 톤으로, 은은하고 미니멀하게 만들어주세요.`,
    NEGATIVE_GUARDRAILS,
  ].join(" ");
}

/**
 * 실제 API 호출 없이 "이번 상세페이지에서 보조 그래픽을 무엇을 몇 장
 * 요청하게 될 것인가"만 미리 확인하는 dry-run. `ImageGenService`가
 * 실제로 이 계약을 쓸 준비가 될 때까지, 파이프라인 검증(요청 사양
 * "dry-run으로 파이프라인을 검증")에 쓴다.
 */
export interface AuxiliaryVisualDryRunResult {
  plannedCount: number;
  specs: AuxiliaryVisualSpec[];
  skippedReason: string | null;
}

export function dryRunAuxiliaryVisualPlan(
  story: ProductStory,
  assigned: AssignedStorySection[],
  designPlan: StoryDesignPlan,
  profile: ProductProfile,
): AuxiliaryVisualDryRunResult {
  const specs = planAuxiliaryVisuals(story, assigned, designPlan);
  if (specs.length === 0) {
    const hasAnyTextOnlySection = assigned.some((item) => !item.image);
    return {
      plannedCount: 0,
      specs: [],
      skippedReason: hasAnyTextOnlySection
        ? "텍스트 전용 섹션은 있으나 카피가 짧거나 대상 레이아웃이 아니어서 보조 그래픽을 계획하지 않았습니다."
        : "모든 섹션에 실제 제품 사진이 배정되어 보조 그래픽이 필요하지 않습니다.",
    };
  }
  // profile은 이번 dry-run에서 프롬프트 내용을 바꾸지 않는다 — 향후 브랜드 톤(예: MAGICCLEAN_BRAND_BASELINE)을
  // 반영하게 되면 이 자리에서 profile.productName 등을 프롬프트에 섞을 수 있다. 지금은 시그니처만 남긴다.
  void profile;
  return { plannedCount: specs.length, specs, skippedReason: null };
}
