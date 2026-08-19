import type { ImageCategory, ProductProfile } from "@acos/shared";
import type { ImageFeatureAnalysis } from "./image-feature-analysis";
import type { ProductPageImage } from "./product-page-html";

/**
 * Image Studio(카테고리별 Gemini 이미지 생성 + 사람 선택)에서 사람이
 * 최종 이미지로 고른 것 하나. (T1-75 — 이미지 생성/제품 동일성 검증
 * 파이프라인 → 상세페이지 생성 연결)
 *
 * "선택됨(`Image.selected`)"이 곧 이 프로젝트가 쓰는 제품 동일성 검증
 * 신호다 — `docs/MASTER_GUIDE.md`가 정한 "사람이 마음에 드는 사진을
 * 고른다" 자리(사람의 자리 ②)를 통과한 이미지만 여기에 들어온다. INFO로
 * 분류된 사진(포장지·라벨·설명서·사양표)은 애초에 Gemini 생성 참조로도
 * 쓰이지 않으므로(`ImageGenService.assertNotInfoImage`) 이 자료구조에도
 * 나타나지 않는다 — 호출자(apps/api)가 조회 시점에 한 번 더 걸러 낸다.
 */
export interface StudioSelectedImage {
  imageId: string;
  category: ImageCategory;
  /** 같은 카테고리 안에서 최신 버전이 먼저 오도록 정렬하는 데만 쓴다 */
  groupVersion: number | null;
  mimeType: string;
  base64: string;
  /**
   * 이 사진이 실제 업로드 원본(또는 그 원본의 순수 crop)인지, Gemini가
   * 만든 연출 이미지인지 (T1-144 — 이미지 밀도 확대). "real"은 사람이
   * 촬영해 업로드한 그대로의 픽셀(또는 그 픽셀을 자르기만 한 crop)이고,
   * "generated"는 Gemini `edit()` 호출을 거친 결과(BACKGROUND_REMOVED/
   * BACKGROUND_GENERATED/COMPOSITED)다. 렌더러가 "구성품 섹션은 실제
   * 사진만" 같은 규칙을 강제할 때 이 값을 근거로 쓴다 — 지어낸 값이
   * 아니라 호출자가 `Image.kind`에서 그대로 옮겨 적는다. 선택 필드다 —
   * 값이 없으면(기존 호출부·테스트 픽스처) "generated"로 취급한다(안전한
   * 기본값 — 검증되지 않은 사진을 실제 사진으로 착각해 구성품 섹션 같은
   * 곳에 잘못 쓰지 않도록).
   */
  source?: "real" | "generated";
  /**
   * 이 사진이 고립형 제품 단독 사진인지, 실제 사용 공간이 배경인
   * 연출/lifestyle 사진인지 (T1-166). `category !== "USAGE_SCENE"`이면
   * "product-isolated"(화이트~소프트 뉴트럴 스튜디오 배경이 전제,
   * `product-composition-art-direction.ts`의 Art Direction Contract가
   * 그렇게 지시한다), `USAGE_SCENE`이면 "lifestyle"이다 — 지어낸 값이
   * 아니라 이미 있는 category에서 결정적으로 도출한다. 렌더러가 DOM에
   * `data-image-role`로 노출해, 어떤 사진에 자동 여백 정리(auto-trim)가
   * 적용될 수 있었는지 사람이 검증할 수 있게 한다. 선택 필드다 — 값이
   * 없으면(기존 호출부·테스트 픽스처) 아무 것도 표시하지 않는다.
   */
  imageRole?: "product-isolated" | "lifestyle";
  /**
   * 이 사진이 실제로 자동 여백 정리(auto-trim, T1-166)를 거쳤는지 —
   * 거쳤으면 안전 여백 비율(0~1)을, 아니면 null을 담는다. 트림이 적용되지
   * 않은 이유(원본이 이미 프레임을 채우고 있었거나, 판별이 불확실해
   * 안전하게 건너뛴 경우 등)까지는 구분하지 않는다 — "실제로 잘랐는가"만
   * 사실로 기록한다.
   */
  autoTrimMarginRatio?: number | null;
}

