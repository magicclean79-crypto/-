import type { ProductPackage, ProductProfile } from "@acos/shared";
import { crossVerifyProduct } from "./cross-verification";
import { identifyProduct } from "./product-identification";
import type { ProductResearchResult } from "./product-research";

/**
 * AI Product Package 조립. (CTO 지시, 2026-08-08 — GPT → Product Package →
 * Gemini 연결 파이프라인 1단계)
 *
 * Product Profile 실행 결과(STEP 4 산출물)만 입력으로 받는 순수 함수다 —
 * DB·네트워크 접근이 없다(packages/core 원칙, `ProductProfileEngine`과 같은
 * 이유). 1단계에서는 아직 실체가 없는 5개 항목(참고 URL·벤치마크 분석·
 * 디자인 규칙·회사 디자인 정책·Learning History)을 지어내지 않고 빈 값으로
 * 남긴다 — `parseProductProfileResponse`가 "모른다"를 지어내지 않는 것과
 * 같은 원칙이다.
 */
export function buildProductPackage(input: {
  profile: ProductProfile | null;
  ocrText: string | null;
  /** Vision 분석 텍스트 — 있으면 식별에 함께 쓴다 */
  visionText?: string | null;
  /**
   * 공식 웹 조사 결과 (T1-22). 아직 이 함수를 부르는 자리에서 실제로
   * 조사를 실행하지 않아 지금은 항상 null이다 — 조사가 실행되어 결과가
   * 넘어오면 그대로 옮겨 담는다(T1-05가 참고 URL에 쓴 것과 같은 방식).
   *
   * **값을 해석해 브랜드·모델 등 다른 필드에 자동으로 반영하지 않는다.**
   * 검색 스니펫에서 "이게 브랜드 값이다"라고 뽑아내는 것 자체가 추측이다
   * (identification·profile처럼 정규식으로 라벨을 직접 읽은 값이 아니라,
   * 검색 결과 스니펫은 사람이 읽고 판단해야 하는 원문이다). 그래서 무엇을
   * 찾았고 무엇을 버렸는지 그대로 남겨 사람이 보게 한다.
   */
  research?: ProductResearchResult | null;
  /**
   * 사용자 요구사항 기반 생성 (T1-92) — 사용자가 직접 입력한 자유 텍스트
   * 요구사항. `buildImageGenerationPrompt`가 이 값을 그대로 프롬프트에
   * 옮기며, 제품 사실(위 필드들)과 충돌하면 사실이 우선한다는 규칙과
   * 함께 전달한다.
   */
  userRequirement?: string | null;
}): ProductPackage {
  // 제품 자동 분석 (T1-21) — 바코드·모델명·브랜드·원산지를 OCR 원문에서
  // 직접 뽑는다. 지어내지 않는다: 못 찾으면 null이 그대로 남는다.
  const identification = identifyProduct({
    ocrText: input.ocrText,
    visionText: input.visionText ?? null,
  });

  // 교차 검증 (T1-23, 2026-08-09) — OCR 직접 추출과 GPT 분석이 같은 항목에
  // 다른 값을 말하면 자동으로 채우지 않는다. 값을 가진 출처가 하나뿐이면
  // 그대로 쓰고, 둘 다 있는데 다르면 resolvedValue가 null로 남는다.
  const crossVerification = crossVerifyProduct({ identification, profile: input.profile });
  const resolvedBrand =
    crossVerification.fields.find((f) => f.field === "brand")?.resolvedValue ?? null;
  const resolvedModel =
    crossVerification.fields.find((f) => f.field === "model")?.resolvedValue ?? null;

  return {
    identification,
    crossVerification,
    productProfile: input.profile,
    ocrText: input.ocrText,
    productName: input.profile?.productName ?? null,
    features: input.profile?.features ?? [],
    specifications: input.profile?.specifications ?? {},
    // 제품 식별 정보 (CTO 지시, 2026-08-08) — 프로필 안에만 있고 프롬프트로는
    // 나가지 않던 값들이다. 확인된 값만 옮기고 없으면 null로 둔다.
    //
    // 브랜드·모델은 교차 검증(T1-23) 결과를 쓴다 — 출처가 하나뿐이면 그
    // 값을, 출처가 둘 이상이고 값이 다르면 null을 쓴다(자동으로 채우지
    // 않는다). 이전에는 OCR 값을 무조건 앞세웠는데, 그러면 충돌이 있어도
    // 조용히 한쪽 값으로 덮어써서 충돌 자체가 드러나지 않았다.
    brand: resolvedBrand,
    model: resolvedModel,
    material: input.profile?.material ?? null,
    usage: input.profile?.usage ?? null,
    research: input.research ?? null,
    userRequirement: input.userRequirement?.trim() || null,
    referenceUrls: [],
    benchmarkAnalysis: null,
    designRules: null,
    companyDesignPolicy: null,
    learningHistory: null,
  };
}

