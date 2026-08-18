import type { ImageCategory, ProductPackage, ProductProfile } from "@acos/shared";
import type { StudioSelectedImage } from "./product-page-images";

/**
 * Product Story — 상세페이지 생성의 핵심 개념을 "제품의 스토리를 만드는
 * 것"으로 재정의한다. (T1-94, 2026-08-12)
 *
 * 기존 STEP 5(카피 생성 → HTML 조립)는 headline·description 두 문장과
 * "사진을 카테고리 순서대로 늘어놓는" 배치였다 — 사진과 문구가 서로
 * 무엇을 뒷받침하는지 구조적으로 연결돼 있지 않았다. 이 파일은 그 사이에
 * 정식 단계를 하나 추가한다:
 *
 *   Product Profile/Package + 검증된 실제 제품 이미지 + 사용자 요구사항
 *     → Product Story(하나의 일관된 서사)
 *     → Story Section들(목적·고객 상황·근거·핵심 메시지·이미지 역할·카피·전환 논리)
 *
 * ## 원칙
 *
 * - 없는 기능/효능/성능/수치/소재/구성품/인증을 창작하지 않는다 — 카피
 *   생성은 LLM이 하지만(자연스러운 문장이 필요하므로), 근거(`productFacts`)는
 *   Product Profile에 실제로 있는 사실만 인용해야 한다는 것을 프롬프트가
 *   강제하고, 사후에 `product-story-quality.ts`가 기계적으로 재검사한다.
 * - 섹션 수·구성은 제품마다 동적이다. 모든 제품에 같은 개수를 강제하지
 *   않는다(프롬프트가 "근거 없는 섹션은 생략" 하도록 지시).
 * - 이미지 역할(`imageRole`)은 LLM이 실제 이미지 바이트를 보고 정하는 것이
 *   아니라 **카테고리 단위로만** 정한다 — Gemini가 만든 실제 이미지가 어떤
 *   카테고리인지는 이미 Image Studio에서 사람이 선택을 마쳤고(제품 동일성
 *   검증 완료), Story 단계가 그 카테고리를 다시 추측할 필요가 없다.
 * - OCR/포장/라벨/사양표/설명서 이미지(`photoType: "INFO"`)는 애초에
 *   `availableImageCategories`에 들어오지 않는다 — 호출자(apps/api)가
 *   Studio 선택 이미지를 모을 때 이미 제외한다(T1-88과 동일 규칙).
 */

export type ProductStoryImageRole = ImageCategory | "NONE";

export interface ProductStorySection {
  sectionId: string;
  /** 이 섹션이 스토리에서 하는 역할 (예: "문제 제기", "핵심 특징 근거") */
  purpose: string;
  /** 고객이 이 시점에 갖고 있을 상황·질문 */
  customerContext: string;
  /** Product Profile/Package에 실제로 있는 근거 — 지어낸 사실 금지 */
  productFacts: string[];
  /** 이 섹션이 전달하려는 핵심 메시지 한 줄 */
  keyMessage: string;
  /** 이 섹션에 연결할 이미지 카테고리 — 근거 이미지가 없으면 "NONE" */
  imageRole: ProductStoryImageRole;
  /** imageRole이 "NONE"이 아닐 때, 그 이미지가 실제로 보여주는 사실 */
  imageFactsShown: string[];
  /** 상세페이지에 실릴 카피 — 빈 광고 수식어·감성 문구 금지(품질 검사 대상) */
  copy: string;
  /** 다음 섹션으로 이어지는 논리 — 마지막 섹션은 빈 문자열 허용 */
  transitionToNext: string;
}

export interface ProductStory {
  productName: string;
  /** 이 제품의 스토리를 한 문단으로 요약 — "왜 필요한가 → ... → 구매 전 확인" 흐름 전체 */
  narrativeSummary: string;
  sections: ProductStorySection[];
}

/** Story 생성 프롬프트에 넘길 이미지 카테고리 현황 — 실제 바이트가 아니라 개수만 */
export interface ProductStoryAvailableImage {
  category: ImageCategory;
  count: number;
}