/**
 * 카테고리 우선순위 — `buildProductPageViewModel`(product-page-html.ts)은
 * 배열의 첫 번째 사진을 Hero로 쓰고 나머지를 특징 카드·갤러리에 순환
 * 배치한다. 대표 썸네일(HERO)이 항상 Hero 자리를 차지하도록 맨 앞에 두고,
 * 그다음은 특징 강조 → 사용 장면 → 디테일 → 구성품 → 기타 순으로 두어
 * "특징 카드"에 쓸 사진이 먼저 오게 한다.
 */
const CATEGORY_ORDER: ImageCategory[] = [
  "HERO",
  "FEATURE_HIGHLIGHT",
  "USAGE_SCENE",
  "DETAIL",
  "COMPONENTS",
  "OTHER",
];

/**
 * Image Studio에서 사람이 선택한 이미지들을 상세페이지 렌더러
 * (`renderProductProfileHtml`)가 기대하는 순서(첫 장 = Hero)로 정렬한다.
 * 순수 함수 — DB·네트워크 접근 없음. 같은 카테고리에 여러 장이 선택돼
 * 있으면(다중 선택 허용, CTO 지시 2026-08-08) 최신 버전을 먼저 둔다.
 */
export function orderStudioImagesForPage(
  images: StudioSelectedImage[],
): ProductPageImage[] {
  const sorted = [...images].sort((a, b) => {
    const orderDiff =
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (orderDiff !== 0) return orderDiff;
    return (b.groupVersion ?? 0) - (a.groupVersion ?? 0);
  });
  // category는 그대로 들고 간다(T1-93) — buildProductPageViewModel이 이미지-
  // 콘텐츠 연결(캡션 생성)에 이 값을 쓴다. mimeType·base64만 쓰던 예전
  // 계약에 필드 하나가 추가된 것뿐이라 기존 소비자(렌더러)는 그대로 동작한다.
  return sorted.map(({ mimeType, base64, category }) => ({ mimeType, base64, category }));
}

/**
 * Image Studio가 이미 알고 있는 카테고리(T1-93)를 근거로, 사진 하나하나에
 * 실제로 붙일 캡션을 만든다. 새 LLM 호출은 하지 않는다 — 이미 갖고 있는
 * 사실(Product Profile · STEP 3 이미지 특징 분석)만 쓴다
 * (`docs/PROJECT_MEMORY.md` "API 비용 최소화").
 *
 * 같은 카테고리 사진이 여러 장이면 **구체적 사실이 있는 첫 장에만** 캡션을
 * 준다. 나머지 장에는 캡션을 붙이지 않는다(T1-111) — 예전에는 구체적
 * 사실이 없으면 내부 카테고리 라벨("사용 장면 이미지"·"제품 디테일
 * 이미지"·"구성품 이미지")을 그대로 캡션으로 썼는데, 이 라벨은 그 사진이
 * "왜 여기 있는지"를 설명하지 못하는 내부 편집용 이름표일 뿐이라 고객에게는
 * 의미 없는 문구가 반복 노출되는 결과를 낳았다(같은 라벨이 카테고리 사진
 * 수만큼 그대로 반복, T1-111 사람 확인). 캡션이 없는 사진은
 * `pairFeatureTextsWithImages`가 "특징" 카드로 만들지 않고 정직하게
 * 갤러리(추가 사진)로 보낸다 — 근거 없는 문구를 사진 옆에 지어 붙이지
 * 않는다는 이 파일의 기존 원칙(추측 금지, MASTER_GUIDE §2 철학2)을 그대로
 * 지킨다.
 */
