import type { ReadyValidationStatus } from "@acos/shared";
import {
  canTransitionProductObject,
  validateReadyRequirements,
} from "../product-object/product-object.status";
import type { ProductObjectStatus } from "@acos/shared";

/**
 * READY Validation Engine — READY 전환 가능 여부 판정. (TASK-0404)
 *
 * Company Brain(Knowledge/Memory/Decision/SOP)에서 읽은 컨텍스트와
 * Product Object 상태를 입력으로 받아 검사 목록을 평가한다.
 * 데이터 수집(CompanyBrainService 호출)은 API 계층이 담당하고,
 * 판정 로직은 이 모듈이 프레임워크와 무관하게 담당한다.
 *
 * 판정 3단계 (CTO 지시): PASS / WARNING / FAIL — 전체 판정은 최악 값.
 */
export interface ReadyValidationCheck {
  key: string;
  name: string;
  status: ReadyValidationStatus;
  messages: string[];
}

export interface ReadyValidationContext {
  productObject: {
    status: ProductObjectStatus;
    title: string;
    brand: string | null;
    category: string | null;
    /** OCR 요약의 combinedText (없으면 null) — 금지어 스캔 대상 */
    ocrText: string | null;
    ocrSummary: unknown;
    visionSummary: unknown;
  };
  /** Memory(GLOBAL, key=banned-words)에서 읽은 금지어 목록 — 미설정이면 null */
  bannedWords: string[] | null;
  /** Knowledge에서 제목으로 검색된 RULE/LEGAL 지식 */
  relatedRules: { title: string; category: string | null }[];
  /** Decision에서 제목으로 검색된 프로젝트 결정 */
  relatedDecisions: { title: string }[];
  /** SOP 정의(product-content)가 Company Brain에 존재하는가 */
  hasStandardSop: boolean;
}

const SEVERITY: Record<ReadyValidationStatus, number> = {
  PASS: 0,
  WARNING: 1,
  FAIL: 2,
};

/** 전체 판정 = 개별 검사 중 최악 값 (FAIL > WARNING > PASS) */
export function worstStatus(
  statuses: ReadyValidationStatus[],
): ReadyValidationStatus {
  return statuses.reduce(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    "PASS" as ReadyValidationStatus,
  );
}

/** 텍스트에서 금지어를 찾는다 (부분 일치, 대소문자 무시) — 발견된 금지어 목록 반환 */
export function scanBannedWords(text: string, words: string[]): string[] {
  const lowered = text.toLowerCase();
  return words.filter(
    (word) => word.trim().length > 0 && lowered.includes(word.toLowerCase()),
  );
}

export function evaluateReadyValidation(input: ReadyValidationContext): {
  status: ReadyValidationStatus;
  checks: ReadyValidationCheck[];
} {
  const { productObject } = input;
  const checks: ReadyValidationCheck[] = [];

  // 1) 상태 전이 가능 여부 (도메인 규칙, TASK-0302)
  const transitionOk = canTransitionProductObject(productObject.status, "READY");
  checks.push({
    key: "transition",
    name: "상태 전이 가능",
    status: transitionOk ? "PASS" : "FAIL",
    messages: transitionOk
      ? [`${productObject.status} → READY 전이 가능`]
      : [`현재 상태(${productObject.status})에서는 READY로 전이할 수 없습니다.`],
  });

  // 2) 기본 필수 조건 (제목 + OCR/Vision 요약, TASK-0302)
  const requirementErrors = validateReadyRequirements({
    title: productObject.title,
    ocrSummary: productObject.ocrSummary,
    visionSummary: productObject.visionSummary,
  });
  checks.push({
    key: "requirements",
    name: "기본 필수 조건",
    status: requirementErrors.length === 0 ? "PASS" : "FAIL",
    messages:
      requirementErrors.length === 0
        ? ["제목·요약 필수 조건 충족"]
        : requirementErrors,
  });

  // 3) 금지어 검사 — Memory(GLOBAL, banned-words) 기반
  if (input.bannedWords === null) {
    checks.push({
      key: "banned-words",
      name: "금지어 검사 (Memory)",
      status: "WARNING",
      messages: [
        "금지어 목록이 설정되지 않아 검사를 건너뜁니다. " +
          "(Memory: scope=GLOBAL, key=banned-words, value=문자열 배열)",
      ],
    });
  } else {
    const target = [
      productObject.title,
      productObject.brand ?? "",
      productObject.category ?? "",
      productObject.ocrText ?? "",
    ].join(" ");
    const hits = scanBannedWords(target, input.bannedWords);
    checks.push({
      key: "banned-words",
      name: "금지어 검사 (Memory)",
      status: hits.length === 0 ? "PASS" : "FAIL",
      messages:
        hits.length === 0
          ? [`금지어 ${input.bannedWords.length}개 기준 위반 없음`]
          : [`금지어 발견: ${hits.join(", ")}`],
    });
  }

  // 4) 관련 규칙 검토 — Knowledge(RULE/LEGAL) 기반
  checks.push({
    key: "knowledge-rules",
    name: "관련 규칙 검토 (Knowledge)",
    status: input.relatedRules.length === 0 ? "PASS" : "WARNING",
    messages:
      input.relatedRules.length === 0
        ? ["관련 RULE/LEGAL 지식 없음"]
        : [
            `검토가 필요한 관련 규칙 ${input.relatedRules.length}건: ` +
              input.relatedRules
                .map((rule) => `${rule.title}(${rule.category ?? "-"})`)
                .join(", "),
          ],
  });

  // 5) 관련 결정 참고 — Decision 기반 (정보성, 항상 PASS)
  checks.push({
    key: "decisions",
    name: "관련 결정 참고 (Decision)",
    status: "PASS",
    messages:
      input.relatedDecisions.length === 0
        ? ["관련 결정 없음"]
        : [
            `관련 결정 ${input.relatedDecisions.length}건 참고: ` +
              input.relatedDecisions.map((decision) => decision.title).join(", "),
          ],
  });

  // 6) 표준 절차 존재 — SOP 기반
  checks.push({
    key: "sop",
    name: "표준 절차 (SOP)",
    status: input.hasStandardSop ? "PASS" : "WARNING",
    messages: input.hasStandardSop
      ? ["상품 콘텐츠 표준 절차(product-content) 정의 확인"]
      : ["표준 절차(product-content)가 정의되어 있지 않습니다."],
  });

  return {
    status: worstStatus(checks.map((check) => check.status)),
    checks,
  };
}
