import type { ProductProfile } from "@acos/shared";
import {
  attachStudioImageCaptions,
  orderStudioImagesForPage,
  selectRepresentativeStudioImages,
  type StudioSelectedImage,
} from "./product-page-images";

function image(overrides: Partial<StudioSelectedImage>): StudioSelectedImage {
  return {
    imageId: "img",
    category: "OTHER",
    groupVersion: 1,
    mimeType: "image/png",
    base64: "id-" + (overrides.imageId ?? "img"),
    ...overrides,
  };
}

describe("orderStudioImagesForPage", () => {
  it("HERO를 항상 맨 앞에 둔다 — buildProductPageViewModel이 배열의 첫 장을 Hero로 쓴다", () => {
    const images = [
      image({ imageId: "detail-1", category: "DETAIL" }),
      image({ imageId: "hero-1", category: "HERO" }),
      image({ imageId: "usage-1", category: "USAGE_SCENE" }),
    ];

    const ordered = orderStudioImagesForPage(images);

    expect(ordered[0].base64).toBe("id-hero-1");
  });

  it("카테고리 우선순위(HERO > 특징강조 > 사용장면 > 디테일 > 구성품 > 기타)를 따른다", () => {
    const images = [
      image({ imageId: "other-1", category: "OTHER" }),
      image({ imageId: "components-1", category: "COMPONENTS" }),
      image({ imageId: "detail-1", category: "DETAIL" }),
      image({ imageId: "usage-1", category: "USAGE_SCENE" }),
      image({ imageId: "feature-1", category: "FEATURE_HIGHLIGHT" }),
      image({ imageId: "hero-1", category: "HERO" }),
    ];

    const ordered = orderStudioImagesForPage(images);

    expect(ordered.map((i) => i.base64)).toEqual([
      "id-hero-1",
      "id-feature-1",
      "id-usage-1",
      "id-detail-1",
      "id-components-1",
      "id-other-1",
    ]);
  });

  it("같은 카테고리 안에서는 최신 groupVersion을 먼저 둔다", () => {
    const images = [
      image({ imageId: "hero-v1", category: "HERO", groupVersion: 1 }),
      image({ imageId: "hero-v3", category: "HERO", groupVersion: 3 }),
      image({ imageId: "hero-v2", category: "HERO", groupVersion: 2 }),
    ];

    const ordered = orderStudioImagesForPage(images);

    expect(ordered.map((i) => i.base64)).toEqual(["id-hero-v3", "id-hero-v2", "id-hero-v1"]);
  });

  it("mimeType·base64·category를 반환한다 — 렌더러(ProductPageImage)가 이미지-콘텐츠 연결에 category를 쓴다 (T1-93)", () => {
    const ordered = orderStudioImagesForPage([
      image({ imageId: "hero-1", category: "HERO", mimeType: "image/webp" }),
    ]);

    expect(ordered).toEqual([{ mimeType: "image/webp", base64: "id-hero-1", category: "HERO" }]);
  });

  it("빈 배열이면 빈 배열을 돌려준다", () => {
    expect(orderStudioImagesForPage([])).toEqual([]);
  });
});

