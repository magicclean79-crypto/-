import { IMAGE_CATEGORY_LABELS, type ProductProfile } from "@acos/shared";
import type { AssignedStorySection, ProductStory } from "./product-story";
import { hasMonotonousLayoutRun, hasNoVisualVariation, type StoryDesignPlan } from "./product-story-design";

/**
 * Product Story 품질 검증. (T1-94, 2026-08-12 / T1-112, 디자인 품질 검사 추가)
 *
 * LLM 호출 없음 — 순수 함수. `product-page-render-validation.ts`(T1-77)와
 * 같은 원칙: AI가 만든 것을 AI가 "품질 좋다"고 판단하지 않는다. 이미 정해진
 * 규칙(요청 사양)을 기계적으로 검사할 뿐이고, 최종 판단은 사람이 한다
 * (MASTER_GUIDE §2 철학 3). 이 파일이 하는 일은 "무엇을 의심해야 하는지"를
 * 표시하는 것이다 — `ok: false`가 "이 결과를 버려라"는 뜻이 아니라 "사람이
 * 특히 이 지점을 봐야 한다"는 뜻이다. 다만 요청 사양이 "실패하면 성공
 * 결과로 표시하지 말라"고 명시했으므로, `severity: "block"` 이슈가 하나라도
 * 있으면 `ok`는 false다 — 호출자(apps/api)가 이 값으로 재생성이 필요한
 * 상태임을 사람에게 보여준다(자동으로 결과를 감추거나 폐기하지는 않는다).
 *
 * ## T1-112 — 디자인 품질 검사
 *
 * 요청 사양은 "아이콘 개수 >= N 같은 형식적 기준만으로 통과시키지 말고
 * Design Plan과 final HTML의 일치도도 검사"하라고 명시했다. 그래서
 * `findDesignHtmlMismatch`는 개수를 세지 않고, **Design Plan이 이
 * 섹션에 배정한 아이콘·강조색이 실제 렌더링된 HTML에 그대로 나타나는지**
 * (`data-icon`·`--pde-story-accent`) 하나하나 대조한다 — 렌더러가 Design
 * Plan의 결정을 조용히 무시해도(예: 리팩터링 실수로 `design` 인자를 안
 * 넘기는 경우) 이 검사가 그 자리에서 잡는다. `findMonotonousVisualDesign`
 * 은 반대로 "레이아웃 이름만 다양하고 실제 색·아이콘은 전부 같다"는
 * 상태(단일 색·단일 아이콘)를 잡는다.
 */

export type ProductStoryIssueSeverity = "block" | "warn";

export interface ProductStoryValidationIssue {
  code:
    | "no-transition"
    | "ungrounded-fact"
    | "unverified-claim"
    | "generic-copy"
    | "duplicate-image"
    | "duplicate-section-purpose"
    | "photo-dump-sequence"
    | "image-role-without-image"
    | "image-without-facts-shown"
    | "user-requirement-not-reflected"
    | "design-html-mismatch"
    | "monotonous-visual-design"
    | "category-label-leak";
  severity: ProductStoryIssueSeverity;
  sectionId?: string;
  message: string;
}

export interface ProductStoryValidationResult {
  ok: boolean;
  issues: ProductStoryValidationIssue[];
}

/** 빈 광고 수식어·상투구 — 요청 사양이 명시적으로 금지한 표현들 + 흔한 변형 */
const GENERIC_COPY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /최고의\s?제품/g, label: "'최고의 제품'류 빈 수식어" },
  { pattern: /편리하게\s?사용(할\s?수\s?있습니다|하세요)/g, label: "'편리하게 사용할 수 있습니다'류 빈 문구" },
  { pattern: /업계\s?최고|국내\s?유일|최고급/g, label: "최상급 상투구" },
  { pattern: /완벽한\s?(선택|퀄리티|품질)/g, label: "'완벽한 선택'류 빈 수식어" },
  { pattern: /강력\s?추천/g, label: "'강력 추천'류 빈 수식어" },
  { pattern: /합리적인\s?가격/g, label: "가격 관련 빈 수식어(가격은 이 엔진의 범위 밖)" },
];

