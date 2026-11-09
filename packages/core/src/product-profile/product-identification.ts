/**
 * 제품 자동 분석 — 제품을 식별할 수 있는 정보를 **한 단계에서 동시에**
 * 수집한다. (CTO 지시, 2026-08-09 — Sprint 1 T1-21)
 *
 * ## 왜 한 단계인가
 *
 * OCR만 먼저 하고 나머지를 나중에 하면, 그 사이의 Product Package는 반쪽짜리
 * 정보로 Gemini에 전달된다. 실제로 그 상태에서 Gemini가 **다른 제품**을
 * 그렸다(PROJECT_MEMORY M-1·M-2). 제품 식별은 나눠서 할 수 있는 일이 아니다.
 *
 * ## 이 파일이 하는 일과 하지 않는 일
 *
 * 여기서는 **이미 수집된 텍스트에서 식별자를 뽑아내는 순수 판정**만 한다 —
 * OCR 호출·Vision 호출·웹 조사는 어댑터(`apps/api`)의 몫이다. DB도
 * 네트워크도 만지지 않는다(packages/core 원칙).
 *
 * ## 지어내지 않는다
 *
 * 찾지 못한 값은 **null**로 둔다. "그럴듯한 값"으로 채우면 그 추측이
 * Product Package를 거쳐 Gemini까지 전파된다 — 이 프로젝트가 실제로 겪은
 * 사고다(PROJECT_MEMORY M-2).
 */

/** 바코드 한 건 — 어디서 어떤 형식으로 찾았는지까지 남긴다 */
export interface DetectedBarcode {
  /** 숫자만 남긴 값 (예: "8804161300700") */
  value: string;
  /** GTIN-13(EAN-13) · GTIN-8 · GTIN-14 */
  format: "GTIN-8" | "GTIN-13" | "GTIN-14";
  /** 체크디짓 검증을 통과했는가 — 통과하지 못한 값은 신뢰하지 않는다 */
  checkDigitValid: boolean;
}

/** QR·URL 한 건 */
export interface DetectedQrOrUrl {
  value: string;
  kind: "url";
}

/** 제품 자동 분석 결과 (T1-21 산출물) */
export interface ProductIdentification {
  /** 발견한 바코드 — 체크디짓을 통과한 것을 앞에 둔다 */
  barcodes: DetectedBarcode[];
  /** 발견한 URL(제조사 홈페이지 후보 포함) */
  urls: DetectedQrOrUrl[];
  /** 포장지 "품명" 표기 — 제품명과 다를 수 있다 */
  officialProductLabel: string | null;
  /** 모델명·품번 — 찾지 못하면 null (지어내지 않는다) */
  model: string | null;
  /** 제조·판매원 */
  brand: string | null;
  /** 원산지 */
  origin: string | null;
  /** 고객상담 전화 */
  customerServicePhone: string | null;
  /** 이 분석이 제품을 특정할 수 있는 상태인가 — 웹 조사 수행 여부의 근거 */
  identified: boolean;
  /** 무엇으로 특정했는지 (사람이 읽는 근거) */
  identifiedBy: string[];
}

const EMPTY: ProductIdentification = {
  barcodes: [],
  urls: [],
  officialProductLabel: null,
  model: null,
  brand: null,
  origin: null,
  customerServicePhone: null,
  identified: false,
  identifiedBy: [],
};

/**
 * GTIN 체크디짓 검증.
 *
 * **왜 검증하는가**: OCR은 포장지의 아무 숫자열이나 바코드처럼 읽어 온다
 * (전화번호·주소·인증번호). 체크디짓을 통과하지 못한 숫자를 바코드로 믿고
 * 웹 조사에 쓰면 **엉뚱한 제품 정보**를 가져온다.
 */
