/**
 * 가격표 변경 거버넌스. (TASK-3101, Sprint 31 — CTO 정책 3101-①②)
 *
 * 단가는 **검토 → 승인 → 적용** 절차를 거칩니다.
 *
 * 왜 절차가 필요한가: 단가는 **돈의 기준**입니다. 코드 한 줄을 고쳐 바로
 * 반영하면 ⓐ 누가 왜 바꿨는지 남지 않고 ⓑ 예산·리포트의 숫자가 어느 시점부터
 * 달라졌는지 아무도 설명할 수 없습니다. 그래서 제안을 기록으로 남기고, 단계를
 * 밟게 하고, **적용된 것은 손대지 못하게** 합니다.
 *
 * 두 가지를 명확히 구분합니다:
 *
 * | 개념 | 뜻 |
 * | --- | --- |
 * | **가격표** | 앞으로의 계산에 쓰는 기준 — 절차를 거쳐 바뀝니다 |
 * | **비용 기록** | 이미 나간 호출의 비용 — **절대 수정하지 않습니다**(Append Only, 정책 3101-②) |
 *
 * 단가가 바뀌어도 **과거 기록을 다시 계산하지 않습니다.** 대신 검증은
 * **그 시점에 유효했던 단가**로 대조합니다(`resolvePricingAt`) — 그러지 않으면
 * 단가를 한 번 바꿀 때마다 과거 전체가 "불일치"로 보고되고, 그 경보는 곧
 * 무시됩니다.
 */

import type { OcrUnitPrice } from "../ocr/ocr-pricing";

/** 가격표 대상 — LLM 모델 단가와 OCR 엔진 단가 */
export const PRICING_TARGETS = ["llm", "ocr"] as const;

export type PricingTarget = (typeof PRICING_TARGETS)[number];

/**
 * 제안의 단계.
 *
 * `APPLIED`·`REJECTED`는 **끝**입니다 — 다시 하려면 새 제안을 냅니다.
 * 끝난 것을 되살리면 "무엇이 언제 적용됐는가"의 이력이 흐려집니다.
 */
export const PRICING_STAGES = [
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "APPLIED",
  "REJECTED",
] as const;

export type PricingStage = (typeof PRICING_STAGES)[number];

/** 단계를 건너뛸 수 없다 — 검토 없이 승인하거나 승인 없이 적용할 수 없다 */
export const PRICING_TRANSITIONS: Record<PricingStage, PricingStage[]> = {
  DRAFT: ["REVIEWED", "REJECTED"],
  // 검토했는데도 반려할 수 있다 — 검토가 통과를 뜻하지는 않는다
  REVIEWED: ["APPROVED", "REJECTED"],
  // 승인 뒤에도 적용 전이라면 되돌릴 수 있다
  APPROVED: ["APPLIED", "REJECTED"],
  APPLIED: [],
  REJECTED: [],
};

export function nextPricingStages(from: PricingStage): PricingStage[] {
  return PRICING_TRANSITIONS[from];
}

export function canAdvancePricing(
  from: PricingStage,
  to: PricingStage,
): boolean {
  return PRICING_TRANSITIONS[from].includes(to);
}

/**
 * 전이 가능 여부와 **왜 안 되는지**를 함께 돌려준다.
 *
 * 거절 사유가 없으면 사람은 다음에 무엇을 해야 할지 모른 채 같은 요청을
 * 반복합니다.
 */
export function judgePricingTransition(
  from: PricingStage,
  to: PricingStage,
): { ok: boolean; reason: string } {
  if (canAdvancePricing(from, to)) {
    return { ok: true, reason: `${from} → ${to} 진행 가능` };
  }
  if (from === "APPLIED") {
    return {
      ok: false,
      reason:
        "이미 적용된 제안입니다 — 적용 기록은 바꾸지 않습니다. 단가를 되돌리려면 새 제안을 내세요.",
    };
  }
  if (from === "REJECTED") {
    return {
      ok: false,
      reason: "반려된 제안입니다 — 다시 진행하려면 새 제안을 내세요.",
    };
  }
  const allowed = PRICING_TRANSITIONS[from];
  return {
    ok: false,
    reason:
      `${from}에서 ${to}로 갈 수 없습니다 (가능: ${allowed.join(", ") || "없음"}). ` +
      "단가는 검토 → 승인 → 적용 순서를 건너뛸 수 없습니다 (CTO 정책 3101-①).",
  };
}

// ── 제안한 단가의 형식 검사 ─────────────────────────────────

