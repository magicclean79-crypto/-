import type { ProductProfile } from "@acos/shared";
import { IMAGE_CATEGORY_LABELS } from "@acos/shared";
import type { ProductPageImage, ProductPageViewModel } from "./product-page-html";

/**
 * 최종 상세페이지 렌더링 결과가 실제 제품 정보·이미지와 맞는지 검증한다.
 * (T1-77 요구사항 11 "최종 렌더링에서 실제 제품 정보와 이미지가 서로
 * 맞는지 검증") LLM 호출 없음 — 순수 함수. AI가 만든 것을 AI가 "품질
 * 좋다"고 판단하는 것이 아니라, 이미 정해진 규칙(허구 인증/순위 문구
 * 금지·이미지 출처 확인)을 기계적으로 검사할 뿐이다(MASTER_GUIDE §2
 * 철학3 — 품질 판단 자체는 여전히 사람의 몫).
 */

export interface ProductPageValidationIssue {
  code:
    | "unverified-claim"
    | "foreign-image"
    | "empty-spec-row"
    | "generic-phrase"
    | "unlinked-image"
    | "image-run-too-long"
    | "category-label-leak"
    | "duplicate-caption"
    | "duplicate-image-usage";
  message: string;
}

export interface ProductPageValidationResult {
  ok: boolean;
  issues: ProductPageValidationIssue[];
}

/**
 * Product Profile 어디에도 없는데 상세페이지 문구에만 등장하면 "지어낸
 * 값"일 가능성이 큰 패턴들 — 인증·순위·최상급 표현(MASTER_GUIDE §2
 * 철학2, T1-77 요구사항4 "확인되지 않은 효능/성능/수치/인증/순위 등을
 * 임의 생성 금지"). 값 자체를 금지하는 것이 아니라 **Product Profile에
 * 그 근거(같은 단어)가 없는데 카피에만 나타나면** 의심 신호로 본다 —
 * 근거가 있으면(OCR·GPT가 실제로 읽은 값) 통과시킨다.
 */
const UNVERIFIED_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /1위/g, label: "순위 주장(1위)" },
  { pattern: /공식\s?인증/g, label: "인증 주장" },
  { pattern: /특허/g, label: "특허 주장" },
  { pattern: /최고급|업계\s?최고|국내\s?유일/g, label: "최상급 주장" },
  { pattern: /임상\s?시험|의학적으로\s?입증/g, label: "효능 입증 주장" },
];

function profileTextCorpus(profile: ProductProfile): string {
  return [
    profile.productName,
    profile.brand ?? "",
    profile.model ?? "",
    profile.material ?? "",
    ...profile.features,
    profile.usage ?? "",
    ...profile.advantages,
    ...profile.warnings,
    ...profile.keywords,
    ...Object.entries(profile.specifications).flat(),
  ].join(" ");
}

/**
 * 카피(headline·description·구매포인트)에 Product Profile에는 없는
 * 인증/순위/최상급 표현이 등장하는지 검사한다.
 */
function findUnverifiedClaims(
  vm: ProductPageViewModel,
  profile: ProductProfile,
): ProductPageValidationIssue[] {
  const profileText = profileTextCorpus(profile);
  const copyText = [vm.headline, vm.description, ...vm.purchasePoints, ...vm.features.map((f) => f.text)].join(
    " ",
  );
  const issues: ProductPageValidationIssue[] = [];
  for (const { pattern, label } of UNVERIFIED_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    const hitsInCopy = pattern.test(copyText);
    pattern.lastIndex = 0;
    const hitsInProfile = pattern.test(profileText);
    if (hitsInCopy && !hitsInProfile) {
      issues.push({
        code: "unverified-claim",
        message: `상세페이지 카피에 "${label}" 표현이 있지만 Product Profile에는 근거가 없습니다 — 확인되지 않은 값일 수 있습니다.`,
      });
    }
  }
  return issues;
}

/** 렌더링에 쓰인 이미지가 전부 원래 승인된 이미지 목록(`approvedImages`) 안에서만 왔는지 확인한다 */
function findForeignImages(
  vm: ProductPageViewModel,
  approvedImages: ProductPageImage[],
): ProductPageValidationIssue[] {
  const approved = new Set(approvedImages.map((image) => image.base64));
  const used: ProductPageImage[] = [
    ...(vm.heroImage ? [vm.heroImage] : []),
    ...vm.galleryImages,
    ...vm.features.flatMap((f) => (f.image ? [f.image] : [])),
  ];
  const issues: ProductPageValidationIssue[] = [];
  for (const image of used) {
    if (!approved.has(image.base64)) {
      issues.push({
        code: "foreign-image",
        message: "렌더링에 승인된 이미지 목록에 없는 이미지가 사용되었습니다.",
      });
      break; // 하나만 걸려도 구조적 결함이므로 반복 보고하지 않는다
    }
  }
  return issues;
}

