import type { ProductProfile } from "@acos/shared";
import type { ProductIdentification } from "./product-identification";

/**
 * 교차 검증 — 서로 다른 출처가 같은 항목에 대해 다른 값을 말하면 자동으로
 * 아무 값이나 채우지 않는다. (CTO 지시, 2026-08-09 — Sprint 1 T1-23)
 *
 * ## 무엇을 비교하는가
 *
 * 지금 실제로 존재하는 출처는 두 개다.
 *
 * - **OCR 직접 추출** (`ProductIdentification`, T1-21) — 포장지 글자에서
 *   정규식으로 뽑은 값. 해석이 섞이지 않는다.
 * - **GPT 분석** (`ProductProfile`) — OCR 텍스트 + Vision(사진) 특징을 GPT가
 *   종합해 해석한 값.
 *
 * 공식 제품 정보(웹 조사, T1-22)는 아직 만들어진 데이터 원천이 없다. 여기서는
 * 입력 자리만 열어 두고(`officialInfo`), 값이 없으면 비교에서 빠진다 —
 * 없는 것을 지어내지 않는다.
 *
 * ## 충돌하면 어떻게 하는가
 *
 * 값을 가진 출처가 하나뿐이면 그 값을 그대로 쓴다 — 비교할 대상이 없다.
 * 둘 이상의 출처가 값을 가졌는데 정규화한 값이 다르면 **채우지 않는다.**
 * 어느 출처가 맞는지는 실제 제품 사진을 보는 사람만 판단할 수 있다
 * (`docs/MASTER_GUIDE.md` §4 정보 출처 우선순위 — 실제 제품 사진이 항상
 * 최우선이며, 그 판단은 사람의 몫이다).
 */

export type VerificationFieldStatus =
  | "single-source"
  | "agreed"
  | "conflict"
  | "unknown";

export interface FieldObservation {
  source: string;
  value: string;
}

export interface FieldVerification {
  field: string;
  observations: FieldObservation[];
  status: VerificationFieldStatus;
  /** 충돌 시 null — 사람이 판단하기 전에는 아무 값도 확정하지 않는다 */
  resolvedValue: string | null;
}

export interface CrossVerificationResult {
  fields: FieldVerification[];
  /** 하나라도 충돌이 있으면 true — 브라우저 검증 화면에서 강조하는 근거 */
  hasConflict: boolean;
}

/** 공식 조사 결과 (T1-22 산출물) — 아직 실데이터 원천이 없어 항상 비어 들어온다 */
export interface OfficialProductInfo {
  brand?: string | null;
  model?: string | null;
  /** 어디서 조사했는지 (예: 제조사 공식 홈페이지 URL) */
  source: string;
}

function normalize(value: string): string {
  return value.replace(/[\s()（）,·.]/g, "").toLowerCase();
}

function verifyField(field: string, observations: FieldObservation[]): FieldVerification {
  const present = observations.filter((o) => o.value.trim().length > 0);
  if (present.length === 0) {
    return { field, observations: [], status: "unknown", resolvedValue: null };
  }
  if (present.length === 1) {
    return { field, observations: present, status: "single-source", resolvedValue: present[0].value };
  }
  const distinct = new Set(present.map((o) => normalize(o.value)));
  if (distinct.size === 1) {
    return { field, observations: present, status: "agreed", resolvedValue: present[0].value };
  }
  // 값이 갈린다 — 실제 제품 사진을 아는 사람만 판단할 수 있다. 자동으로 채우지 않는다.
  return { field, observations: present, status: "conflict", resolvedValue: null };
}

/**
 * OCR 직접 추출 · GPT 분석 · (있으면) 공식 조사 결과를 항목별로 비교한다.
 *
 * DB·네트워크 접근이 없는 순수 함수다(packages/core 원칙, `identifyProduct`와
 * 같은 이유).
 */
export function crossVerifyProduct(input: {
  identification: ProductIdentification;
  profile: ProductProfile | null;
  officialInfo?: OfficialProductInfo | null;
}): CrossVerificationResult {
  const brandObservations: FieldObservation[] = [];
  if (input.identification.brand) {
    brandObservations.push({ source: "OCR 직접 추출", value: input.identification.brand });
  }
  if (input.profile?.brand) {
    brandObservations.push({ source: "GPT 분석(사진+OCR 종합)", value: input.profile.brand });
  }
  if (input.officialInfo?.brand) {
    brandObservations.push({
      source: `공식 정보(${input.officialInfo.source})`,
      value: input.officialInfo.brand,
    });
  }

  const modelObservations: FieldObservation[] = [];
  if (input.identification.model) {
    modelObservations.push({ source: "OCR 직접 추출", value: input.identification.model });
  }
  if (input.profile?.model) {
    modelObservations.push({ source: "GPT 분석(사진+OCR 종합)", value: input.profile.model });
  }
  if (input.officialInfo?.model) {
    modelObservations.push({
      source: `공식 정보(${input.officialInfo.source})`,
      value: input.officialInfo.model,
    });
  }

  const fields = [
    verifyField("brand", brandObservations),
    verifyField("model", modelObservations),
  ];

  return { fields, hasConflict: fields.some((f) => f.status === "conflict") };
}

/**
 * `crossVerifyProduct`가 확정한 brand/model을 Profile에 되돌려 적용한다 —
 * 충돌(`conflict`)이거나 근거가 없으면(`unknown`) null로 남는다. STEP 5
 * (카피·HTML 생성)가 STEP 4 원본이 아니라 이 결과만 근거로 삼아야 한다는
 * 원칙(T1-24)을 `ProductProfileEngine`과 재렌더링 경로(T1-75, Image Studio
 * 선택 이미지로 상세페이지를 다시 그릴 때) 양쪽이 똑같이 따르게 한다.
 */
export function applyCrossVerifiedProfile(
  profile: ProductProfile,
  crossVerification: CrossVerificationResult,
): ProductProfile {
  return {
    ...profile,
    brand: crossVerification.fields.find((f) => f.field === "brand")?.resolvedValue ?? null,
    model: crossVerification.fields.find((f) => f.field === "model")?.resolvedValue ?? null,
  };
}
