import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_LLM_PRICING,
  DEFAULT_OCR_PRICING,
  PRICING_STAGES,
  PRICING_TARGETS,
  describePricingProposal,
  judgePricingTransition,
  nextPricingStages,
  resolvePricingAt,
  selfApprovalWarning,
  validateProposedPrice,
} from "@acos/core";
import type {
  AppliedPricing,
  EffectivePricing,
  PricingStage,
  PricingTarget,
  ProposedPrice,
} from "@acos/core";
import type {
  EffectivePricingDto,
  PricingBoardDto,
  PricingProposalDto,
} from "@acos/shared";
import { Prisma, type PricingProposal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 실효 가격표 캐시 수명.
 *
 * 단가는 LLM/OCR **호출마다** 필요하므로 호출당 조회는 낭비다. 그렇다고
 * 프로세스가 살아 있는 동안 영구 캐시하면 **다른 인스턴스에서 적용한 단가가
 * 영원히 반영되지 않는다** — 적용했는데 반영되지 않는 것은 "적용하지 않은
 * 것"과 결과가 같고, 그 사실을 아무도 알아채지 못한다.
 *
 * 그래서 짧은 수명 + **적용 시 즉시 무효화**(같은 프로세스)로 둔다. 다른
 * 인스턴스는 최대 이 시간 안에 따라온다.
 */
export const PRICING_CACHE_TTL_MS = 30_000;

/** 기준 가격표 — 절차를 거치지 않은 코드 기본값 */
const DEFAULTS: EffectivePricing = {
  llm: DEFAULT_LLM_PRICING,
  ocr: DEFAULT_OCR_PRICING,
};

const isTarget = (value: unknown): value is PricingTarget =>
  PRICING_TARGETS.includes(value as PricingTarget);

const isStage = (value: unknown): value is PricingStage =>
  PRICING_STAGES.includes(value as PricingStage);

/** 끝난 제안 — 다시 진행하지 않는다 */
const CLOSED_STAGES: PricingStage[] = ["APPLIED", "REJECTED"];

/**
 * 가격표 거버넌스 서비스. (TASK-3101, Sprint 31 — CTO 정책 3101-①②)
 *
 * 단가는 **검토 → 승인 → 적용** 절차를 거친다. 이 서비스가 하는 일은 둘이다:
 *
 * 1. **제안 이력 관리** — 단계 전이는 `@acos/core`의 순수 판정
 *    (`judgePricingTransition`)이 결정하고, 이 어댑터는 누가 언제 했는지를
 *    기록한다.
 * 2. **실효 가격표 제공** — 적용된 제안이 기준 가격표를 덮은 결과를
 *    LLM/OCR 계산 경로에 넘긴다.
 *
 * **비용 기록은 손대지 않는다**(Append Only, 정책 3101-②). 단가가 바뀌어도
 * 과거 Execution·OcrResult의 `cost`는 그대로다 — 대신 검증이 `effectiveAt`으로
 * **그 시점의 단가**와 대조한다. 과거를 다시 계산하면 "그때 얼마였나"에
 * 답할 수 없게 된다.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private cache: { table: EffectivePricing; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 제안 등록 (DRAFT) — 제안 당시의 유효 단가를 함께 스냅샷한다 */
  async propose(input: {
    target: unknown;
    key: unknown;
    price: unknown;
    reason: unknown;
    actor: string | null;
  }): Promise<PricingProposalDto> {
    if (!isTarget(input.target)) {
      throw new BadRequestException(
        `가격표 대상은 ${PRICING_TARGETS.join(" 또는 ")}입니다.`,
      );
    }
    const key = typeof input.key === "string" ? input.key.trim() : "";
    if (key === "") {
      throw new BadRequestException(
        input.target === "llm"
          ? "모델 이름이 필요합니다."
          : "OCR 엔진 이름이 필요합니다.",
      );
    }
    // 사유 없는 단가 변경은 나중에 되짚을 수 없다 — 돈의 기준이 왜 바뀌었는지가
    // 남지 않으면 이력이 있어도 판단을 복원하지 못한다
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason === "") {
      throw new BadRequestException("변경 사유가 필요합니다.");
    }
    const invalid = validateProposedPrice(input.target, input.price);
    if (invalid !== null) {
      throw new BadRequestException(invalid);
    }

    const current = this.currentPrice(await this.effective(), input.target, key);
    const record = await this.prisma.pricingProposal.create({
      data: {
        target: input.target,
        key,
        price: input.price as Prisma.InputJsonValue,
        // 없던 항목이면 컬럼을 NULL로 남긴다 (Json null 값과 구분된다)
        ...(current === null
          ? {}
          : { currentPrice: current as Prisma.InputJsonValue }),
        reason,
        stage: "DRAFT",
        proposedBy: input.actor,
      },
    });
    this.logger.log(
      `단가 제안 등록: ${input.target}/${key} by ${input.actor ?? "unknown"} — ${reason}`,
    );
    return this.toDto(record);
  }

  /**
   * 단계 전이 — 순서를 건너뛸 수 없다 (정책 3101-①).
   *
   * 적용(`APPLIED`)만 실효 가격표를 바꾼다. 승인은 "적용해도 된다"는 뜻이고,
   * 실제로 계산에 쓰이는 시점은 적용 시각이다 — 둘을 합치면 "언제부터 이
   * 단가로 계산됐나"에 답할 수 없다.
   */
  async advance(
    id: string,
    to: unknown,
    actor: string | null,
    options: { reason?: unknown } = {},
  ): Promise<PricingProposalDto> {
    if (!isStage(to)) {
      throw new BadRequestException(
        `단계는 ${PRICING_STAGES.join(" · ")} 중 하나입니다.`,
      );
    }
    const record = await this.prisma.pricingProposal.findUnique({
      where: { id },
    });
    if (record === null) {
      throw new NotFoundException("단가 제안을 찾을 수 없습니다.");
    }
    const from = this.stageOf(record);
    const judged = judgePricingTransition(from, to);
    if (!judged.ok) {
      throw new BadRequestException(judged.reason);
    }

    const now = new Date();
    const data: Prisma.PricingProposalUpdateInput = { stage: to };
    if (to === "REVIEWED") {
      data.reviewedBy = actor;
      data.reviewedAt = now;
    } else if (to === "APPROVED") {
      data.approvedBy = actor;
      data.approvedAt = now;
    } else if (to === "APPLIED") {
      data.appliedBy = actor;
      data.appliedAt = now;
    } else {
      const reason =
        typeof options.reason === "string" ? options.reason.trim() : "";
      if (reason === "") {
        // 반려는 사람의 판단이다 — 사유가 없으면 제안자는 무엇을 고쳐야
        // 할지 모른 채 같은 제안을 다시 낸다
        throw new BadRequestException("반려 사유가 필요합니다.");
      }
      data.rejectedBy = actor;
      data.rejectedAt = now;
      data.rejectedReason = reason;
    }

    const updated = await this.prisma.pricingProposal
      .update({
        where: {
          id,
          // 조회와 갱신 사이에 다른 요청이 단계를 옮겼다면 갱신하지 않는다 —
          // 두 사람이 동시에 누르면 판정을 거치지 않은 전이가 통과한다
          stage: from,
        },
        data,
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw new BadRequestException(
            `그 사이 다른 요청이 단계를 바꿨습니다 (조회 시 ${from}) — 현재 상태를 다시 확인해 주세요.`,
          );
        }
        throw error;
      });

    if (to === "APPLIED") {
      // 이 프로세스는 즉시 새 단가로 계산한다 (다른 인스턴스는 TTL 안에 따라옴)
      this.cache = null;
      this.logger.warn(
        `단가 적용: ${updated.target}/${updated.key} by ${actor ?? "unknown"} — ` +
          "이후 호출에 이 단가가 쓰입니다. 과거 비용 기록은 바뀌지 않습니다 (정책 3101-②).",
      );
    }
    const warning = selfApprovalWarning({
      proposedBy: updated.proposedBy,
      approvedBy: updated.approvedBy,
    });
    if (warning !== null && to === "APPROVED") {
      // 차단하지 않고 사실을 남긴다 (결정 2601-① 교훈)
      this.logger.warn(`단가 승인 교차 확인 없음: ${warning}`);
    }
    return this.toDto(updated);
  }

  /** 제안 목록 + 실효 가격표 (GET /ops/pricing) */
  async board(): Promise<PricingBoardDto> {
    const records = await this.prisma.pricingProposal.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const proposals = records.map((record) => this.toDto(record));
    const open = proposals.filter(
      (proposal) => !CLOSED_STAGES.includes(proposal.stage),
    );
    const effective = await this.effectiveDto();
    return {
      open,
      closed: proposals.filter((proposal) =>
        CLOSED_STAGES.includes(proposal.stage),
      ),
      effective,
      stages: [...PRICING_STAGES],
      detail:
        `진행 중 ${open.length}건 · 적용 이력 ${effective.appliedCount}건. ` +
        "단가는 검토 → 승인 → 적용 절차를 거칩니다 (CTO 정책 3101-①). " +
        "적용된 단가는 이후 호출에만 쓰이고, 과거 비용 기록은 바뀌지 않습니다 (정책 3101-②).",
      checkedAt: new Date().toISOString(),
    };
  }

  /** 적용 이력 (시점별 단가 해석의 재료) */
  async appliedRows(): Promise<AppliedPricing[]> {
    const records = await this.prisma.pricingProposal.findMany({
      where: { stage: "APPLIED", appliedAt: { not: null } },
      orderBy: { appliedAt: "asc" },
      select: { target: true, key: true, price: true, appliedAt: true },
    });
    const rows: AppliedPricing[] = [];
    for (const record of records) {
      if (!isTarget(record.target) || record.appliedAt === null) {
        continue;
      }
      rows.push({
        target: record.target,
        key: record.key,
        price: record.price as unknown as ProposedPrice,
        appliedAt: record.appliedAt,
      });
    }
    return rows;
  }

  /**
   * 지금 쓰는 실효 가격표 (짧은 캐시).
   *
   * 조회가 실패하면 **기준 가격표로 계산한다** — 단가를 못 읽었다고 비용을
   * null로 남기면 그 호출은 예산 계산에서 빠지고, 예산 상한이 조용히
   * 무력해진다. 미구성과 실패는 다르지만, 둘 다 "계산을 포기할 이유"는
   * 아니다.
   */
  async effective(): Promise<EffectivePricing> {
    const cached = this.cache;
    if (cached !== null && Date.now() - cached.at < PRICING_CACHE_TTL_MS) {
      return cached.table;
    }
    try {
      const table = resolvePricingAt(DEFAULTS, await this.appliedRows());
      this.cache = { table, at: Date.now() };
      return table;
    } catch (error) {
      this.logger.warn(
        `실효 가격표 조회 실패 — 기준 가격표로 계산합니다: ${String(error)}`,
      );
      return DEFAULTS;
    }
  }

  /**
   * 그 시점에 유효했던 가격표 (비용 검증용, 정책 3101-②).
   *
   * 과거 기록을 새 단가로 대조하면 단가를 한 번 바꿀 때마다 과거 전체가
   * "불일치"로 보고되고, 그런 경보는 곧 무시된다.
   */
  async effectiveAt(at: Date): Promise<EffectivePricing> {
    try {
      return resolvePricingAt(DEFAULTS, await this.appliedRows(), at);
    } catch (error) {
      this.logger.warn(
        `시점별 가격표 조회 실패 — 기준 가격표로 대조합니다: ${String(error)}`,
      );
      return DEFAULTS;
    }
  }

  /**
   * 시점별 가격표 해석 함수 (비용 검증용, 정책 3101-②).
   *
   * 적용 이력을 **한 번만 읽고** 표본마다 그 시점의 표를 만든다 — 표본 하나당
   * 조회하면 1,000건 검증이 1,000번 질의가 된다.
   */
  async resolvers(): Promise<{
    llm: (at: string) => EffectivePricing["llm"];
    ocr: (at: string) => EffectivePricing["ocr"];
  }> {
    const applied = await this.appliedRows().catch((error: unknown) => {
      this.logger.warn(
        `적용 이력 조회 실패 — 기준 가격표로 대조합니다: ${String(error)}`,
      );
      return [] as AppliedPricing[];
    });
    const at = (when: string): EffectivePricing => {
      const parsed = new Date(when);
      return resolvePricingAt(
        DEFAULTS,
        applied,
        // 시각을 못 읽으면 지금 기준으로 본다 — 대조를 건너뛰지는 않는다
        Number.isNaN(parsed.getTime()) ? undefined : parsed,
      );
    };
    return {
      llm: (when) => at(when).llm,
      ocr: (when) => at(when).ocr,
    };
  }

  /**
   * 실효 가격표 응답 형태.
   *
   * 각 줄에 **출처**를 함께 낸다 — 승인된 제안으로 적용된 단가와 코드 기본값이
   * 화면에서 구분되지 않으면 "이 금액은 누가 정했나"에 답할 수 없다. OCR은
   * 단가 자체가 출처를 들고 있고(`note`), LLM은 적용 이력에서 만든다.
   */
  async effectiveDto(): Promise<EffectivePricingDto> {
    const [table, applied] = await Promise.all([
      this.effective(),
      this.appliedRows(),
    ]);
    const last = applied.at(-1) ?? null;
    const llmApplied = new Map<string, Date>();
    for (const row of applied) {
      if (row.target === "llm") {
        llmApplied.set(row.key, row.appliedAt);
      }
    }
    return {
      llm: Object.entries(table.llm)
        .map(([model, price]) => {
          const at = llmApplied.get(model);
          return {
            model,
            ...price,
            note:
              at === undefined
                ? "코드 기본값 — 승인 이력이 없습니다"
                : `승인된 제안으로 적용됨 (${at.toISOString()})`,
          };
        })
        .sort((a, b) => a.model.localeCompare(b.model)),
      ocr: Object.entries(table.ocr)
        .map(([provider, price]) => ({ provider, ...price }))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      appliedCount: applied.length,
      lastAppliedAt: last === null ? null : last.appliedAt.toISOString(),
    };
  }

  /** 가격표에서 해당 항목의 현재 단가 (없으면 null) */
  private currentPrice(
    table: EffectivePricing,
    target: PricingTarget,
    key: string,
  ): Record<string, number> | null {
    if (target === "llm") {
      const price = table.llm[key];
      return price === undefined
        ? null
        : {
            inputPerMillion: price.inputPerMillion,
            outputPerMillion: price.outputPerMillion,
          };
    }
    const price = table.ocr[key];
    return price === undefined ? null : { perUnitUsd: price.perUnitUsd };
  }

  /** 저장된 문자열을 단계로 — 알 수 없는 값은 DRAFT로 두지 않고 드러낸다 */
  private stageOf(record: PricingProposal): PricingStage {
    if (!isStage(record.stage)) {
      throw new BadRequestException(
        `알 수 없는 단계입니다: ${record.stage} — 데이터를 확인해 주세요.`,
      );
    }
    return record.stage;
  }

  private toDto(record: PricingProposal): PricingProposalDto {
    const stage = this.stageOf(record);
    const target = isTarget(record.target) ? record.target : "llm";
    const price = record.price as unknown as Record<string, number>;
    const currentPrice =
      record.currentPrice === null
        ? null
        : (record.currentPrice as unknown as Record<string, number>);
    return {
      id: record.id,
      target,
      key: record.key,
      price,
      currentPrice,
      reason: record.reason,
      stage,
      nextStages: nextPricingStages(stage),
      proposedBy: record.proposedBy,
      reviewedBy: record.reviewedBy,
      reviewedAt: record.reviewedAt?.toISOString() ?? null,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt?.toISOString() ?? null,
      appliedBy: record.appliedBy,
      appliedAt: record.appliedAt?.toISOString() ?? null,
      rejectedBy: record.rejectedBy,
      rejectedAt: record.rejectedAt?.toISOString() ?? null,
      rejectedReason: record.rejectedReason,
      selfApproval: selfApprovalWarning({
        proposedBy: record.proposedBy,
        approvedBy: record.approvedBy,
      }),
      detail: describePricingProposal({
        target,
        key: record.key,
        stage,
        price: price as unknown as ProposedPrice,
        currentPrice: currentPrice as unknown as ProposedPrice | null,
      }),
      createdAt: record.createdAt.toISOString(),
    };
  }
}