/**
 * 제품과 무관하게 어떤 상품에도 붙일 수 있는 범용 마케팅 상투어(T1-93
 * 요구사항 — "'최고의 제품입니다'·'편리하게 사용할 수 있습니다' 같은 의미
 * 없는 범용 문구를 금지"). Product Profile 근거 유무와 무관하게 그 자체로
 * 정보가 없는 문구라 판단해 리스트로 직접 막는다(unverified-claim처럼
 * "근거가 있으면 통과"가 아니다 — 이 문구들은 근거가 있어도 의미가 없다).
 */
const GENERIC_FILLER_PHRASES = [
  "최고의 제품",
  "편리하게 사용할 수 있습니다",
  "편리하게 사용하세요",
  "고품질의 제품",
  "누구나 만족",
  "합리적인 가격으로",
  "다양한 곳에서 활용",
  "특별한 만족감",
  "탁월한 성능",
  "완벽한 선택",
  "실용적이고 편리한",
];

function findGenericPhrases(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const copyText = [vm.headline, vm.description, ...vm.features.map((f) => f.text)].join(" ");
  const issues: ProductPageValidationIssue[] = [];
  for (const phrase of GENERIC_FILLER_PHRASES) {
    if (copyText.includes(phrase)) {
      issues.push({
        code: "generic-phrase",
        message: `상세페이지 카피에 제품과 무관하게 쓸 수 있는 범용 문구("${phrase}")가 있습니다 — 확인된 특징을 근거로 구체적으로 다시 써야 합니다.`,
      });
    }
  }
  return issues;
}

/**
 * 사진은 있는데 그 옆에 아무 설명도 없는 카드가 있는지 검사한다(T1-93 —
 * "이미지-콘텐츠 매핑 존재 여부"). `buildProductPageViewModel`이 이미
 * 캡션 없는 사진을 갤러리로 분리하므로 정상 경로에서는 거의 나타나지
 * 않는다 — 오래된 데이터나 호출자가 직접 ViewModel을 만든 경우에 대한
 * 안전망이다.
 */
function findUnlinkedImages(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const hasUnlinked = vm.features.some((item) => item.image && item.text.trim().length === 0);
  return hasUnlinked
    ? [
        {
          code: "unlinked-image",
          message: "사진은 있지만 옆에 아무 설명도 없는 카드가 있습니다 — 이미지와 무관하게 사진만 나열된 것일 수 있습니다.",
        },
      ]
    : [];
}