export interface ProductStoryContext {
  profile: ProductProfile;
  /** brand/model/material/usage 등 — Product Package에서 교차 검증된 값만 전달 */
  productPackage: Pick<
    ProductPackage,
    "brand" | "model" | "material" | "usage" | "productName" | "features" | "specifications"
  >;
  /** Image Studio에서 사람이 이미 선택(검증)한 실제 제품 이미지의 카테고리 현황 */
  availableImages: ProductStoryAvailableImage[];
  /** 사용자 요구사항 (T1-92) — Story의 표현·섹션 우선순위에 반영하되 사실은 바꾸지 않는다 */
  userRequirement?: string | null;
  /**
   * 목적(카테고리)별 사용자 요구사항 (T1-99, Story 연결은 T1-147). Image
   * Studio 카테고리 카드에서 입력한 값 — 해당 카테고리를 imageRole로 쓰는
   * 섹션에만 반영한다. 값이 없는 카테고리는 이 필드에 아예 키로 존재하지
   * 않는다.
   */
  userRequirementsByCategory?: Partial<Record<ImageCategory, string>> | null;
}

/** LLM 응답을 ProductStory로 해석할 수 없을 때 */
export class ProductStoryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductStoryParseError";
  }
}

function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

const VALID_IMAGE_ROLES = new Set<string>([
  "HERO",
  "USAGE_SCENE",
  "DETAIL",
  "FEATURE_HIGHLIGHT",
  "COMPONENTS",
  "OTHER",
  "NONE",
]);

/**
 * LLM 텍스트 응답 → ProductStory 파서. 구조 검증만 한다(형식이 맞는지) —
 * 사실 근거가 진짜인지는 여기서 판단하지 않는다(`product-story-quality.ts`
 * 가 별도로 기계적 신호만 찾는다, 최종 판단은 사람).
 *
 * `availableCategories`에 없는 `imageRole`을 LLM이 답하면(예: 실제로는
 * COMPONENTS 사진이 없는데 COMPONENTS를 요구) 지어낼 수 없는 이미지를
 * 요구한 것이므로 "NONE"으로 강제한다 — 존재하지 않는 이미지를 있는
 * 것처럼 다루지 않는다.
 */
export function parseProductStoryResponse(
  text: string,
  availableCategories: ImageCategory[],
): ProductStory {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new ProductStoryParseError("LLM 응답에서 JSON 객체를 찾을 수 없습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ProductStoryParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProductStoryParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }
  const record = parsed as Record<string, unknown>;
  const productName = asString(record.productName);
  const narrativeSummary = asString(record.narrativeSummary);
  const rawSections = record.sections;
  if (!productName || !narrativeSummary || !Array.isArray(rawSections) || rawSections.length === 0) {
    throw new ProductStoryParseError(
      "Product Story에 productName·narrativeSummary·sections(1개 이상)가 모두 있어야 합니다.",
    );
  }

  const availableSet = new Set<string>(availableCategories);
  const sections: ProductStorySection[] = rawSections.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ProductStoryParseError(`sections[${index}]가 객체가 아닙니다.`);
    }
    const s = raw as Record<string, unknown>;
    const purpose = asString(s.purpose);
    const customerContext = asString(s.customerContext);
    const keyMessage = asString(s.keyMessage);
    const copy = asString(s.copy);
    if (!purpose || !customerContext || !keyMessage || !copy) {
      throw new ProductStoryParseError(
        `sections[${index}]에 purpose·customerContext·keyMessage·copy가 모두 있어야 합니다.`,
      );
    }
    const rawRole = asString(s.imageRole, "NONE").toUpperCase();
    const declaredRole = VALID_IMAGE_ROLES.has(rawRole) ? (rawRole as ProductStoryImageRole) : "NONE";
    // 실제로 선택된 이미지가 없는 카테고리를 요구했으면 지어낼 수 없다 — NONE으로 강제
    const imageRole: ProductStoryImageRole =
      declaredRole === "NONE" || availableSet.has(declaredRole) ? declaredRole : "NONE";
    return {
      sectionId: asString(s.sectionId) || `section-${index + 1}`,
      purpose,
      customerContext,
      productFacts: asStringArray(s.productFacts),
      keyMessage,
      imageRole,
      imageFactsShown: imageRole === "NONE" ? [] : asStringArray(s.imageFactsShown),
      copy,
      transitionToNext: asString(s.transitionToNext),
    };
  });

  return { productName, narrativeSummary, sections };
}