export function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  if (![8, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const expected = Number(digits.slice(-1));
  const sum = body.reduce(
    (acc, ch, index) => acc + Number(ch) * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === expected;
}

/**
 * OCR 텍스트에서 바코드 후보를 찾는다 — 공백이 섞여 들어오는 경우가 잦다.
 *
 * **짧은 형식(GTIN-8)은 우연히 통과하기 쉽다.** 실측에서 전화번호와 주소
 * 숫자가 이어 붙어 만들어진 8자리가 체크디짓을 통과했다(`78298804`).
 * 체크디짓은 10분의 1 확률로 우연히 맞는다 — 8자리는 그만큼 흔하다.
 *
 * 그래서 두 가지를 지킨다:
 * 1. **긴 형식(14 → 13 → 8) 순서로 먼저 확정**하고, 이미 찾은 숫자열
 *    안에 포함되는 짧은 후보는 버린다.
 * 2. 하나의 숫자 덩어리에서는 **가장 긴 형식 하나만** 인정한다.
 */
function findBarcodes(text: string): DetectedBarcode[] {
  const found = new Map<string, DetectedBarcode>();

  // 바코드가 아닌 것이 확실한 숫자를 **먼저 지운다.** 지우지 않으면 전화번호
  // 뒤에 다른 숫자가 이어 붙어 우연히 체크디짓을 통과한다(실측: 전화번호
  // 031-997-7829 + 주소 숫자가 붙어 "78298804"가 GTIN-8로 잡혔다).
  const cleaned = text
    // 전화번호 — 하이픈이 있든 없든
    .replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, " ")
    // 우편번호·도로명 번지 (예: 513-2)
    .replace(/\b\d{1,5}-\d{1,4}\b/g, " ");

  // "8804161 3007001"처럼 중간에 공백이 들어간 형태까지 잡는다.
  for (const raw of cleaned.matchAll(/\b[\d][\d\s]{6,20}\d\b/g)) {
    const digits = raw[0].replace(/\s/g, "");
    let matchedInThisChunk = false;
    for (const len of [14, 13, 8] as const) {
      if (matchedInThisChunk || digits.length < len) continue;
      // OCR이 끝에 자릿수를 덧붙이는 일이 있어 앞에서부터도 맞춰 본다.
      for (const candidate of [digits.slice(0, len), digits.slice(-len)]) {
        if (candidate.length !== len || found.has(candidate)) continue;
        if (!isValidGtin(candidate)) continue;
        found.set(candidate, {
          value: candidate,
          format: len === 8 ? "GTIN-8" : len === 13 ? "GTIN-13" : "GTIN-14",
          checkDigitValid: true,
        });
        matchedInThisChunk = true;
        break;
      }
    }
  }
  return [...found.values()];
}

/** URL(제조사 홈페이지 후보) — 뒤에 붙은 문장부호는 떼어 낸다 */
function findUrls(text: string): DetectedQrOrUrl[] {
  const found = new Set<string>();
  for (const raw of text.matchAll(/(?:https?:\/\/)?(?:www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?/g)) {
    found.add(raw[0].replace(/[.,)\]]+$/, ""));
  }
  return [...found].map((value) => ({ value, kind: "url" as const }));
}

/** 라벨이 붙은 값 한 줄을 읽는다 (예: "품명 연질염화비닐호스") */
function readLabeled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const hit = new RegExp(`${label}\\s*[:：]?\\s*([^\\n]+)`).exec(text);
    const value = hit?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * 모델명·품번을 찾는다.
 *
 * **찾지 못하면 null이다.** 제품명을 모델명 칸에 옮겨 적지 않는다 —
 * 품명과 모델명은 다른 개념이고, 섞으면 진짜 모델 번호가 있는 제품에서
 * 두 값이 충돌한다.
 */
function findModel(text: string): string | null {
  const labeled = readLabeled(text, ["모델명", "모델", "품번", "제품번호", "Model"]);
  if (labeled) return labeled;
  // 라벨이 없으면 영문+숫자 조합의 전형적인 품번 형태만 인정한다.
  const pattern = /\b[A-Z]{2,}[-\s]?\d{2,}[A-Z0-9-]*\b/.exec(text);
  return pattern?.[0]?.trim() ?? null;
}

/**
 * 수집된 텍스트에서 제품 식별 정보를 뽑는다.
 *
 * `ocrText`는 포장지·라벨에서 읽은 글자, `visionText`는 사진을 보고 얻은
 * 설명이다. **OCR을 Vision보다 우선**한다 — 포장지 글자는 제조사가 적은
 * 사실이고, Vision은 사진을 보고 내린 판단이기 때문이다.
 */
export function identifyProduct(input: {
  ocrText: string | null;
  visionText?: string | null;
}): ProductIdentification {
  const ocr = input.ocrText?.trim() ?? "";
  const vision = input.visionText?.trim() ?? "";
  if (!ocr && !vision) return { ...EMPTY };

  // 우선순위: OCR이 앞이다. 같은 항목이 둘 다 있으면 OCR 값을 쓴다.
  const combined = [ocr, vision].filter(Boolean).join("\n");

  const barcodes = findBarcodes(ocr); // 바코드는 포장지에서만 인정한다
  const urls = findUrls(combined);
  const officialProductLabel = readLabeled(ocr, ["품명"]);
  const model = findModel(ocr) ?? findModel(vision);
  const brand = readLabeled(ocr, ["제조 및 판매원", "제조원", "판매원", "브랜드"]);
  const origin = readLabeled(ocr, ["원산지"]);
  const customerServicePhone =
    /\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/.exec(ocr)?.[0]?.trim() ?? null;

  const identifiedBy: string[] = [];
  if (barcodes.length > 0) identifiedBy.push("바코드");
  if (model) identifiedBy.push("모델명");
  if (brand) identifiedBy.push("브랜드");
  if (officialProductLabel) identifiedBy.push("품명");

  return {
    barcodes,
    urls,
    officialProductLabel,
    model,
    brand,
    origin,
    customerServicePhone,
    // 바코드 하나만 있어도 제품은 특정된다. 없으면 브랜드+품명이 함께
    // 있어야 특정으로 본다 — 둘 중 하나만으로는 같은 이름의 다른 제품과
    // 구분되지 않는다(PROJECT_MEMORY M-21).
    identified: barcodes.length > 0 || Boolean(brand && (officialProductLabel || model)),
    identifiedBy,
  };
}