export function attachStudioImageCaptions(
  images: ProductPageImage[],
  profile: ProductProfile,
  imageFeatures: ImageFeatureAnalysis | null,
): ProductPageImage[] {
  const seenCategoryCount = new Map<ImageCategory, number>();
  const detailFact = imageFeatures?.structure ?? imageFeatures?.material ?? null;
  const componentsFact = imageFeatures?.components?.length
    ? imageFeatures.components.join(", ")
    : null;

  return images.map((image) => {
    const category = image.category ?? null;
    if (!category) {
      return image;
    }
    const seenBefore = seenCategoryCount.get(category) ?? 0;
    seenCategoryCount.set(category, seenBefore + 1);
    const isFirstOfCategory = seenBefore === 0;

    let caption: string | null = null;
    if (category === "USAGE_SCENE") {
      caption = isFirstOfCategory && profile.usage ? profile.usage : null;
    } else if (category === "DETAIL") {
      caption = isFirstOfCategory && detailFact ? detailFact : null;
    } else if (category === "COMPONENTS") {
      caption = isFirstOfCategory && componentsFact ? componentsFact : null;
    } else if (category === "OTHER") {
      caption = isFirstOfCategory && imageFeatures?.notes ? imageFeatures.notes : null;
    }
    // HERO·FEATURE_HIGHLIGHT는 캡션을 강제하지 않는다 — HERO는 대표 배경으로
    // 쓰이고, FEATURE_HIGHLIGHT는 profile.features 텍스트와 짝짓는 것이
    // 이미지-콘텐츠 연결의 본래 목적이라(product-page-html.ts
    // pairFeatureTextsWithImages) 여기서 미리 캡션을 채우면 그 매칭을
    // 가로막는다.
    return caption ? { ...image, caption } : image;
  });
}

/** 카테고리별로 최종 상세페이지에 실제로 쓸 사진 수의 기본 상한(T1-111).
 * HERO는 대표 배경 1장이면 충분하고, 나머지 역할은 이야기를 뒷받침할
 * 만큼만(과도하면 "사진 나열"이 된다) 3장으로 제한한다 — 근거:
 * `docs/PROJECT_MEMORY.md`가 기록한 대로 Image Studio는 재생성마다 이전
 * 선택을 자동으로 해제하지 않아(다중 선택 허용) 같은 카테고리에 사진이
 * 계속 쌓일 수 있다(실측: 베란다 호스 벤치마크에서 USAGE_SCENE만 11장이
 * 선택된 채로 남아 있었다). */
const DEFAULT_MAX_IMAGES_PER_CATEGORY: Record<ImageCategory, number> = {
  HERO: 1,
  FEATURE_HIGHLIGHT: 3,
  USAGE_SCENE: 3,
  DETAIL: 3,
  COMPONENTS: 3,
  OTHER: 2,
};

/**
 * Image Studio에서 선택된 이미지 중 최종 상세페이지에 실제로 쓸 대표/보조
 * 사진만 골라낸다(T1-111 요구사항 3·11 — "asset assignment 단계에서
 * deduplication/role allocation", "모든 사진을 무조건 넣지 않는다").
 * 순수 함수 — DB·네트워크 접근 없음. `orderStudioImagesForPage`와는 역할이
 * 다르다: 이 함수는 "몇 장을 쓸지" 정하고, `orderStudioImagesForPage`는
 * "그 장들을 어떤 순서로 배치할지" 정한다 — 두 단계를 분리해야
 * `orderStudioImagesForPage`의 기존 계약(모든 입력을 그대로 정렬)이
 * 바뀌지 않는다.
 *
 * 카테고리 안에서는 최신 `groupVersion`을 우선한다 — 사람이 다시 만든
 * 최신 결과가 재검토 없이 오래된 버전에 밀리지 않게 한다.
 */
export function selectRepresentativeStudioImages(
  images: StudioSelectedImage[],
  maxPerCategory: Partial<Record<ImageCategory, number>> = {},
): StudioSelectedImage[] {
  const limits: Record<ImageCategory, number> = {
    ...DEFAULT_MAX_IMAGES_PER_CATEGORY,
    ...maxPerCategory,
  };
  const byCategory = new Map<ImageCategory, StudioSelectedImage[]>();
  for (const image of images) {
    const list = byCategory.get(image.category) ?? [];
    list.push(image);
    byCategory.set(image.category, list);
  }
  const result: StudioSelectedImage[] = [];
  for (const [category, list] of byCategory) {
    const sorted = [...list].sort((a, b) => (b.groupVersion ?? 0) - (a.groupVersion ?? 0));
    const limit = limits[category] ?? DEFAULT_MAX_IMAGES_PER_CATEGORY.OTHER;
    result.push(...sorted.slice(0, Math.max(limit, 0)));
  }
  return result;
}