describe("attachStudioImageCaptions", () => {
  const profile: ProductProfile = {
    productName: "베란다용 스텐 호스 세트 3M",
    brand: "삼정크린마스터",
    model: "SJ-100",
    material: "ABS, PVC, 스테인리스",
    features: ["분사기 손잡이"],
    specifications: {},
    usage: "베란다에서 물을 뿌려 청소할 때 사용",
    advantages: [],
    warnings: [],
    keywords: [],
    confidence: 0.9,
  };

  function pageImage(
    category: StudioSelectedImage["category"] | null,
    seed: string,
  ) {
    return { mimeType: "image/jpeg", base64: `id-${seed}`, category };
  }

  it("USAGE_SCENE 첫 장에는 profile.usage를 캡션으로 준다", () => {
    const [result] = attachStudioImageCaptions([pageImage("USAGE_SCENE", "u1")], profile, null);
    expect(result.caption).toBe(profile.usage);
  });

  it("같은 카테고리 두 번째 장부터는 캡션을 붙이지 않는다 — 카테고리 내부 라벨을 고객용 문구로 지어내지 않는다 (T1-111)", () => {
    const results = attachStudioImageCaptions(
      [pageImage("USAGE_SCENE", "u1"), pageImage("USAGE_SCENE", "u2")],
      profile,
      null,
    );
    expect(results[0].caption).toBe(profile.usage);
    expect(results[1].caption).toBeUndefined();
  });

  it("구체적 사실이 없으면 첫 장에도 캡션을 붙이지 않는다 — 내부 카테고리 라벨로 대체하지 않는다 (T1-111)", () => {
    const noUsageProfile: ProductProfile = { ...profile, usage: null };
    const results = attachStudioImageCaptions(
      [pageImage("USAGE_SCENE", "u1"), pageImage("DETAIL", "d1"), pageImage("COMPONENTS", "c1")],
      noUsageProfile,
      null,
    );
    expect(results[0].caption).toBeUndefined();
    expect(results[1].caption).toBeUndefined();
    expect(results[2].caption).toBeUndefined();
  });

  it("DETAIL은 STEP 3 structure/material을, COMPONENTS는 구성품 목록을 캡션으로 쓴다", () => {
    const imageFeatures = {
      material: "스테인리스",
      color: null,
      structure: "손잡이가 있는 분사기와 긴 호스 조합",
      usage: null,
      components: ["분사기 본체", "고무 패킹 두 개"],
      notes: null,
      confidence: 0.9,
      photoTypes: [],
      photoCaptions: [],
    };
    const results = attachStudioImageCaptions(
      [pageImage("DETAIL", "d1"), pageImage("COMPONENTS", "c1")],
      profile,
      imageFeatures,
    );
    expect(results[0].caption).toBe("손잡이가 있는 분사기와 긴 호스 조합");
    expect(results[1].caption).toBe("분사기 본체, 고무 패킹 두 개");
  });

  it("HERO·FEATURE_HIGHLIGHT는 캡션을 미리 채우지 않는다 — FEATURE_HIGHLIGHT는 profile.features와 짝짓는 것이 목적", () => {
    const results = attachStudioImageCaptions(
      [pageImage("HERO", "h1"), pageImage("FEATURE_HIGHLIGHT", "f1")],
      profile,
      null,
    );
    expect(results[0].caption).toBeUndefined();
    expect(results[1].caption).toBeUndefined();
  });

  it("category가 없는 이미지(원본 업로드 등)는 그대로 둔다", () => {
    const results = attachStudioImageCaptions([pageImage(null, "x1")], profile, null);
    expect(results[0].caption).toBeUndefined();
  });
});

describe("selectRepresentativeStudioImages", () => {
  function studioImage(
    category: StudioSelectedImage["category"],
    groupVersion: number,
    seed: string,
  ): StudioSelectedImage {
    return {
      imageId: `img-${seed}`,
      category,
      groupVersion,
      mimeType: "image/jpeg",
      base64: `id-${seed}`,
    };
  }

  it("HERO는 최신 1장만 남긴다 — 대표 배경은 한 장이면 충분하다", () => {
    const images = [
      studioImage("HERO", 1, "h1"),
      studioImage("HERO", 3, "h3"),
      studioImage("HERO", 2, "h2"),
    ];
    const result = selectRepresentativeStudioImages(images);
    expect(result).toEqual([studioImage("HERO", 3, "h3")]);
  });

  it("HERO 외 카테고리는 최신 3장까지만 남기고 나머지는 제외한다 (T1-111 — 반복 선택으로 쌓인 사진 정리)", () => {
    const images = Array.from({ length: 11 }, (_, i) =>
      studioImage("USAGE_SCENE", i + 1, `u${i + 1}`),
    );
    const result = selectRepresentativeStudioImages(images);
    expect(result.map((i) => i.imageId)).toEqual(["img-u11", "img-u10", "img-u9"]);
  });

  it("카테고리마다 독립적으로 상한을 적용한다", () => {
    const images = [
      ...Array.from({ length: 5 }, (_, i) => studioImage("DETAIL", i + 1, `d${i + 1}`)),
      ...Array.from({ length: 5 }, (_, i) => studioImage("COMPONENTS", i + 1, `c${i + 1}`)),
    ];
    const result = selectRepresentativeStudioImages(images);
    const byCategory = (category: StudioSelectedImage["category"]) =>
      result.filter((i) => i.category === category).length;
    expect(byCategory("DETAIL")).toBe(3);
    expect(byCategory("COMPONENTS")).toBe(3);
  });

  it("상한 이하로 선택돼 있으면 전부 남긴다", () => {
    const images = [studioImage("COMPONENTS", 1, "c1")];
    expect(selectRepresentativeStudioImages(images)).toEqual(images);
  });

  it("빈 배열이면 빈 배열을 돌려준다", () => {
    expect(selectRepresentativeStudioImages([])).toEqual([]);
  });

  it("maxPerCategory로 기본 상한을 덮어쓸 수 있다", () => {
    const images = Array.from({ length: 5 }, (_, i) => studioImage("DETAIL", i + 1, `d${i + 1}`));
    const result = selectRepresentativeStudioImages(images, { DETAIL: 1 });
    expect(result.map((i) => i.imageId)).toEqual(["img-d5"]);
  });
});