/** Product Profile에 근거가 없으면 의심해야 하는 주장 — product-page-render-validation.ts와 같은 패턴 */
const UNVERIFIED_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /1위/g, label: "순위 주장(1위)" },
  { pattern: /공식\s?인증/g, label: "인증 주장" },
  { pattern: /특허/g, label: "특허 주장" },
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

// ":"·";"도 제거한다 — "원산지: 한국"처럼 "키: 값" 형태로 적은 근거 문구가
// specifications의 "원산지"/"한국"(구두점 없는 원문)과 비교될 때 구두점
// 하나 때문에 "근거 없음"으로 오탐되는 것을 막는다(T1-94 실측 발견:
// 실제 Benchmark 실행에서 Product Profile에 있는 "원산지: 한국"이 이
// 문자 때문에 ungrounded-fact로 잘못 걸렸다).
function normalize(text: string): string {
  return text.replace(/[\s()（）,·.:;!?~-]/g, "").toLowerCase();
}

/** 한 문장이 corpus 안에 (정규화 후) 부분 문자열로 등장하는지 — 완전 일치가 아니라 관대한 포함 검사 */
function isGroundedIn(claim: string, corpusNormalized: string): boolean {
  const normalizedClaim = normalize(claim);
  if (normalizedClaim.length === 0) return true;
  if (corpusNormalized.includes(normalizedClaim)) return true;
  // 문장 전체 일치는 너무 엄격하다 — 핵심 단어(2글자 이상) 중 과반이 corpus에 있으면 근거로 인정한다
  const words = claim.split(/[\s,·]+/).map(normalize).filter((w) => w.length >= 2);
  if (words.length === 0) return true;
  const matched = words.filter((w) => corpusNormalized.includes(w)).length;
  return matched / words.length >= 0.6;
}

function findDuplicateImages(assigned: AssignedStorySection[]): ProductStoryValidationIssue[] {
  const seen = new Map<string, string>(); // imageId -> first sectionId
  const issues: ProductStoryValidationIssue[] = [];
  for (const { section, image } of assigned) {
    if (!image) continue;
    const firstSectionId = seen.get(image.imageId);
    if (firstSectionId) {
      issues.push({
        code: "duplicate-image",
        severity: "warn",
        sectionId: section.sectionId,
        message: `이미지가 "${firstSectionId}" 섹션과 "${section.sectionId}" 섹션에 중복 사용되었습니다 — 동일 이미지 반복은 최소화해야 합니다.`,
      });
    } else {
      seen.set(image.imageId, section.sectionId);
    }
  }
  return issues;
}

function findDuplicateSectionPurpose(story: ProductStory): ProductStoryValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ProductStoryValidationIssue[] = [];
  for (const section of story.sections) {
    const key = normalize(section.purpose);
    const firstSectionId = seen.get(key);
    if (firstSectionId) {
      issues.push({
        code: "duplicate-section-purpose",
        severity: "warn",
        sectionId: section.sectionId,
        message: `"${firstSectionId}" 섹션과 목적(purpose)이 사실상 같습니다 — 섹션이 불필요하게 중복될 수 있습니다.`,
      });
    } else {
      seen.set(key, section.sectionId);
    }
  }
  return issues;
}

/** 이미지는 있는데 카피가 사실상 없는("사진만" 배치) 섹션이 연속되는지 확인한다 */
function findPhotoDumpSequences(assigned: AssignedStorySection[]): ProductStoryValidationIssue[] {
  const issues: ProductStoryValidationIssue[] = [];
  let consecutive = 0;
  for (const { section, image } of assigned) {
    const isImageOnly = Boolean(image) && section.copy.trim().length < 8;
    if (isImageOnly) {
      consecutive += 1;
      if (consecutive >= 2) {
        issues.push({
          code: "photo-dump-sequence",
          severity: "block",
          sectionId: section.sectionId,
          message: `"${section.sectionId}" 섹션을 포함해 사진만 있고 설명이 사실상 없는 섹션이 연속됩니다 — 사진 연속 나열 구조는 금지됩니다.`,
        });
      }
    } else {
      consecutive = 0;
    }
  }
  return issues;
}

