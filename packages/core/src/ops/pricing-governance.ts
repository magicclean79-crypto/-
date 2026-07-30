/**
 * 가격표 변경 거버넌스. (TASK-3101 · 3201 — CTO 정책 3101-①② · 3201-①②③)
 *
 * 단가는 **검토 → 승인 → 적용** 절차를 거칩니다. 시스템이 찾아낸 변화는
 * **감지 → 승인 → 적용**입니다(정책 3201-①) — 감지가 검토를 대신하고,
 * **승인과 적용은 언제나 사람이** 합니다.
 *
 * 운영에서는 **제안자와 승인자가 같을 수 없습니다**(정책 3201-②). 적용 시각과
 * **발효 시각**은 다른 값입니다(정책 3201-③) — 적용은 결정이고 발효는 시각입니다.
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
 * 제안의 출처. (TASK-3201, CTO 정책 3201-①)
 *
 * | 출처 | 절차 |
 * | --- | --- |
 * | `manual` | 사람이 낸 제안 — **작성 → 검토 → 승인 → 적용** (정책 3101-①) |
 * | `detected` | 시스템이 찾아낸 변화 — **감지 → 승인 → 적용** (정책 3201-①) |
 *
 * 감지가 **검토를 대신합니다**: 근거(무엇을 보고 그렇게 판단했는지)가 제안에
 * 붙어 있으므로 사람은 그 근거를 보고 승인만 하면 됩니다. 감지에 다시 "검토"
 * 단계를 붙이면 자동화가 만든 일을 사람이 두 번 눌러야 하고, 두 번 누르는
 * 절차는 곧 아무도 읽지 않는 절차가 됩니다.
 *
 * **감지는 적용이 아닙니다.** 자동화는 제안까지만 만듭니다 — Provider 쪽
 * 일시적 이상이나 우리 계산 오류가 곧바로 **돈의 기준**을 바꿔서는 안 됩니다.
 */
export const PRICING_ORIGINS = ["manual", "detected"] as const;

export type PricingOrigin = (typeof PRICING_ORIGINS)[number];

/**
 * 제안의 단계.
 *
 * `APPLIED`·`REJECTED`는 **끝**입니다 — 다시 하려면 새 제안을 냅니다.
 * 끝난 것을 되살리면 "무엇이 언제 적용됐는가"의 이력이 흐려집니다.
 */
export const PRICING_STAGES = [
  /** 시스템이 찾아낸 변화 (TASK-3201) — 사람의 승인을 기다린다 */
  "DETECTED",
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "APPLIED",
  "REJECTED",
] as const;

export type PricingStage = (typeof PRICING_STAGES)[number];

/** 출처별 시작 단계 — 자동화는 `DETECTED`에서, 사람은 `DRAFT`에서 시작한다 */
export function startStage(origin: PricingOrigin): PricingStage {
  return origin === "detected" ? "DETECTED" : "DRAFT";
}