/** 캡션 없는(빈 문자열) 카드가 몇 장 연속으로 이어지는지의 최댓값을 구한다 */
function longestEmptyCaptionRun(vm: ProductPageViewModel): number {
  let longest = 0;
  let current = 0;
  for (const item of vm.features) {
    if (item.image && item.text.trim().length === 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** 설명 없는 사진이 연속으로 너무 많이 이어지면(T1-93 — "연속 이미지 과다 배치")
 * "사진만 길게 나열"된 것으로 본다. 임계값 3장 — 2장까지는 흔한 비교컷일 수
 * 있으나 그 이상은 서사 없이 사진만 쌓인 것으로 판단한다. */
const MAX_CONSECUTIVE_UNCAPTIONED_IMAGES = 2;

function findImageRunTooLong(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const longest = longestEmptyCaptionRun(vm);
  return longest > MAX_CONSECUTIVE_UNCAPTIONED_IMAGES
    ? [
        {
          code: "image-run-too-long",
          message: `설명 없는 사진이 ${longest}장 연속으로 이어집니다 — 사진만 길게 나열된 구간일 수 있습니다.`,
        },
      ]
    : [];
}

/**
 * 내부 Image Studio 카테고리 라벨("사용 장면 이미지"·"제품 디테일 이미지"
 * 등)이 고객용 카피에 그대로 노출됐는지 검사한다(T1-111 요구사항 — "실제
 * 사용된 필드에 category 값이 그대로 노출되지 않아야 한다"). 이 라벨은
 * Image Studio 편집 화면에서만 쓰기로 정해진 내부 이름표라, 최종
 * 상세페이지 카피에 그대로 나오면 placeholder 문구가 노출된 것이다.
 */
const CATEGORY_LABEL_VALUES = new Set(Object.values(IMAGE_CATEGORY_LABELS));

function findCategoryLabelLeaks(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const texts = [vm.headline, vm.description, ...vm.features.map((f) => f.text)];
  const issues: ProductPageValidationIssue[] = [];
  for (const text of texts) {
    if (CATEGORY_LABEL_VALUES.has(text.trim())) {
      issues.push({
        code: "category-label-leak",
        message: `상세페이지 카피에 내부 카테고리 라벨("${text.trim()}")이 고객용 문구로 그대로 노출되었습니다.`,
      });
    }
  }
  return issues;
}

/**
 * "특징" 카드 문구가 그대로 반복되는지 검사한다(T1-111 — "동일 섹션
 * 제목의 불필요한 반복 0개"). 사진마다 캡션이 서로 다른 값을 갖고 있어야
 * 하는데, 근거 없이 같은 문구를 여러 사진에 복제하면(예전의 카테고리
 * 라벨 반복 사용이 정확히 이런 형태였다) 여기서 잡힌다.
 */
function findDuplicateCaptions(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const counts = new Map<string, number>();
  for (const item of vm.features) {
    const text = item.text.trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const issues: ProductPageValidationIssue[] = [];
  for (const [text, count] of counts) {
    if (count > 1) {
      issues.push({
        code: "duplicate-caption",
        message: `"${text}" 문구가 특징 카드 ${count}곳에서 그대로 반복됩니다 — 서로 다른 사진에 같은 설명을 복제한 것일 수 있습니다.`,
      });
    }
  }
  return issues;
}

/**
 * 같은 사진(byte 동일)이 Hero·특징 카드·갤러리 여러 자리에 중복 배치됐는지
 * 검사한다(T1-111 요구사항 3·11 — "동일 이미지의 중복 배치 제한").
 * `buildProductPageViewModel`이 이미 같은 사진을 두 번 쓰지 않도록
 * 짝짓지만(T1-93), 호출자가 직접 ViewModel을 만드는 경로에 대한
 * 안전망이다.
 */
function findDuplicateImageUsage(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const used: ProductPageImage[] = [
    ...(vm.heroImage ? [vm.heroImage] : []),
    ...vm.galleryImages,
    ...vm.features.flatMap((f) => (f.image ? [f.image] : [])),
  ];
  const seen = new Set<string>();
  const issues: ProductPageValidationIssue[] = [];
  for (const image of used) {
    if (seen.has(image.base64)) {
      issues.push({
        code: "duplicate-image-usage",
        message: "같은 사진이 상세페이지의 서로 다른 자리에 중복 배치되었습니다.",
      });
      break; // 하나만 걸려도 구조적 결함이므로 반복 보고하지 않는다
    }
    seen.add(image.base64);
  }
  return issues;
}

function findEmptySpecRows(vm: ProductPageViewModel): ProductPageValidationIssue[] {
  const issues: ProductPageValidationIssue[] = [];
  for (const [key, value] of vm.specRows) {
    if (key.trim().length === 0 || value.trim().length === 0) {
      issues.push({
        code: "empty-spec-row",
        message: `스펙 행 "${key}"의 키 또는 값이 비어 있습니다.`,
      });
    }
  }
  return issues;
}

/**
 * `buildProductPageViewModel`이 만든 ViewModel과 원본 Product Profile·
 * 승인된 이미지 목록을 대조해 결함을 찾는다. `ok: false`는 "이 결과를
 * 사람에게 보여주면 안 된다"는 뜻이 아니라 — 사람이 브라우저에서 확인할
 * 때 무엇을 특히 의심해야 하는지 표시하는 것이다(사실과 평가를 구분,
 * MASTER_GUIDE §2 철학4). 최종 품질 승인은 여전히 사람이 한다.
 */
export function validateProductPageViewModel(
  vm: ProductPageViewModel,
  profile: ProductProfile,
  approvedImages: ProductPageImage[],
): ProductPageValidationResult {
  const issues = [
    ...findUnverifiedClaims(vm, profile),
    ...findForeignImages(vm, approvedImages),
    ...findEmptySpecRows(vm),
    ...findGenericPhrases(vm),
    ...findUnlinkedImages(vm),
    ...findImageRunTooLong(vm),
    ...findCategoryLabelLeaks(vm),
    ...findDuplicateCaptions(vm),
    ...findDuplicateImageUsage(vm),
  ];
  return { ok: issues.length === 0, issues };
}