/**
 * 제품 정보를 Gemini가 어떻게 다뤄야 하는지 못 박는 문장. (CTO 지시,
 * 2026-08-08 — Sprint 1 규칙 3)
 *
 * **이 규칙은 제품 정보가 없어도 항상 붙인다.** 정보를 넘기지 않아도 원본
 * 사진 자체에 라벨·포장 문구가 찍혀 있고, Gemini는 그것을 그대로 베껴
 * 그리려 한다 — 글자를 넣지 말라는 지시가 필요한 이유는 우리가 정보를
 * 넘겼기 때문이 아니라 **사진에 이미 글자가 있기 때문**이다.
 */
const IMAGE_TEXT_RULES = [
  "[제품 정보 사용 규칙]",
  "- 제품명을 이미지 안에 글자로 그리지 않는다.",
  "- 라벨·포장에 적힌 텍스트를 이미지 안에 글자로 넣지 않는다.",
  "- 스펙표·수치·단위를 이미지 안에 글자로 넣지 않는다.",
  "- 위 제품 정보는 제품을 이해하기 위한 참고 자료일 뿐이며, 글자로 렌더링할 대상이 아니다.",
  "- 제품의 실제 형태·구조·재질·사용 방식을 정확하게 표현하는 데에만 활용한다.",
].join("\n");

/**
 * 제품 동일성 — 이 프롬프트의 **최우선 규칙**. (CTO 지시, 2026-08-08)
 *
 * "이미지 품질보다 제품 동일성이 항상 우선한다."
 *
 * 실측에서 특징 강조·구성품·디테일·사용 장면·썸네일이 **원본과 다른
 * 제품**으로 생성되는 경우가 나왔다. Gemini는 제품을 새로 디자인하는
 * 역할이 아니라 **실제 제품을 다양한 상황에서 표현하는** 역할만 한다.
 *
 * 규칙 블록보다 **앞에** 놓는다 — 뒤에 오는 지시일수록 약하게 반영되는
 * 경향이 있어, 가장 중요한 제약을 먼저 못 박는다.
 */
const PRODUCT_IDENTITY_RULES = [
  "[최우선 규칙 — 제품 동일성]",
  "",
  "너는 새로운 제품을 디자인하는 AI가 아니다.",
  "사용자가 제공한 실제 제품을 바탕으로 마케팅용 이미지를 만드는 AI다.",
  "",
  "1. 사용자가 제공한 실제 제품과 동일한 제품을 생성한다.",
  "2. 새로운 제품을 디자인하지 않는다.",
  "3. 제품의 형태와 구조를 변경하지 않는다.",
  "4. 제품 식별이 가능한 특징을 유지한다.",
  "5. 제품의 색상·비율·구성품을 유지한다.",
  "",
  "**사진에 없는 것은 만들지 않는다. 확인되지 않은 것은 추측하지 않는다.**",
  "",
  "[바꿔도 되는 것]",
  "- 배경",
  "- 조명",
  "- 촬영 구도",
  "- 분위기",
  "- 사람 모델",
  "- 연출",
  "",
  "[바꾸면 안 되는 것]",
  "- 제품 형태 변경",
  "- 구성품 추가",
  "- 구성품 삭제",
  "- 제품 색상 변경",
  "- 제품 구조 변경",
  "- 제품 재질 변경",
  "- 제품 크기 비율 변경",
  "- 제품 특징 변경",
  "- 사진에 없는 제품 생성",
  "- 사진에 없는 구성품 생성",
  "- 허구의 제품 정보 생성",
  "",
  "그 제품임을 알아보게 하는 특징적인 형상(손잡이 모양·홈·나사선·각인·연결부)은",
  "특히 그대로 유지한다.",
  "",
  "제품이 원본과 달라 보일 위험이 있으면, 연출을 포기하고 원본에 충실한 쪽을 택한다.",
  "이미지 품질보다 제품 동일성이 항상 우선한다.",
  "실제 제품과 다른 결과가 나오면, 이미지 품질과 관계없이 실패다.",
].join("\n");

