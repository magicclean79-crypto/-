import type { ProductProfile } from "@acos/shared";
import { buildProductPageViewModel, type ProductPageImage } from "./product-page-html";
import { validateProductPageViewModel } from "./product-page-render-validation";

const profile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: "SJ-100",
  material: "ABS, PVC, 스테인리스",
  features: ["분사기 손잡이"],
  specifications: { 길이: "3M" },
  usage: "베란다에서 물을 뿌려 청소할 때 사용",
  advantages: ["3M 길이로 넓은 범위 청소 가능"],
  warnings: [],
  keywords: ["호스"],
  confidence: 0.9,
};

const copy = {
  headline: "베란다 청소를 한 번에",
  description: "3M 길이 호스로 베란다 구석구석을 청소할 수 있습니다.",
};

const photo = (seed: string): ProductPageImage => ({
  mimeType: "image/jpeg",
  base64: Buffer.from(`fake-${seed}`).toString("base64"),
});

describe("validateProductPageViewModel", () => {
  it("정상적인 결과는 이슈 없이 통과한다", () => {
    const images = [photo("1"), photo("2")];
    const vm = buildProductPageViewModel(profile, [], copy, images);
    const result = validateProductPageViewModel(vm, profile, images);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("Product Profile에 근거 없는 '1위'·'특허' 같은 표현이 카피에 있으면 unverified-claim을 낸다", () => {
    const inflatedCopy = {
      headline: "업계 1위 특허 받은 베란다 호스",
      description: copy.description,
    };
    const vm = buildProductPageViewModel(profile, [], inflatedCopy, []);
    const result = validateProductPageViewModel(vm, profile, []);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unverified-claim")).toBe(true);
  });

  it("Product Profile 자체에 근거 단어가 있으면 같은 표현이 카피에 있어도 통과시킨다", () => {
    const certifiedProfile: ProductProfile = {
      ...profile,
      specifications: { ...profile.specifications, 인증: "공식 인증 KC마크" },
    };
    const certifiedCopy = { headline: "공식 인증 받은 제품", description: copy.description };
    const vm = buildProductPageViewModel(certifiedProfile, [], certifiedCopy, []);
    const result = validateProductPageViewModel(vm, certifiedProfile, []);
    expect(result.issues.some((i) => i.code === "unverified-claim")).toBe(false);
  });

  it("승인된 이미지 목록에 없는 이미지가 쓰이면 foreign-image를 낸다", () => {
    const approvedImages = [photo("approved")];
    const vm = buildProductPageViewModel(profile, [], copy, [photo("not-approved")]);
    const result = validateProductPageViewModel(vm, profile, approvedImages);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "foreign-image")).toBe(true);
  });

  it("빈 스펙 값이 있으면 empty-spec-row를 낸다", () => {
    const brokenProfile: ProductProfile = {
      ...profile,
      specifications: { 길이: "" },
    };
    const vm = buildProductPageViewModel(brokenProfile, [], copy, []);
    const result = validateProductPageViewModel(vm, brokenProfile, []);
    expect(result.issues.some((i) => i.code === "empty-spec-row")).toBe(true);
  });

  it("'최고의 제품입니다'처럼 제품과 무관한 범용 문구가 있으면 generic-phrase를 낸다 (T1-93)", () => {
    const genericCopy = {
      headline: "최고의 제품 베란다 호스",
      description: "편리하게 사용할 수 있습니다.",
    };
    const vm = buildProductPageViewModel(profile, [], genericCopy, []);
    const result = validateProductPageViewModel(vm, profile, []);
    expect(result.ok).toBe(false);
    expect(result.issues.filter((i) => i.code === "generic-phrase").length).toBeGreaterThanOrEqual(2);
  });

  it("구체적인 근거 문구는 generic-phrase를 내지 않는다", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    const result = validateProductPageViewModel(vm, profile, []);
    expect(result.issues.some((i) => i.code === "generic-phrase")).toBe(false);
  });

  it("사진은 있는데 캡션이 빈 카드가 있으면 unlinked-image를 낸다 (T1-93)", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    vm.features.push({ text: "", image: photo("unlinked") });
    const result = validateProductPageViewModel(vm, profile, [photo("unlinked")]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unlinked-image")).toBe(true);
  });

  it("설명 없는 사진이 3장 넘게 연속되면 image-run-too-long을 낸다 (T1-93)", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    vm.features.push(
      { text: "", image: photo("a") },
      { text: "", image: photo("b") },
      { text: "", image: photo("c") },
    );
    const approved = [photo("a"), photo("b"), photo("c")];
    const result = validateProductPageViewModel(vm, profile, approved);
    expect(result.issues.some((i) => i.code === "image-run-too-long")).toBe(true);
  });

  it("내부 카테고리 라벨('사용 장면 이미지' 등)이 카피에 그대로 있으면 category-label-leak을 낸다 (T1-111)", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    vm.features.push({ text: "사용 장면 이미지", image: photo("leak") });
    const result = validateProductPageViewModel(vm, profile, [photo("leak")]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "category-label-leak")).toBe(true);
  });

  it("같은 특징 문구가 두 카드 이상에서 반복되면 duplicate-caption을 낸다 (T1-111)", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    vm.features.push(
      { text: "구성품 이미지", image: photo("d1") },
      { text: "구성품 이미지", image: photo("d2") },
    );
    const result = validateProductPageViewModel(vm, profile, [photo("d1"), photo("d2")]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "duplicate-caption")).toBe(true);
  });

  it("같은 사진이 두 자리에 중복 배치되면 duplicate-image-usage를 낸다 (T1-111)", () => {
    const vm = buildProductPageViewModel(profile, [], copy, []);
    const repeated = photo("repeated");
    vm.heroImage = repeated;
    vm.galleryImages.push(repeated);
    const result = validateProductPageViewModel(vm, profile, [repeated]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "duplicate-image-usage")).toBe(true);
  });
});