function findGenericCopy(story: ProductStory): ProductStoryValidationIssue[] {
  const issues: ProductStoryValidationIssue[] = [];
  for (const section of story.sections) {
    const text = `${section.copy} ${section.keyMessage}`;
    for (const { pattern, label } of GENERIC_COPY_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        issues.push({
          code: "generic-copy",
          severity: "block",
          sectionId: section.sectionId,
          message: `"${section.sectionId}" 섹션 카피에 ${label} 표현이 있습니다 — 구체적인 제품 사실로 바꿔야 합니다.`,
        });
      }
    }
  }
  return issues;
}

function findUnverifiedClaims(story: ProductStory, profile: ProductProfile): ProductStoryValidationIssue[] {
  const profileCorpus = profileTextCorpus(profile);
  const issues: ProductStoryValidationIssue[] = [];
  for (const section of story.sections) {
    for (const { pattern, label } of UNVERIFIED_CLAIM_PATTERNS) {
      pattern.lastIndex = 0;
      const hitsInCopy = pattern.test(section.copy);
      pattern.lastIndex = 0;
      const hitsInProfile = pattern.test(profileCorpus);
      if (hitsInCopy && !hitsInProfile) {
        issues.push({
          code: "unverified-claim",
          severity: "block",
          sectionId: section.sectionId,
          message: `"${section.sectionId}" 섹션 카피에 "${label}" 표현이 있지만 Product Profile에는 근거가 없습니다.`,
        });
      }
    }
  }
  return issues;
}

/** 각 섹션의 productFacts가 실제 Product Profile 안에서 확인되는지 검사한다 */
function findUngroundedFacts(story: ProductStory, profile: ProductProfile): ProductStoryValidationIssue[] {
  const corpus = normalize(profileTextCorpus(profile));
  const issues: ProductStoryValidationIssue[] = [];
  for (const section of story.sections) {
    for (const fact of section.productFacts) {
      if (!isGroundedIn(fact, corpus)) {
        issues.push({
          code: "ungrounded-fact",
          severity: "block",
          sectionId: section.sectionId,
          message: `"${section.sectionId}" 섹션이 근거로 든 "${fact}"가 Product Profile에서 확인되지 않습니다 — 지어낸 사실일 수 있습니다.`,
        });
      }
    }
  }
  return issues;
}

function findMissingTransitions(story: ProductStory): ProductStoryValidationIssue[] {
  const issues: ProductStoryValidationIssue[] = [];
  story.sections.forEach((section, index) => {
    const isLast = index === story.sections.length - 1;
    if (!isLast && section.transitionToNext.trim().length === 0) {
      issues.push({
        code: "no-transition",
        severity: "warn",
        sectionId: section.sectionId,
        message: `"${section.sectionId}" 섹션에 다음 섹션으로 이어지는 논리(transitionToNext)가 비어 있습니다 — 스토리 흐름이 끊길 수 있습니다.`,
      });
    }
  });
  return issues;
}

function findImageAlignmentIssues(assigned: AssignedStorySection[]): ProductStoryValidationIssue[] {
  const issues: ProductStoryValidationIssue[] = [];
  for (const { section, image } of assigned) {
    if (section.imageRole !== "NONE" && !image) {
      issues.push({
        code: "image-role-without-image",
        severity: "warn",
        sectionId: section.sectionId,
        message: `"${section.sectionId}" 섹션이 "${section.imageRole}" 이미지를 요구했지만 실제로 배정된 이미지가 없습니다 — 해당 카테고리에 선택된 사진이 부족할 수 있습니다.`,
      });
    }
    if (image && section.imageFactsShown.length === 0) {
      issues.push({
        code: "image-without-facts-shown",
        severity: "warn",
        sectionId: section.sectionId,
        message: `"${section.sectionId}" 섹션에 이미지가 배정됐지만 그 이미지가 보여주는 사실(imageFactsShown)이 비어 있습니다.`,
      });
    }
  }
  return issues;
}