/** Story Section 하나에 실제로 배정된 이미지 */
export interface AssignedStorySection {
  section: ProductStorySection;
  image: StudioSelectedImage | null;
  /**
   * 같은 카테고리의 나머지 이미지들 (T1-144 — 이미지 밀도 확대). 구성품·
   * 디테일처럼 "여러 장을 함께 보여줘야 실제로 뜻이 통하는" 섹션에서
   * `image`(대표 1장) 외에 추가로 렌더링할 사진들이다. 렌더러가 이 값을
   * 쓰지 않는 레이아웃(예: notice·spec-panel)에서는 그냥 무시된다 —
   * 존재 자체가 강제 표시를 뜻하지 않는다. 선택 필드다 — 없으면(기존
   * 테스트 픽스처·이전 호출부) 빈 배열로 취급한다.
   */
  gallery?: StudioSelectedImage[];
}

/**
 * 한 섹션에 대표 이미지 외에 추가로 붙일 수 있는 갤러리 사진의 상한
 * (T1-144 최초 3장 → T1-147에서 6장으로 확대). 승인된 레퍼런스 시안은
 * lifestyle/사용 장면 섹션에서 제품 연출 이미지를 여러 장 한 줄/그리드로
 * 크게 보여준다 — 3장은 그 밀도에 못 미쳐(레이아웃 하나에 1x3 그리드
 * 정도만 가능) 2x3까지 채울 수 있게 늘렸다. 이렇게 늘려도 "동일 이미지
 * 반복 최소화" 원칙(`assignStoryImages` 1차 패스)은 그대로 유지된다 —
 * 상한은 "얼마나 많이 보여줄 수 있는가"이지 "억지로 채운다"는 뜻이
 * 아니다.
 */
const MAX_GALLERY_PER_SECTION = 6;

/**
 * 구성품(COMPONENTS) 역할은 실제 사진만 후보로 인정한다(T1-144 요청 사양
 * 6 — "구성품이 실제로 확인되지 않은 경우 생성형 모델이 새 구성품을
 * 발명하지 못하게 한다"). Gemini가 "그럴듯한 구성품 플랫레이"를 그려도
 * 그것이 실제로 상자 안에 들어있는 구성품이라는 보장이 없으므로, 이
 * 카테고리에서만 `source !== "real"` 이미지를 후보에서 제외한다. 다른
 * 카테고리(HERO·USAGE_SCENE·DETAIL·FEATURE_HIGHLIGHT·OTHER)는 실제 사진과
 * 생성 연출 이미지를 함께 쓴다 — 그 역할들은 "그 제품답게 보이는 장면"이
 * 목적이라 생성 연출이 사실을 왜곡하지 않는다.
 */
function eligibleCandidates(category: ImageCategory, images: StudioSelectedImage[]): StudioSelectedImage[] {
  if (category !== "COMPONENTS") return images;
  return images.filter((image) => (image.source ?? "generated") === "real");
}

