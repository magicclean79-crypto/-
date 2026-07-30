import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import {
  DEFAULT_LLM_PRICING,
  DEFAULT_OCR_PRICING,
  PRICING_ORIGINS,
  PRICING_STAGES,
  PRICING_TARGETS,
  detectPriceChanges,
  describePricingProposal,
  describeSelfApproval,
  judgePricingTransition,
  judgeSelfApproval,
  nextPricingChangeAt,
  nextPricingStages,
  resolvePricingAt,
  startStage,
  validateEffectiveFrom,
  validateProposedPrice,
} from "@acos/core";
import type {
  AppliedPricing,
  DetectedPriceChange,
  EffectivePricing,
  PricingOrigin,
  PricingStage,
  PricingTarget,
  ProposedPrice,
  UnresolvedPriceSignal,
} from "@acos/core";
import type {
  EffectivePricingDto,
  PricingBoardDto,
  PricingProposalDto,
} from "@acos/shared";
import { Prisma, type PricingProposal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PricingCacheBus } from "./pricing-cache.bus";

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

/**
 * 감지가 보는 기간. (TASK-3201, CTO 정책 3201-①)
 *
 * 최소 표본(5건)을 채워야 판단하므로 24시간으로 두면 호출이 드문 환경에서는
 * 영원히 감지되지 않습니다. 반대로 너무 길게 잡으면 옛 단가 기록이 섞입니다 —
 * 다만 감지는 **최근 표본이 한 값으로 모일 때만** 판단하므로 기간이 길어도
 * 잘못된 값을 만들지는 않습니다.
 */
export const PRICE_DETECTION_WINDOW_HOURS = 24 * 7;

/** 한 번에 읽는 표본 수 — 최신순이므로 앞쪽이 지금 단가다 */
export const PRICE_DETECTION_SAMPLE_LIMIT = 200;

/** 기준 가격표 — 절차를 거치지 않은 코드 기본값 */
const DEFAULTS: EffectivePricing = {
  llm: DEFAULT_LLM_PRICING,
  ocr: DEFAULT_OCR_PRICING,
};

const isTarget = (value: unknown): value is PricingTarget =>
  PRICING_TARGETS.includes(value as PricingTarget);

const isStage = (value: unknown): value is PricingStage =>
  PRICING_STAGES.includes(value as PricingStage);

const isOrigin = (value: unknown): value is PricingOrigin =>
  PRICING_ORIGINS.includes(value as PricingOrigin);

/** 아직 끝나지 않은 제안 — 같은 항목에 두 개를 만들지 않기 위한 기준 */
const OPEN_STAGES: PricingStage[] = [
  "DETECTED",
  "DRAFT",
  "REVIEWED",
  "APPROVED",
];

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
export class PricingService implements OnModuleInit {
  private readonly logger = new Logger(PricingService.name);
  /**
   * 캐시는 **만료 시각**을 들고 있다 (TASK-3201).
   *
   * 수명(TTL)뿐 아니라 **다음 발효 시각**도 만료로 본다 — 8월 1일 0시부터
   * 발효될 단가가 캐시 때문에 0시 5분까지 반영되지 않으면, 그 5분 동안 기록된
   * 비용은 아무도 설명할 수 없다 (정책 3201-③).
   */
  private cache: { table: EffectivePricing; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // 적용 즉시 다른 인스턴스의 캐시도 버린다 (정책 3201-⑤)
    @Optional() private readonly bus?: PricingCacheBus,
  ) {}

  onModuleInit(): void {
    this.bus?.onInvalidate((reason) => {
      // 다른 인스턴스가 적용했다 — 다음 호출부터 새 단가로 계산한다
      this.cache = null;
      this.logger.log(`가격표 캐시를 버렸습니다 (${reason})`);
    });
  }