/**
 * 사람이 등장할 때의 기본값. (CTO 지시, 2026-08-08)
 *
 * 실측에서 서양인 모델이 생성됐다. 이 제품의 실제 사용자는 한국 소비자이며,
 * 상세페이지에 서양인이 나오면 제품과 사용 맥락이 어긋난다.
 */
const HUMAN_MODEL_RULES = [
  "[사람이 등장하는 경우]",
  "- 서양인 모델을 쓰지 않는다. 기본값은 한국인 모델이다.",
  "- 20~30대의 자연스럽고 세련된 한국인으로 표현한다.",
  "- 깔끔한 스타일을 유지하되, 과도한 연출이나 비현실적인 모델은 쓰지 않는다.",
  "- 사람이 필요 없는 장면이면 사람을 넣지 않는다.",
].join("\n");

/**
 * Gemini에 보낼 이미지 생성 프롬프트를 만든다. (CTO 지시, 2026-08-08 —
 * Sprint 1 규칙 1·2·3)
 *
 * **모든 이미지 생성 경로가 이 함수 하나만 쓴다.** 경로마다 프롬프트를 따로
 * 조립하면 같은 제품인데 버튼에 따라 결과가 달라지고, 나중에 "왜 이 사진만
 * 이상하지"를 추적할 수 없다.
 *
 * 값이 없는 항목은 아예 등장시키지 않는다 — 빈 항목을 언급하면 Gemini에게
 * 없는 정보를 찾으라는 잘못된 신호가 된다. `productPackage`가 null인 경우
 * (배경 제거처럼 Product Profile 없이도 도는 단계)에도 규칙 문장은 붙는다.
 */
/** 중복 판정용 정규화 — 공백·괄호·조사 차이로 같은 값을 놓치지 않게 한다 */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s()（）,·]/g, "").toLowerCase();
}