/**
 * Story Section의 `imageRole`(카테고리)에 실제 선택 이미지를 배정한다.
 * 순수 함수 — LLM을 다시 부르지 않는다.
 *
 * 규칙(요청 사양):
 * - "동일 이미지 반복 사용을 최소화한다" — 같은 카테고리에 이미지가
 *   여러 장 있으면 아직 쓰지 않은 것을 우선 배정하고, 다 썼으면(카테고리
 *   재고 소진) 그제서야 재사용한다.
 * - imageRole이 "NONE"이면 이미지를 붙이지 않는다(텍스트 전용 섹션).
 * - imageRole은 있는데 그 카테고리의 실제 이미지가 없으면(이론상
 *   `parseProductStoryResponse`가 이미 NONE으로 강제하므로 정상 경로에서는
 *   발생하지 않지만, 호출자가 파서를 거치지 않은 임의의 Story를 넘길 수도
 *   있으므로) image: null로 남긴다 — 없는 이미지를 지어내지 않는다.
 * - **이미지 밀도 확대(T1-144)**: 대표 이미지 배정이 모든 섹션에 대해
 *   끝난 뒤에만(2차 패스), 아직 어느 섹션의 대표로도 안 쓰인 같은
 *   카테고리 이미지를 최대 `MAX_GALLERY_PER_SECTION`장까지 `gallery`에
 *   채운다. **대표 배정을 먼저 전부 끝내는 이유**: 만약 갤러리를
 *   1차 패스 안에서 즉시 채우면, 뒤에 나오는 섹션이 정작 대표로 쓸
 *   이미지가 앞 섹션의 갤러리에 먼저 소비되어 원치 않게 재사용(중복)될
 *   수 있다 — "동일 이미지 반복 최소화"라는 기존 규칙이 갤러리 때문에
 *   깨지면 안 된다. 구성품 카테고리는 `eligibleCandidates`가 이미 실제
 *   사진만으로 좁혀 놓았으므로 그 규칙이 갤러리에도 그대로 이어진다.
 */
export function assignStoryImages(
  story: ProductStory,
  availableImages: StudioSelectedImage[],
): AssignedStorySection[] {
  const byCategory = new Map<ImageCategory, StudioSelectedImage[]>();
  for (const image of availableImages) {
    const list = byCategory.get(image.category) ?? [];
    list.push(image);
    byCategory.set(image.category, list);
  }
  // 카테고리 내부는 최신 버전 우선 — orderStudioImagesForPage와 같은 원칙
  for (const list of byCategory.values()) {
    list.sort((a, b) => (b.groupVersion ?? 0) - (a.groupVersion ?? 0));
  }
  const usedImageIds = new Set<string>();

  // 1차 패스 — 대표 이미지만 배정한다(기존 T1-94 규칙 그대로, 변경 없음).
  const primary = story.sections.map((section) => {
    if (section.imageRole === "NONE") {
      return { section, image: null as StudioSelectedImage | null };
    }
    const candidates = eligibleCandidates(section.imageRole, byCategory.get(section.imageRole) ?? []);
    if (candidates.length === 0) {
      return { section, image: null as StudioSelectedImage | null };
    }
    const fresh = candidates.find((image) => !usedImageIds.has(image.imageId));
    const chosen = fresh ?? candidates[0];
    usedImageIds.add(chosen.imageId);
    return { section, image: chosen };
  });

  // 2차 패스 — 모든 대표 배정이 끝난 뒤 남은 이미지만 갤러리로 채운다(T1-144).
  return primary.map(({ section, image }) => {
    if (!image) {
      return { section, image, gallery: [] };
    }
    // 이 시점에서 image가 있다는 것은 1차 패스가 이미 imageRole !== "NONE"임을
    // 확인했다는 뜻이다 — 실제 카테고리로 좁혀 다시 조회한다.
    const role = section.imageRole as ImageCategory;
    const candidates = eligibleCandidates(role, byCategory.get(role) ?? []);
    const gallery = candidates
      .filter((candidate) => !usedImageIds.has(candidate.imageId))
      .slice(0, MAX_GALLERY_PER_SECTION);
    for (const candidate of gallery) {
      usedImageIds.add(candidate.imageId);
    }
    return { section, image, gallery };
  });
}

/** 최종 상세페이지 맨 아래 "제품 더 보기" 갤러리에 넣을 사진 하나 */
export interface LeftoverGalleryEntry {
  image: StudioSelectedImage;
}

/** 남은 갤러리 상한(T1-144) — 무한정 붙이면 다시 "사진 나열"이 된다 */
const MAX_LEFTOVER_GALLERY = 8;