  /** 지금 이 환경 — 자기 승인 판정에 쓴다 (정책 3201-②) */
  private get environment(): string | undefined {
    return process.env.NODE_ENV;
  }

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
    options: { reason?: unknown; effectiveFrom?: unknown } = {},
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
      // 운영에서는 제안자와 승인자가 같을 수 없다 (CTO 정책 3201-②).
      // 개발에서는 허용하고 사실만 남긴다 — 절차가 막히면 사람은 코드를
      // 고쳐 우회하고, 그러면 이력이 아예 없어진다 (결정 2601-① 교훈)
      const judgedSelf = judgeSelfApproval({
        proposedBy: record.proposedBy,
        approvedBy: actor,
        environment: this.environment,
      });
      if (!judgedSelf.allowed) {
        throw new BadRequestException(judgedSelf.message ?? "자기 승인은 허용되지 않습니다.");
      }
      if (judgedSelf.level === "warning") {
        this.logger.warn(`단가 승인 교차 확인 없음: ${judgedSelf.message}`);
      }
      data.approvedBy = actor;
      data.approvedAt = now;
    } else if (to === "APPLIED") {
      // **적용은 결정이고 발효는 시각이다** (CTO 정책 3201-③).
      // 미지정이면 즉시 발효한다 — 예약은 명시적으로만 한다.
      const requested = this.parseEffectiveFrom(options.effectiveFrom);
      const invalidFrom = validateEffectiveFrom(requested, now);
      if (invalidFrom !== null) {
        throw new BadRequestException(invalidFrom);
      }
      data.appliedBy = actor;
      data.appliedAt = now;
      data.effectiveFrom = requested ?? now;
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
      // **적용 즉시 캐시를 버린다** (CTO 정책 3201-⑤) — 이 프로세스는 곧바로,
      // 다른 인스턴스는 버스 신호로. 발행이 실패하면 로그가 그 사실을 말한다.
      await this.invalidate(
        `applied ${updated.target}/${updated.key} by ${actor ?? "unknown"}`,
      );
      const scheduled =
        updated.effectiveFrom !== null &&
        updated.effectiveFrom.getTime() > now.getTime();
      this.logger.warn(
        `단가 적용: ${updated.target}/${updated.key} by ${actor ?? "unknown"} — ` +
          (scheduled
            ? `${updated.effectiveFrom!.toISOString()}부터 이 단가가 쓰입니다 (예약). `
            : "이후 호출에 이 단가가 쓰입니다. ") +
          "과거 비용 기록은 바뀌지 않습니다 (정책 3101-②).",
      );
    }
    return this.toDto(updated);
  }

  /**
   * 캐시를 버리고 다른 인스턴스에도 알린다. (CTO 정책 3201-⑤)
   *
   * 이 프로세스는 **즉시** 반영되고, 다른 인스턴스는 버스 신호로 반영된다.
   * 버스가 없으면(단일 인스턴스 모드) 알릴 상대가 없다 — 미구성은 실패가
   * 아니지만, 다중 인스턴스인데 단일 모드로 돌고 있으면 그것이 사고다.
   */
  private async invalidate(reason: string): Promise<void> {
    this.cache = null;
    await this.bus?.publish(reason);
  }

  /** 요청된 발효 시각 — 형식이 틀리면 조용히 즉시로 돌리지 않는다 */
  private parseEffectiveFrom(value: unknown): Date | null {
    if (value === undefined || value === null || value === "") {
      return null; // 즉시 발효
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value !== "string") {
      throw new BadRequestException("적용 시각은 ISO 문자열이어야 합니다.");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      // 잘못된 값을 즉시 적용으로 바꾸면 예약한 줄 알고 화면을 닫는다
      throw new BadRequestException(
        `적용 시각을 해석할 수 없습니다: ${value} (예: 2026-08-01T00:00:00.000Z)`,
      );
    }
    return parsed;
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
        `진행 중 ${open.length}건 · 발효된 적용 이력 ${effective.appliedCount}건` +
        (effective.scheduled.length > 0
          ? ` · 예약 ${effective.scheduled.length}건`
          : "") +
        ". 단가는 검토 → 승인 → 적용 절차를 거치고, 감지된 변경은 감지 → 승인 → 적용입니다 " +
        "(CTO 정책 3101-① · 3201-①). 감지만으로는 단가가 바뀌지 않습니다. " +
        "적용된 단가는 이후 호출에만 쓰이고, 과거 비용 기록은 바뀌지 않습니다 (정책 3101-②).",
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 적용 이력 (시점별 단가 해석의 재료).
   *
   * **예약분도 함께 돌려준다** — 걸러내는 것은 해석 함수의 일이다
   * (`resolvePricingAt(defaults, rows, now)`). 여기서 미리 걸러내면 "다음
   * 발효 시각"을 알 수 없어 캐시가 예약을 지나쳐 버린다 (정책 3201-③⑤).
   */
  async appliedRows(): Promise<AppliedPricing[]> {
    const records = await this.prisma.pricingProposal.findMany({
      where: { stage: "APPLIED", appliedAt: { not: null } },
      orderBy: { appliedAt: "asc" },
      select: {
        target: true,
        key: true,
        price: true,
        appliedAt: true,
        effectiveFrom: true,
      },
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
        // 발효 시각이 없는 기록은 즉시 적용이던 시절의 것이다 (마이그레이션이
        // 채워 두지만, 방어적으로 결정 시각을 발효 시각으로 본다)
        effectiveFrom: record.effectiveFrom ?? record.appliedAt,
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
    const now = new Date();
    const cached = this.cache;
    if (cached !== null && now.getTime() < cached.expiresAt) {
      return cached.table;
    }
    try {
      const applied = await this.appliedRows();
      // **지금 시각을 넘긴다** — 넘기지 않으면 미래 발효로 예약된 단가가
      // 오늘의 계산에 쓰인다 (정책 3201-③)
      const table = resolvePricingAt(DEFAULTS, applied, now);
      // 캐시는 수명과 **다음 발효 시각** 중 이른 쪽에 만료된다 (정책 3201-⑤) —
      // 예약을 지나쳐 캐시하면 발효 순간이 조용히 늦어진다
      const boundary = nextPricingChangeAt(applied, now);
      const expiresAt = Math.min(
        now.getTime() + PRICING_CACHE_TTL_MS,
        boundary?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      this.cache = { table, expiresAt };
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

  // ── 가격 변경 감지 (CTO 정책 3201-①) ───────────────────────

  /**
   * 기록과 가격표를 대조해 **변경을 감지하고 제안을 만든다.**
   *
   * **감지는 적용이 아니다.** 이 메서드는 `DETECTED` 제안까지만 만들고,
   * 승인·적용은 사람이 합니다 — Provider 쪽 일시적 이상이나 우리 계산 오류가
   * 곧바로 돈의 기준을 바꾸면 그 뒤의 모든 숫자가 설명 불가능해집니다.
   *
   * 같은 항목에 **진행 중인 제안이 있으면 새로 만들지 않습니다** — 6시간마다
   * 같은 제안이 쌓이면 목록이 소음이 되고, 승인해야 할 것이 무엇인지 흐려집니다.
   */
  async detect(
    options: { windowHours?: number; actor?: string | null } = {},
  ): Promise<{
    changes: DetectedPriceChange[];
    unresolved: UnresolvedPriceSignal[];
    /** 이번에 만든 제안 */
    created: PricingProposalDto[];
    /** 이미 진행 중인 제안이 있어 만들지 않은 항목 */
    skipped: string[];
    checked: number;
    detail: string;
  }> {
    const windowHours = options.windowHours ?? PRICE_DETECTION_WINDOW_HOURS;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [ocrRows, llmRows, pricing, applied] = await Promise.all([
      this.prisma.ocrResult.findMany({
        where: { status: "SUCCESS", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: PRICE_DETECTION_SAMPLE_LIMIT,
        select: {
          id: true,
          provider: true,
          units: true,
          cost: true,
          createdAt: true,
        },
      }),
      this.prisma.execution.findMany({
        where: { status: "SUCCESS", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: PRICE_DETECTION_SAMPLE_LIMIT,
        select: {
          id: true,
          provider: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cost: true,
          createdAt: true,
        },
      }),
      this.effective(),
      this.appliedRows(),
    ]);

    // **지금 단가가 발효된 시각 이후의 기록만** 본다 (TASK-3201).
    // 적용 직전의 기록은 옛 단가를 들고 있는 것이 당연하고(Append Only),
    // 그것을 불일치로 세면 적용할 때마다 "되돌리자"는 제안이 생긴다.
    const inForceFrom: { llm: Record<string, string>; ocr: Record<string, string> } =
      { llm: {}, ocr: {} };
    for (const row of applied) {
      if (row.effectiveFrom.getTime() > Date.now()) {
        continue; // 아직 발효되지 않은 예약분
      }
      const iso = row.effectiveFrom.toISOString();
      const table = inForceFrom[row.target];
      // 같은 항목에 여러 번 적용됐으면 **가장 늦게 발효된 것**이 기준이다
      if (table[row.key] === undefined || table[row.key] < iso) {
        table[row.key] = iso;
      }
    }

    const result = detectPriceChanges({
      ocr: ocrRows.map((row) => ({
        id: row.id,
        provider: row.provider,
        units: row.units,
        cost: row.cost === null ? null : Number(row.cost),
        createdAt: row.createdAt.toISOString(),
      })),
      llm: llmRows.map((row) => ({
        id: row.id,
        provider: row.provider,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cost: row.cost === null ? null : Number(row.cost),
        createdAt: row.createdAt.toISOString(),
      })),
      pricing: { llm: pricing.llm, ocr: pricing.ocr },
      inForceFrom,
    });

    const created: PricingProposalDto[] = [];
    const skipped: string[] = [];
    for (const change of result.changes) {
      const open = await this.prisma.pricingProposal.findFirst({
        where: {
          target: change.target,
          key: change.key,
          stage: { in: OPEN_STAGES },
        },
      });
      if (open !== null) {
        // 이미 사람이 봐야 할 제안이 있다 — 같은 것을 또 만들지 않는다
        skipped.push(`${change.target}/${change.key}`);
        continue;
      }
      const record = await this.prisma.pricingProposal.create({
        data: {
          target: change.target,
          key: change.key,
          price: change.impliedPrice as Prisma.InputJsonValue,
          currentPrice: change.currentPrice as Prisma.InputJsonValue,
          reason: change.reason,
          origin: "detected",
          stage: startStage("detected"),
          // **제안자는 사람이 아니다** — null로 남긴다. 사람 이름을 적으면
          // 자동화가 만든 제안을 그 사람이 낸 것으로 읽는다
          proposedBy: null,
          evidence: change.evidence as unknown as Prisma.InputJsonValue,
        },
      });
      created.push(this.toDto(record));
      this.logger.warn(
        `단가 변경 감지: ${change.target}/${change.key} ` +
          `$${change.currentPrice.perUnitUsd} → $${change.impliedPrice.perUnitUsd} ` +
          `(표본 ${change.samples}건) — 제안을 등록했습니다. 승인 후 적용됩니다 (정책 3201-①).`,
      );
    }

    return {
      ...result,
      created,
      skipped,
      detail:
        `${result.detail} 제안 ${created.length}건 등록` +
        (skipped.length > 0
          ? ` · 이미 진행 중인 제안이 있어 건너뜀 ${skipped.length}건 (${skipped.join(", ")})`
          : ""),
    };
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
    const now = new Date();
    const [table, applied] = await Promise.all([
      this.effective(),
      this.appliedRows(),
    ]);
    // **발효된 것과 예약된 것을 가른다** (정책 3201-③) — 섞으면 예약된 단가가
    // 이미 쓰이는 것처럼 보이고, 기록을 잘못 읽게 된다
    const inForce = applied.filter(
      (row) => row.effectiveFrom.getTime() <= now.getTime(),
    );
    const upcoming = applied
      .filter((row) => row.effectiveFrom.getTime() > now.getTime())
      .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

    const last = inForce
      .slice()
      .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
      .at(-1);
    const llmInForce = new Map<string, Date>();
    for (const row of inForce) {
      if (row.target === "llm") {
        llmInForce.set(row.key, row.effectiveFrom);
      }
    }
    return {
      llm: Object.entries(table.llm)
        .map(([model, price]) => {
          const at = llmInForce.get(model);
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
      appliedCount: inForce.length,
      lastAppliedAt: last === undefined ? null : last.effectiveFrom.toISOString(),
      // 예약된 변경 — 언제 무엇이 바뀔지 미리 보여 준다 (TASK-3201)
      scheduled: upcoming.map((row) => ({
        target: row.target,
        key: row.key,
        price: row.price as unknown as Record<string, number>,
        effectiveFrom: row.effectiveFrom.toISOString(),
      })),
      nextChangeAt: nextPricingChangeAt(applied, now)?.toISOString() ?? null,
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
    const now = new Date();
    const stage = this.stageOf(record);
    const target = isTarget(record.target) ? record.target : "llm";
    const origin = isOrigin(record.origin) ? record.origin : "manual";
    // 컬럼이 nullable이므로 undefined도 없는 것으로 본다 — 값이 없는 것과
    // 0시각을 섞으면 "예약됨"이 잘못 뜬다
    const effectiveFrom = record.effectiveFrom ?? null;
    const scheduled =
      effectiveFrom !== null && effectiveFrom.getTime() > now.getTime();
    const price = record.price as unknown as Record<string, number>;
    const currentPrice =
      record.currentPrice === null
        ? null
        : (record.currentPrice as unknown as Record<string, number>);
    return {
      id: record.id,
      target,
      origin,
      evidence:
        record.evidence === null
          ? null
          : (record.evidence as unknown as PricingProposalDto["evidence"]),
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
      effectiveFrom: effectiveFrom?.toISOString() ?? null,
      scheduled,
      rejectedBy: record.rejectedBy,
      rejectedAt: record.rejectedAt?.toISOString() ?? null,
      rejectedReason: record.rejectedReason,
      // 운영에서는 차단된 사실을, 개발에서는 경고를, 감지된 제안은 "사람의
      // 확인이 1회"라는 사실을 말한다 (정책 3201-②)
      selfApproval: describeSelfApproval({
        origin,
        proposedBy: record.proposedBy,
        approvedBy: record.approvedBy,
        environment: this.environment,
      }),
      detail: describePricingProposal({
        target,
        key: record.key,
        stage,
        price: price as unknown as ProposedPrice,
        currentPrice: currentPrice as unknown as ProposedPrice | null,
        effectiveFrom,
        now,
      }),
      createdAt: record.createdAt.toISOString(),
    };
  }
}