/**
 * 사용자 요구사항 반영 여부 — 정확한 검증은 불가능하다(자연어 의도 반영을
 * 기계적으로 판정할 수 없다). 요청 사양에는 "반영 여부를 자동 검사"하라고
 * 명시되어 있어, **최소한의 키워드 겹침**이라도 있는지 보는 약한 신호로
 * 둔다 — 겹침이 전혀 없으면 "반영되지 않았을 수 있다"는 경고만 남기고,
 * `ok`를 막는 수준(`block`)으로는 쓰지 않는다(오탐이 많을 수 있는 휴리스틱).
 */
function findUserRequirementReflection(
  story: ProductStory,
  userRequirement: string | null | undefined,
): ProductStoryValidationIssue[] {
  const requirement = userRequirement?.trim();
  if (!requirement) return [];
  const requirementWords = requirement
    .split(/[\s,.!?~·()（）-]+/)
    .map(normalize)
    .filter((w) => w.length >= 2);
  if (requirementWords.length === 0) return [];
  const storyCorpus = normalize(
    [story.narrativeSummary, ...story.sections.flatMap((s) => [s.keyMessage, s.copy])].join(" "),
  );
  const matched = requirementWords.some((word) => storyCorpus.includes(word));
  if (matched) return [];
  return [
    {
      code: "user-requirement-not-reflected",
      severity: "warn",
      message:
        "사용자 요구사항의 단어가 Story 어느 섹션에도 나타나지 않습니다 — 요구사항이 반영되지 않았을 수 있습니다(휴리스틱 신호, 확정 판정 아님).",
    },
  ];
}

/**
 * Design Plan이 이 섹션에 배정한 아이콘·강조색이 실제 렌더링된 HTML에
 * 그대로 반영됐는지 대조한다(T1-112). `renderProductStoryHtml`이
 * `data-icon="<icon>"`과 `--pde-story-accent:<color>`를 섹션 wrapper에
 * 심어 둔 것을 전제로 문자열 검사한다 — HTML을 파싱하지 않는 가벼운
 * 방식이지만, 렌더러 계약(이 두 속성)이 이 파일과 `product-story-html.ts`
 * 양쪽에 문서화돼 있어 계약이 깨지면 이 검사도 함께 깨져 드러난다.
 */
function findDesignHtmlMismatch(
  html: string | undefined,
  designPlan: StoryDesignPlan | undefined,
): ProductStoryValidationIssue[] {
  if (!html || !designPlan) return [];
  const issues: ProductStoryValidationIssue[] = [];
  for (const spec of designPlan.sections) {
    const sectionMarker = `data-section-id="${spec.sectionId}"`;
    const sectionStart = html.indexOf(sectionMarker);
    if (sectionStart === -1) continue; // 이 섹션 자체가 렌더링되지 않았다면 다른 검사(findImageAlignmentIssues류)가 다룰 문제
    const sectionEnd = html.indexOf("</section>", sectionStart);
    const sectionHtml = html.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);

    if (spec.icon !== "none" && !sectionHtml.includes(`data-icon="${spec.icon}"`)) {
      issues.push({
        code: "design-html-mismatch",
        severity: "block",
        sectionId: spec.sectionId,
        message: `Design Plan이 "${spec.sectionId}" 섹션에 아이콘 "${spec.icon}"을 배정했지만 실제 HTML에서 확인되지 않습니다 — 렌더러가 Design Plan을 무시했을 수 있습니다.`,
      });
    }
    if (!sectionHtml.includes(`--pde-story-accent:${spec.accentColor}`)) {
      issues.push({
        code: "design-html-mismatch",
        severity: "block",
        sectionId: spec.sectionId,
        message: `Design Plan이 "${spec.sectionId}" 섹션에 강조색 "${spec.accentColor}"을 배정했지만 실제 HTML에서 확인되지 않습니다.`,
      });
    }
  }
  return issues;
}