/** 단계를 건너뛸 수 없다 — 검토 없이 승인하거나 승인 없이 적용할 수 없다 */
export const PRICING_TRANSITIONS: Record<PricingStage, PricingStage[]> = {
  // 감지 → 승인 → 적용 (정책 3201-①). 감지 자체가 근거를 들고 있으므로
  // 검토 단계를 다시 요구하지 않는다 — 다만 **승인은 사람이** 한다
  DETECTED: ["APPROVED", "REJECTED"],
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
      "단가는 검토 → 승인 → 적용 순서를 건너뛸 수 없습니다 (CTO 정책 3101-①). " +
      "감지된 제안은 감지 → 승인 → 적용입니다 (CTO 정책 3201-①).",
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
 * 교차 확인 판정. (TASK-3201, CTO 정책 3201-②)
 *
 * **Production에서는 제안자와 승인자가 같을 수 없습니다.** Development에서는
 * Self Approval을 허용하고 사실만 남깁니다.
 *
 * 환경에 따라 다르게 두는 이유: 운영에서 단가는 **실제 돈의 기준**이므로 한
 * 사람의 오타가 예산 전체를 흔듭니다. 반면 개발에서 절차 자체가 막히면 사람은
 * 코드를 직접 고쳐 우회하고, 그러면 이력이 아예 없어집니다(결정 2601-① 교훈) —
 * 그래서 **막는 곳과 기록하는 곳을 환경으로 가릅니다.**
 *
 * 환경은 **인자로 받습니다** — core가 `process.env`를 읽으면 같은 판정이
 * 테스트에서 재현되지 않습니다.
 *
 * `proposedBy`가 `null`인 제안(감지된 제안 — 제안자가 사람이 아님)은 같을 수가
 * 없으므로 통과합니다. 이 경우 승인자 한 사람의 판단으로 진행된다는 사실은
 * `describeSelfApproval`이 밝힙니다.
 */
export interface SelfApprovalJudgment {
  /** 진행할 수 있는가 — Production에서 같으면 false */
  allowed: boolean;
  /** `blocked`(차단) · `warning`(허용하되 기록) · null(해당 없음) */
  level: "blocked" | "warning" | null;
  message: string | null;
}

export function judgeSelfApproval(input: {
  proposedBy: string | null;
  approvedBy: string | null;
  /** `production`이면 차단, 그 외에는 경고 */
  environment: string | undefined;
}): SelfApprovalJudgment {
  const same =
    input.proposedBy !== null &&
    input.approvedBy !== null &&
    input.proposedBy === input.approvedBy;
  if (!same) {
    return { allowed: true, level: null, message: null };
  }
  const production =
    (input.environment ?? "").trim().toLowerCase() === "production";
  if (production) {
    return {
      allowed: false,
      level: "blocked",
      message:
        `제안자와 승인자가 같습니다 (${input.approvedBy}) — 운영에서는 자기 승인을 허용하지 않습니다 ` +
        "(CTO 정책 3201-②). 다른 ADMIN 계정으로 승인해 주세요.",
    };
  }
  return {
    allowed: true,
    level: "warning",
    message:
      `제안자와 승인자가 같습니다 (${input.approvedBy}) — 개발 환경이라 진행하지만 ` +
      "교차 확인은 이뤄지지 않았습니다. 운영에서는 차단됩니다 (CTO 정책 3201-②).",
  };
}

/** 표시용 문구 — 감지된 제안의 승인도 사람 한 명의 판단임을 밝힌다 */
export function describeSelfApproval(proposal: {
  origin: PricingOrigin;
  proposedBy: string | null;
  approvedBy: string | null;
  environment: string | undefined;
}): string | null {
  const judged = judgeSelfApproval(proposal);
  if (judged.message !== null) {
    return judged.message;
  }
  if (proposal.origin === "detected" && proposal.approvedBy !== null) {
    // 제안자가 시스템이므로 교차 확인 판정은 통과하지만, 사람의 눈은 하나다 —
    // 그 사실을 숨기면 "두 사람이 봤다"로 읽힌다
    return `감지된 제안을 ${proposal.approvedBy}이(가) 승인했습니다 — 제안자가 시스템이므로 사람의 확인은 1회입니다.`;
  }
  return null;
}

// ── 미래 시점 적용 (Effective From) ─────────────────────────

/**
 * 적용 예약의 최대 기간. (TASK-3201, CTO 정책 3201-③)
 *
 * 1년을 넘겨 예약한 단가는 예약이 아니라 **잊혀진 설정**입니다 — 그때가 오면
 * 아무도 왜 바뀌는지 모릅니다.
 */
export const EFFECTIVE_FROM_MAX_DAYS = 365;

/**
 * 시계 오차 허용 폭.
 *
 * 화면이 "지금"으로 보낸 시각이 서버보다 몇 초 뒤일 수 있습니다. 그 정도를
 * 과거로 보고 거부하면 즉시 적용이 이유 없이 실패합니다.
 */
export const EFFECTIVE_FROM_GRACE_MS = 60_000;

/**
 * 예약 시각이 쓸 수 있는 값인가 — 문제가 있으면 사유를 돌려준다.
 *
 * **과거 시점은 거부합니다.** 과거로 발효시키면 그 사이에 이미 기록된 비용을
 * **소급해 다시 해석**하게 되고, 어제까지 맞았던 기록이 오늘 갑자기 "불일치"가
 * 됩니다 — 비용 기록은 수정하지 않는다는 정책(3101-②)이 무의미해집니다.
 */
export function validateEffectiveFrom(
  effectiveFrom: Date | null | undefined,
  now: Date,
): string | null {
  if (effectiveFrom === null || effectiveFrom === undefined) {
    return null; // 미지정 = 즉시 적용
  }
  const at = effectiveFrom.getTime();
  if (!Number.isFinite(at)) {
    return "적용 시각을 해석할 수 없습니다.";
  }
  if (at < now.getTime() - EFFECTIVE_FROM_GRACE_MS) {
    return (
      "과거 시점으로 적용할 수 없습니다 — 이미 기록된 비용을 소급해 다시 " +
      "해석하게 되고, 그러면 맞았던 기록이 불일치로 바뀝니다 (CTO 정책 3101-②). " +
      "즉시 적용하려면 시각을 비워 두세요."
    );
  }
  const maxAt = now.getTime() + EFFECTIVE_FROM_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (at > maxAt) {
    return `적용 예약은 최대 ${EFFECTIVE_FROM_MAX_DAYS}일 뒤까지입니다 — 그보다 먼 예약은 그때가 되면 아무도 이유를 모릅니다.`;
  }
  return null;
}

/** 예약 여부와 시각을 한 줄로 */
export function describeEffectiveFrom(
  effectiveFrom: Date,
  now: Date,
): string {
  return effectiveFrom.getTime() > now.getTime()
    ? `${effectiveFrom.toISOString()}부터 적용 예정 — 그때까지는 이전 단가로 계산합니다`
    : `${effectiveFrom.toISOString()}부터 적용됨`;
}

// ── 적용된 제안 → 실효 가격표 ───────────────────────────────

/** 적용된 단가 1건 (이력) */
export interface AppliedPricing {
  target: PricingTarget;
  /** LLM은 모델 이름, OCR은 엔진 이름 */
  key: string;
  price: ProposedPrice;
  /** 적용을 결정한 시각 (사람이 누른 시각 — 이력) */
  appliedAt: Date;
  /**
   * **발효 시각** — 시점별 단가 해석의 기준 (TASK-3201, CTO 정책 3201-③).
   *
   * `appliedAt`과 나눈 이유: **적용은 결정이고 발효는 시각**입니다. Provider
   * 공지가 "8월 1일부터"라면 결정은 오늘 하고 발효는 8월 1일이어야 하며, 둘을
   * 한 값으로 두면 그날 사람이 잊지 않고 눌러 주기를 바라는 수밖에 없습니다.
   */
  effectiveFrom: Date;
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
 * `at`을 주면 그 시각까지 **발효된** 것만 반영합니다 — Append Only 원장(정책
 * 3101-②)과 짝을 이루는 함수입니다. 과거 기록을 **다시 계산하지 않고도**
 * "그때 기준으로 맞았는가"를 물을 수 있어야 합니다.
 *
 * 기준은 `appliedAt`이 아니라 **`effectiveFrom`**입니다 (TASK-3201, 정책
 * 3201-③) — 미래 발효로 예약된 단가는 그 시각이 오기 전까지 아무 계산에도
 * 쓰이지 않습니다. `at`을 주지 않으면 예약분까지 전부 반영되므로, 호출부는
 * **반드시 지금 시각을 넘겨야** 합니다.
 *
 * 같은 키에 적용이 여러 번 있으면 **가장 늦게 발효된 것**이 이깁니다.
 */
export function resolvePricingAt(
  defaults: EffectivePricing,
  applied: AppliedPricing[],
  at?: Date,
): EffectivePricing {
  const llm: LlmPricingTable = { ...defaults.llm };
  const ocr: Record<string, OcrUnitPrice> = { ...defaults.ocr };

  const relevant = applied
    .filter(
      (row) => at === undefined || row.effectiveFrom.getTime() <= at.getTime(),
    )
    .slice()
    .sort(
      (a, b) =>
        a.effectiveFrom.getTime() - b.effectiveFrom.getTime() ||
        // 같은 시각에 발효된 것이 둘이면 늦게 결정된 것이 이긴다
        a.appliedAt.getTime() - b.appliedAt.getTime(),
    );

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
      // 어디서 온 단가인지 남긴다 — 코드 기본값과 구분되어야 한다.
      // 기준은 **발효 시각**이다 (정책 3201-③): 결정 시각을 적으면 예약된
      // 단가가 "언제부터 이 값이었나"를 잘못 말한다
      note: `승인된 제안으로 적용됨 (${row.effectiveFrom.toISOString()})`,
    };
  }

  return { llm, ocr };
}