export function buildImageGenerationPrompt(
  productPackage: ProductPackage | null,
  instruction: string,
): string {
  const lines: string[] = [];
  if (productPackage) {
    const id = productPackage.identification;
    if (productPackage.productName) {
      lines.push(`제품명: ${productPackage.productName}`);
    }
    // 제품 식별 정보 (CTO 지시, 2026-08-08 — 제품 동일성 개선).
    // 값이 없으면 줄 자체를 만들지 않는다 — 빈 항목을 언급하면 Gemini에게
    // 없는 정보를 찾으라는 잘못된 신호가 된다.
    if (productPackage.brand) {
      lines.push(`브랜드: ${productPackage.brand}`);
    }
    if (productPackage.model) {
      lines.push(`모델명: ${productPackage.model}`);
    }
    if (productPackage.material) {
      lines.push(`재질: ${productPackage.material}`);
    }
    if (productPackage.usage) {
      lines.push(`사용 목적: ${productPackage.usage}`);
    }
    // 포장지에서 직접 읽은 식별 정보 (T1-21, 2026-08-09).
    //
    // **"품명"은 상품명이 아니다.** 포장지 품질표시의 "품명"은 법정 재질
    // 분류이고(예: "연질염화비닐호스"), 실제 상품명은 라벨 앞면의 큰 글씨다
    // (예: "베란다용 스텐 호스 세트 3M"). 이것을 `공식 품명`이라는 이름으로
    // 함께 넘겼더니 **상품명이 두 개인 것처럼 읽혔다**(CTO 지적, 2026-08-09).
    //
    // 그래서 품명은 제품명 자리에 두지 않고 **재질 분류로만** 넘긴다.
    if (id?.origin) {
      lines.push(`원산지: ${id.origin}`);
    }
    if (id?.officialProductLabel) {
      lines.push(`법정 재질 분류(상품명 아님): ${id.officialProductLabel}`);
    }
    // 같은 사실을 여러 줄에 반복하지 않는다 (CTO 지시, 2026-08-09).
    //
    // 실측에서 이런 일이 있었다:
    //   재질: ABS, PVC, 스테인리스
    //   주요 특징: **연질염화비닐호스**, 길이 3M, …   ← 재질이 특징 자리에
    //   원산지: 한국
    //   스펙: **원산지 한국**, 호스 길이 3M, **제조 및 판매원 삼정…**  ← 중복
    //
    // 정보가 늘어난 게 아니라 노이즈가 늘어난 것이다. 이미 위에 적은 값은
    // 아래에서 빼서, 한 사실이 한 번만 나오게 한다.
    const alreadyStated = [
      productPackage.productName,
      productPackage.brand,
      productPackage.model,
      productPackage.material,
      id?.origin,
      id?.officialProductLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeForCompare);

    const isDuplicate = (text: string) => {
      const norm = normalizeForCompare(text);
      return alreadyStated.some((stated) => norm === stated || norm.includes(stated));
    };

    const features = productPackage.features.filter((f) => !isDuplicate(f));
    if (features.length > 0) {
      lines.push(`주요 특징: ${features.join(", ")}`);
    }
    const specEntries = Object.entries(productPackage.specifications).filter(
      ([key, value]) => !isDuplicate(`${key} ${value}`) && !isDuplicate(value),
    );
    if (specEntries.length > 0) {
      lines.push(`스펙: ${specEntries.map(([key, value]) => `${key} ${value}`).join(", ")}`);
    }
    if (productPackage.ocrText?.trim()) {
      lines.push(`라벨/포장 텍스트: ${productPackage.ocrText.trim()}`);
    }
    // 참고 URL은 Gemini가 제품 구조·재질·사용 방식·브랜드 디자인을 확인하는
    // 용도다 (CTO 지시 2). 아직 수집 단계가 없어 항상 비어 있지만, 채워지는
    // 순간 자동으로 전달되도록 여기서 함께 처리한다.
    if (productPackage.referenceUrls.length > 0) {
      lines.push(`참고 URL: ${productPackage.referenceUrls.join(", ")}`);
    }
  }

  // 제품 동일성이 맨 앞이다 — "이미지 품질보다 제품 동일성이 항상 우선한다"
  // (CTO 지시, 2026-08-08). 그다음이 제품 정보, 글자 금지, 사람 모델,
  // 사용자 요구사항(T1-92), 실제 지시문 순이다.
  const blocks: string[] = [PRODUCT_IDENTITY_RULES];
  if (lines.length > 0) {
    blocks.push(`[제품 정보 — 참고용]\n${lines.join("\n")}`);
  }
  blocks.push(IMAGE_TEXT_RULES, HUMAN_MODEL_RULES);
  // 사용자 요구사항 (T1-92) — 기존 "빠른 테스트"의 자유 텍스트 요구사항
  // 개념을 정식 파이프라인에 통합한다. 제품 동일성 규칙보다 뒤에 두어,
  // 요구사항이 제품 사실과 충돌하면 이미 위에서 못 박은 규칙이 우선하게
  // 한다 — 사용자가 "빨간색으로 바꿔줘"처럼 제품 사실과 어긋나는 것을
  // 요청해도 실제 제품 색상이 이긴다.
  if (productPackage?.userRequirement) {
    blocks.push(
      [
        "[사용자 요구사항 — 참고]",
        productPackage.userRequirement,
        "",
        "위 요구사항이 [최우선 규칙 — 제품 동일성]이나 실제 제품 정보와 충돌하면,",
        "요구사항을 무시하고 실제 제품 사실을 따른다.",
      ].join("\n"),
    );
  }
  blocks.push(instruction);
  return blocks.join("\n\n");
}