/**
 * 내부 Image Studio 카테고리 라벨("사용 장면 이미지"·"제품 디테일 이미지"·
 * "구성품 이미지"·"이미지 갤러리" 등)이 고객용 Story 카피에 그대로
 * 노출됐는지 검사한다(T1-116 요구사항 5 — "최종 HTML에 내부
 * category/placeholder를 반복 노출하지 않는다"). 이 검사는
 * `product-page-render-validation.ts`의 `findCategoryLabelLeaks`와 같은
 * 원칙이지만 그 파일은 기존 Template 경로(`ProductPageViewModel`)만
 * 다뤄서 Story 경로에는 동등한 가드가 없었다 — LLM이 `imageRole`
 * 카테고리 이름을 그대로 `copy`/`keyMessage`에 베껴 쓰면 아무 검사도
 * 잡지 못했다.
 */
const CATEGORY_LABEL_VALUES = new Set(Object.values(IMAGE_CATEGORY_LABELS));

function findCategoryLabelLeaks(story: ProductStory): ProductStoryValidationIssue[] {
  const issues: ProductStoryValidationIssue[] = [];
  const globalFields: Array<[string, string]> = [
    ["productName", story.productName],
    ["narrativeSummary", story.narrativeSummary],
  ];
  for (const [field, text] of globalFields) {
    const trimmed = text.trim();
    if (CATEGORY_LABEL_VALUES.has(trimmed)) {
      issues.push({
        code: "category-label-leak",
        severity: "block",
        message: `Story의 "${field}"에 내부 카테고리 라벨("${trimmed}")이 고객용 문구로 그대로 노출되었습니다.`,
      });
    }
  }
  for (const section of story.sections) {
    const fields: Array<[string, string]> = [
      ["copy", section.copy],
      ["keyMessage", section.keyMessage],
    ];
    for (const [field, text] of fields) {
      const trimmed = text.trim();
      const isExactLeak = CATEGORY_LABEL_VALUES.has(trimmed);
      const isEmbeddedLeak =
        !isExactLeak && [...CATEGORY_LABEL_VALUES].some((label) => trimmed.includes(label));
      if (isExactLeak || isEmbeddedLeak) {
        issues.push({
          code: "category-label-leak",
          severity: "block",
          sectionId: section.sectionId,
          message: `"${section.sectionId}" 섹션의 "${field}"에 내부 카테고리 라벨이 고객용 문구로 그대로 노출되었습니다: "${trimmed}"`,
        });
      }
    }
  }
  return issues;
}

/** 섹션이 2개 이상인데 색·아이콘이 전부 같아 시각적으로 구분되지 않는지 — hasNoVisualVariation의 결과를 이슈로 변환한다 */
function findMonotonousVisualDesign(designPlan: StoryDesignPlan | undefined): ProductStoryValidationIssue[] {
  if (!designPlan || !hasNoVisualVariation(designPlan)) return [];
  return [
    {
      code: "monotonous-visual-design",
      severity: "warn",
      message:
        "모든 섹션의 강조색·아이콘이 동일합니다 — 레이아웃 이름은 다양해도 실제로는 단일 색/아이콘으로 보일 수 있습니다.",
    },
  ];
}