/**
 * 다음으로 가격표가 바뀌는 시각 — 없으면 null. (TASK-3201, CTO 정책 3201-⑤)
 *
 * 실효 가격표를 캐시할 때 **이 시각을 넘겨 캐시하면 예약이 무시됩니다** —
 * 8월 1일 0시부터 발효될 단가가 캐시 때문에 0시 5분까지 반영되지 않으면,
 * 그 5분 동안 기록된 비용은 아무도 설명할 수 없습니다.
 */
export function nextPricingChangeAt(
  applied: AppliedPricing[],
  now: Date,
): Date | null {
  const future = applied
    .map((row) => row.effectiveFrom)
    .filter((at) => at.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return future[0] ?? null;
}

/** 사람이 읽는 단계 이름 */
export const PRICING_STAGE_LABEL: Record<PricingStage, string> = {
  DETECTED: "감지됨",
  DRAFT: "작성됨",
  REVIEWED: "검토됨",
  APPROVED: "승인됨",
  APPLIED: "적용됨",
  REJECTED: "반려됨",
};

/** 사람이 읽는 출처 이름 */
export const PRICING_ORIGIN_LABEL: Record<PricingOrigin, string> = {
  manual: "직접 제안",
  detected: "자동 감지",
};

/** 제안 한 건을 한 줄로 — 지금 무엇을 기다리는지 밝힌다 */
export function describePricingProposal(proposal: {
  target: PricingTarget;
  key: string;
  stage: PricingStage;
  price: ProposedPrice;
  currentPrice: ProposedPrice | null;
  /** 미래 발효로 예약된 경우 그 시각 (TASK-3201) */
  effectiveFrom?: Date | null;
  now?: Date;
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

  const now = proposal.now ?? new Date();
  const scheduled =
    proposal.effectiveFrom != null &&
    proposal.effectiveFrom.getTime() > now.getTime();

  const waiting: Record<PricingStage, string> = {
    // 감지는 근거를 들고 오지만 결정은 사람이 한다 (정책 3201-①)
    DETECTED: "승인을 기다립니다 (자동 감지 — 근거를 확인하세요)",
    DRAFT: "검토를 기다립니다",
    REVIEWED: "승인을 기다립니다",
    APPROVED: "적용을 기다립니다",
    APPLIED: scheduled
      ? // 적용은 결정이고 발효는 시각이다 — "적용됨"만 적으면 이미 그 단가로
        // 계산되는 줄 알고 기록을 잘못 읽는다 (정책 3201-③)
        `적용되었습니다 — ${proposal.effectiveFrom!.toISOString()}부터 이 단가가 쓰입니다 (예약)`
      : "적용되었습니다 — 이후 호출에 이 단가가 쓰입니다",
    REJECTED: "반려되었습니다",
  };

  return (
    `${proposal.target}/${proposal.key}: ${from} → ${to} · ` +
    `${PRICING_STAGE_LABEL[proposal.stage]} — ${waiting[proposal.stage]}`
  );
}