/** LLM 모델 단가 (USD / 1M tokens) */
export interface LlmPriceInput {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** OCR 엔진 단가 (USD / 단위) */
export interface OcrPriceInput {
  perUnitUsd: number;
}

export type ProposedPrice = LlmPriceInput | OcrPriceInput;

const finiteNonNegative = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * 제안된 단가가 쓸 수 있는 값인가 — 문제가 있으면 사유를 돌려준다.
 *
 * **0은 허용합니다**(무료 엔진·무료 모델이 실제로 있습니다). 음수·비숫자는
 * 거부합니다 — 음수 단가는 지출을 줄여 예산 상한을 무력화합니다.
 */
export function validateProposedPrice(
  target: PricingTarget,
  price: unknown,
): string | null {
  if (typeof price !== "object" || price === null) {
    return "단가는 객체여야 합니다.";
  }
  if (target === "llm") {
    const value = price as Partial<LlmPriceInput>;
    if (
      !finiteNonNegative(value.inputPerMillion) ||
      !finiteNonNegative(value.outputPerMillion)
    ) {
      return "LLM 단가는 inputPerMillion·outputPerMillion이 0 이상의 숫자여야 합니다.";
    }
    return null;
  }
  const value = price as Partial<OcrPriceInput>;
  if (!finiteNonNegative(value.perUnitUsd)) {
    return "OCR 단가는 perUnitUsd가 0 이상의 숫자여야 합니다.";
  }
  return null;
}

/**
 * 제안자와 승인자가 같은가 (표시용 경고).
 *
 * **차단하지 않습니다.** 운영자가 한 명인 환경에서 절차 자체가 막히면 사람은
 * 코드를 직접 고쳐 우회하고, 그러면 이력이 아예 없어집니다 — 절차를 정해 두고
 * 코드가 막으면 기록이 끊긴다는 것을 우리는 이미 배웠습니다(결정 2601-①).
 * 대신 **사실을 남깁니다.**
 */
export function selfApprovalWarning(proposal: {
  proposedBy: string | null;
  approvedBy: string | null;
}): string | null {
  if (
    proposal.proposedBy !== null &&
    proposal.approvedBy !== null &&
    proposal.proposedBy === proposal.approvedBy
  ) {
    return `제안자와 승인자가 같습니다 (${proposal.approvedBy}) — 절차는 진행되지만 교차 확인은 이뤄지지 않았습니다.`;
  }
  return null;
}

// ── 적용된 제안 → 실효 가격표 ───────────────────────────────

/** 적용된 단가 1건 (이력) */
export interface AppliedPricing {
  target: PricingTarget;
  /** LLM은 모델 이름, OCR은 엔진 이름 */
  key: string;
  price: ProposedPrice;
  /** 적용 시각 — 시점별 단가 해석의 기준 */
  appliedAt: Date;
}

export interface LlmPricingTable {
  [model: string]: LlmPriceInput;
}

export interface EffectivePricing {
  llm: LlmPricingTable;
  ocr: Record<string, OcrUnitPrice>;
}

/**
 * 기준 가격표에 적용 이력을 덮어 **그 시점의 실효 가격표**를 만든다.
 *
 * `at`을 주면 그 시각까지 적용된 것만 반영합니다 — Append Only 원장(정책
 * 3101-②)과 짝을 이루는 함수입니다. 과거 기록을 **다시 계산하지 않고도**
 * "그때 기준으로 맞았는가"를 물을 수 있어야 합니다.
 *
 * 같은 키에 적용이 여러 번 있으면 **가장 늦게 적용된 것**이 이깁니다.
 */
export function resolvePricingAt(
  defaults: EffectivePricing,
  applied: AppliedPricing[],
  at?: Date,
): EffectivePricing {
  const llm: LlmPricingTable = { ...defaults.llm };
  const ocr: Record<string, OcrUnitPrice> = { ...defaults.ocr };

  const relevant = applied
    .filter((row) => at === undefined || row.appliedAt.getTime() <= at.getTime())
    .slice()
    .sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());

  for (const row of relevant) {
    if (row.target === "llm") {
      const price = row.price as LlmPriceInput;
      llm[row.key] = {
        inputPerMillion: price.inputPerMillion,
        outputPerMillion: price.outputPerMillion,
      };
      continue;
    }
    const price = row.price as OcrPriceInput;
    ocr[row.key] = {
      perUnitUsd: price.perUnitUsd,
      // 어디서 온 단가인지 남긴다 — 코드 기본값과 구분되어야 한다
      note: `승인된 제안으로 적용됨 (${row.appliedAt.toISOString()})`,
    };
  }

  return { llm, ocr };
}

/** 사람이 읽는 단계 이름 */
export const PRICING_STAGE_LABEL: Record<PricingStage, string> = {
  DRAFT: "작성됨",
  REVIEWED: "검토됨",
  APPROVED: "승인됨",
  APPLIED: "적용됨",
  REJECTED: "반려됨",
};

/** 제안 한 건을 한 줄로 — 지금 무엇을 기다리는지 밝힌다 */
export function describePricingProposal(proposal: {
  target: PricingTarget;
  key: string;
  stage: PricingStage;
  price: ProposedPrice;
  currentPrice: ProposedPrice | null;
}): string {
  const to =
    proposal.target === "llm"
      ? `입력 $${(proposal.price as LlmPriceInput).inputPerMillion}/1M · 출력 $${(proposal.price as LlmPriceInput).outputPerMillion}/1M`
      : `단위당 $${(proposal.price as OcrPriceInput).perUnitUsd}`;
  const from =
    proposal.currentPrice === null
      ? "가격표에 없던 항목"
      : proposal.target === "llm"
        ? `입력 $${(proposal.currentPrice as LlmPriceInput).inputPerMillion}/1M · 출력 $${(proposal.currentPrice as LlmPriceInput).outputPerMillion}/1M`
        : `단위당 $${(proposal.currentPrice as OcrPriceInput).perUnitUsd}`;

  const waiting: Record<PricingStage, string> = {
    DRAFT: "검토를 기다립니다",
    REVIEWED: "승인을 기다립니다",
    APPROVED: "적용을 기다립니다",
    APPLIED: "적용되었습니다 — 이후 호출에 이 단가가 쓰입니다",
    REJECTED: "반려되었습니다",
  };

  return (
    `${proposal.target}/${proposal.key}: ${from} → ${to} · ` +
    `${PRICING_STAGE_LABEL[proposal.stage]} — ${waiting[proposal.stage]}`
  );
}