/**
 * Product Story + 실제 이미지 배정 결과를 검사한다. LLM 호출 없음.
 *
 * `severity: "block"` 이슈가 하나라도 있으면 `ok: false` — 요청 사양
 * "실패하면 성공 결과로 표시하지 않는다"를 반영한다. `warn`만 있으면
 * `ok: true`로 두되 이슈 목록은 그대로 노출한다(사람이 판단).
 *
 * `designPlan`·`html`은 선택 인자다(T1-112) — 넘기지 않으면 디자인
 * 일치도 검사(`design-html-mismatch`·`monotonous-visual-design`)만
 * 건너뛰고 기존 검사는 그대로 동작한다. 기존 호출부(테스트 포함)를
 * 깨지 않기 위한 하위 호환이다.
 */
export function validateProductStory(
  story: ProductStory,
  assigned: AssignedStorySection[],
  profile: ProductProfile,
  userRequirement?: string | null,
  designPlan?: StoryDesignPlan,
  html?: string,
): ProductStoryValidationResult {
  const issues = [
    ...findMissingTransitions(story),
    ...findUngroundedFacts(story, profile),
    ...findUnverifiedClaims(story, profile),
    ...findGenericCopy(story),
    ...findDuplicateImages(assigned),
    ...findDuplicateSectionPurpose(story),
    ...findPhotoDumpSequences(assigned),
    ...findImageAlignmentIssues(assigned),
    ...findUserRequirementReflection(story, userRequirement),
    ...findDesignHtmlMismatch(html, designPlan),
    ...findMonotonousVisualDesign(designPlan),
    ...findCategoryLabelLeaks(story),
  ];
  const ok = !issues.some((issue) => issue.severity === "block");
  return { ok, issues };
}

/**
 * Quality Critic 점수화. (T1-97, 2026-08-12)
 *
 * `validateProductStory`의 `ok`(block 이슈 유무)는 이진 판정이라 "70점은
 * 되는데 80점은 아니다" 같은 요청 사양의 등급을 표현할 수 없었다. 이
 * 함수는 같은 이슈 목록에 가중치를 매겨 0~100 점수와 등급으로 바꾼다 —
 * 새 LLM 호출 없음, 순수 함수, 이미 있는 신호만 재사용한다.
 *
 * 등급 기준(요청 사양): 80점 이상 = 목표 달성(pass), 70~79 = 통과는 하되
 * 개선 여지 있음(warn), 70 미만 = 성공 결과로 표시하지 않음(fail).
 */
export type ProductStoryQualityGrade = "pass" | "warn" | "fail";

export interface ProductStoryQualityScore {
  score: number;
  grade: ProductStoryQualityGrade;
  /** 감점 사유 — 사람이 왜 이 점수인지 바로 알 수 있게 */
  reasons: string[];
}

const BLOCK_ISSUE_PENALTY = 15;
const WARN_ISSUE_PENALTY = 5;
const MONOTONOUS_LAYOUT_PENALTY = 10;

export function scoreProductStory(
  validation: ProductStoryValidationResult,
  designPlan?: StoryDesignPlan,
): ProductStoryQualityScore {
  let score = 100;
  const reasons: string[] = [];

  const blockCount = validation.issues.filter((issue) => issue.severity === "block").length;
  const warnCount = validation.issues.filter((issue) => issue.severity === "warn").length;
  if (blockCount > 0) {
    score -= blockCount * BLOCK_ISSUE_PENALTY;
    reasons.push(`차단(block) 이슈 ${blockCount}건 — 사실 근거·금지 표현 등 핵심 문제`);
  }
  if (warnCount > 0) {
    score -= warnCount * WARN_ISSUE_PENALTY;
    reasons.push(`경고(warn) 이슈 ${warnCount}건 — 확인이 필요한 항목`);
  }
  if (designPlan && hasMonotonousLayoutRun(designPlan)) {
    score -= MONOTONOUS_LAYOUT_PENALTY;
    reasons.push("같은 레이아웃이 3개 섹션 이상 연속됨 — 모든 섹션이 같은 템플릿처럼 보일 위험");
  }

  score = Math.max(0, Math.min(100, score));
  const grade: ProductStoryQualityGrade = score >= 80 ? "pass" : score >= 70 ? "warn" : "fail";
  return { score, grade, reasons };
}
