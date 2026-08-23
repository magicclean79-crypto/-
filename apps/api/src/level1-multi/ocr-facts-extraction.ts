/**
 * OCR 원문 → Product Facts 후보 (T1-196).
 *
 * `packages/core/src/product-profile/product-identification.ts`(T1-21)와
 * 같은 "라벨이 붙은 값을 읽는다" 패턴을 쓰지만, 이 모듈은
 * `VerifiedProductFacts`(T1-191, level1-multi 전용) 필드 집합에 맞춰
 * 새로 쓴다 — level1-multi는 다른 작업과 충돌을 피하려 core 모듈을
 * import하지 않고 이 모듈 안에서 완결된다(multi-page-types.ts 헤더 주석과
 * 같은 이유).
 *
 * **지어내지 않는다**: 라벨을 못 찾으면 후보 자체를 만들지 않는다(null을
 * 후보로 넣지 않는다) — 없는 값을 "낮은 신뢰도로 추정"하는 것도 추측이다.
 */

/** 필드 하나의 OCR 후보 값 — 어느 사진에서 나왔는지 항상 함께 남긴다. */
export interface OcrFactCandidate {
  assetId: string;
  field: OcrFactField;
  value: string;
  /** 이 사진의 OCR 신뢰도(제공되면) — 후보 자체의 정확도가 아니라 OCR의 인식 신뢰도다. */
  confidence: number | null;
}

export const OCR_FACT_FIELDS = [
  "brand",
  "model",
  "manufacturer",
  "originCountry",
  "dimensions",
] as const;
export type OcrFactField = (typeof OCR_FACT_FIELDS)[number];

/** 라벨이 붙은 값 한 줄을 읽는다 (예: "제조 및 판매원 상성산업(주)") */
function readLabeled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const hit = new RegExp(`${label}\\s*[:：]?\\s*([^\\n]+)`).exec(text);
    const value = hit?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

const FIELD_LABELS: Record<OcrFactField, string[]> = {
  brand: ["브랜드", "상표"],
  model: ["모델명", "모델", "품번", "제품번호", "Model"],
  manufacturer: ["제조 및 판매원", "제조원", "판매원", "제조사", "제조업체"],
  originCountry: ["원산지", "제조국"],
  dimensions: ["규격", "크기", "사이즈", "치수"],
};

/**
 * 라벨 없이 상호만 단독으로 적힌 경우의 대비책 — 포장 앞면 로고 아래에는
 * "제조 및 판매원" 같은 라벨 없이 회사명만 적혀 있는 경우가 실제로
 * 있다(예: "베란다용 스텐 호스 세트 3M\n...\n삼정크린마스터(주)"). 한국
 * 법인 상호는 관례상 "(주)"·"㈜" 표기를 동반하므로, 라벨 매칭이 실패했을
 * 때만 이 패턴을 제조사 후보로 쓴다 — 지어내는 것이 아니라 사진에 실제로
 * 인쇄된 상호 표기 관례를 읽는 것이다.
 */
const COMPANY_SUFFIX_PATTERN = /[^\s\n(]{1,20}\(주\)|㈜[^\s\n]{1,20}/u;

function findCompanySuffixCandidate(text: string): string | null {
  return COMPANY_SUFFIX_PATTERN.exec(text)?.[0]?.trim() ?? null;
}

/** "구성품" 목록 — 콤마·가운뎃점·줄바꿈으로 나뉜 항목을 배열로 뽑는다. */
function readListLabeled(text: string, labels: string[]): string[] {
  const raw = readLabeled(text, labels);
  if (!raw) return [];
  return raw
    .split(/[,，·、/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** "재질" — 소재를 배열로 뽑는다. */
const MATERIAL_LABELS = ["재질", "소재"];
const COMPONENT_LABELS = ["구성품", "구성", "포함품목"];
/** "주의사항" 구간 — 다음 라벨이 나오기 전까지를 통째로 담는다(줄 단위 최대 6줄). */
function readCautions(text: string): string[] {
  const hit = /주의\s*사항\s*[:：]?\s*\n?([\s\S]{0,400})/.exec(text);
  if (!hit) return [];
  const block = hit[1];
  const lines = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // 다음 섹션 라벨(품명·모델명 등)이 나오면 그 이전까지만 자른다 —
  // 라벨 없이 이어지는 포장지 전문을 통째로 주의사항으로 오인하지 않는다.
  const stopAt = lines.findIndex((line) =>
    /^(품명|모델명|제조|원산지|규격|구성품|바코드)/.test(line),
  );
  const bounded = stopAt === -1 ? lines : lines.slice(0, stopAt);
  return bounded.slice(0, 6);
}

/** OCR 텍스트 한 장 분량에서 스칼라 필드 후보를 뽑는다. */
export function extractOcrFactCandidates(
  ocrResults: { assetId: string; text: string; confidence: number | null }[],
): OcrFactCandidate[] {
  const candidates: OcrFactCandidate[] = [];
  for (const { assetId, text, confidence } of ocrResults) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    for (const field of OCR_FACT_FIELDS) {
      const value =
        readLabeled(trimmed, FIELD_LABELS[field]) ??
        (field === "manufacturer" ? findCompanySuffixCandidate(trimmed) : null);
      if (value) {
        candidates.push({ assetId, field, value, confidence });
      }
    }
  }
  return candidates;
}

/** OCR 텍스트에서 배열형 필드(소재·구성품·주의사항)를 뽑는다 — 사진별로 나눠 둔다. */
export interface OcrArrayFactCandidate {
  assetId: string;
  field: "materials" | "includedComponents" | "cautions";
  values: string[];
}

export function extractOcrArrayFactCandidates(
  ocrResults: { assetId: string; text: string }[],
): OcrArrayFactCandidate[] {
  const out: OcrArrayFactCandidate[] = [];
  for (const { assetId, text } of ocrResults) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    const materials = readListLabeled(trimmed, MATERIAL_LABELS);
    if (materials.length > 0) out.push({ assetId, field: "materials", values: materials });
    const components = readListLabeled(trimmed, COMPONENT_LABELS);
    if (components.length > 0) out.push({ assetId, field: "includedComponents", values: components });
    const cautions = readCautions(trimmed);
    if (cautions.length > 0) out.push({ assetId, field: "cautions", values: cautions });
  }
  return out;
}