/**
 * `assignStoryImages`가 어느 섹션에도 배정하지 않은(대표·갤러리 어느
 * 쪽으로도 쓰이지 않은) 실제 선택 이미지를 모은다(T1-144 요청 사양 4 —
 * "제품 디테일 crop/zoom asset을 추가해 12개 이상으로 확장"). Image
 * Studio에서 사람이 이미 검증해 선택해 둔 사진인데 Story 섹션 수가
 * 적어서(예: 5개 섹션) 다 못 쓰고 버려지는 사진을 상세페이지 맨 아래
 * "제품 더 보기" 구획으로 살린다 — 카테고리 순서(대표 이미지 순서와
 * 동일)로 정렬하고, 같은 이미지를 두 번 넣지 않는다.
 */
export function buildLeftoverMediaGallery(
  assigned: AssignedStorySection[],
  availableImages: StudioSelectedImage[],
): LeftoverGalleryEntry[] {
  const usedImageIds = new Set<string>();
  for (const item of assigned) {
    if (item.image) usedImageIds.add(item.image.imageId);
    for (const galleryImage of item.gallery ?? []) usedImageIds.add(galleryImage.imageId);
  }
  const leftovers = availableImages.filter((image) => !usedImageIds.has(image.imageId));
  const seen = new Set<string>();
  const unique = leftovers.filter((image) => {
    if (seen.has(image.imageId)) return false;
    seen.add(image.imageId);
    return true;
  });
  return unique.slice(0, MAX_LEFTOVER_GALLERY).map((image) => ({ image }));
}

/**
 * `buildLeftoverMediaGallery`가 찾은, 어느 섹션에도 배정되지 못한 사진을
 * "제품 더 보기"라는 별도 회수 섹션으로 모으는 대신, **같은 카테고리를
 * 이미 쓰고 있는 섹션의 갤러리**에 합쳐 넣는다. (T1-147)
 *
 * 승인된 레퍼런스 시안에는 "더 보기" 같은 별도 잡동사니 섹션이 없다 —
 * 제품 연출 이미지는 각자 의미 있는 섹션(사용 장면·디테일 등) 안에
 * 크게/여러 장 배치된다. 그래서 카테고리가 일치하는 섹션이 있으면
 * 거기로 합치고(그 섹션은 원래 같은 카테고리 사진을 쓰기로 이미 정해져
 * 있으므로 맥락이 어긋나지 않는다), **일치하는 섹션이 하나도 없는
 * 카테고리**(어떤 섹션도 그 imageRole을 쓰지 않은 경우)는 억지로 아무
 * 섹션에나 끼워 넣지 않고 그대로 버린다 — 엉뚱한 섹션에 맥락이 안 맞는
 * 사진을 넣는 것이 "몇 장 덜 보여주는 것"보다 나쁘다(요청 사양 "이미지가
 * 섹션 목적과 맞지 않으면 renderer가 선택하지 못하게 한다").
 *
 * 카테고리가 일치하는 섹션이 여러 개면 그 중 **갤러리가 더 적게 찬
 * 섹션**부터 채운다 — 한 섹션에만 몰리지 않고 고르게 퍼진다.
 */
export function foldLeftoverImagesIntoSections(
  assigned: AssignedStorySection[],
  leftovers: LeftoverGalleryEntry[],
): AssignedStorySection[] {
  if (leftovers.length === 0) return assigned;
  const galleries = assigned.map((item) => [...(item.gallery ?? [])]);
  const categoryToIndices = new Map<ImageCategory, number[]>();
  assigned.forEach((item, index) => {
    if (item.section.imageRole === "NONE") return;
    const list = categoryToIndices.get(item.section.imageRole) ?? [];
    list.push(index);
    categoryToIndices.set(item.section.imageRole, list);
  });

  for (const { image } of leftovers) {
    const candidateIndices = categoryToIndices.get(image.category);
    if (!candidateIndices || candidateIndices.length === 0) continue;
    let targetIndex = candidateIndices[0];
    for (const index of candidateIndices) {
      if (galleries[index].length < galleries[targetIndex].length) targetIndex = index;
    }
    galleries[targetIndex].push(image);
  }

  return assigned.map((item, index) => ({ ...item, gallery: galleries[index] }));
}
