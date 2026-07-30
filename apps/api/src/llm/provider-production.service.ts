import { Injectable, Logger } from "@nestjs/common";
import {
  LLM_PROVIDER_REGISTRY,
  OCR_UNIT_MODEL,
  ROLLOUT_EVIDENCE_WINDOW_DAYS,
  describeOcrPricing,
  judgeProviderRollout,
  monitorProduction,
  pricedModels,
  providerKeyRequired,
  resolveMonitorOptions,
  validateApiKeyFormat,
  verifyCosts,
  verifyOcrCosts,
} from "@acos/core";
import type {
  CostSample,
  MonitorSample,
  OcrCostSample,
} from "@acos/core";
import type {
  CostVerificationDto,
  LlmHealthDto,
  ProductionMonitorDto,
  ProviderRolloutDto,
  ProviderValidationDto,
  ProviderValidationReportDto,
} from "@acos/shared";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { LlmService } from "./llm.service";

/**
 * Real AI Provider Production Integration. (TASK-1301, Sprint 13)
 *
 * 실 Provider로 운영을 시작할 때 필요한 세 가지 확인을 한곳에 모은다:
 * - **API Key Validation** — 형식 검사(무료·즉시) + 선택적 Live Check(실호출)
 * - **Cost Verification** — 기록된 비용이 가격표와 맞는가
 * - **Production Monitoring** — Provider별 성공률·지연 분포·비용
 *
 * 판정 로직은 전부 @acos/core의 순수 함수이고, 이 어댑터는 환경변수와
 * Execution 이력을 읽어 넘기는 역할만 한다.
 *
 * 키 값은 어떤 경로로도 노출하지 않는다 — 앞 6자 힌트와 길이만 내보낸다.
 */
@Injectable()
export class ProviderProductionService {
  private readonly logger = new Logger(ProviderProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    // 단가는 승인·적용된 가격표에서 온다 (TASK-3101, CTO 정책 3101-①)
    private readonly pricing: PricingService,
  ) {}

  private get production(): boolean {
    return process.env.NODE_ENV === "production";
  }

  /**
   * API Key Validation (TASK-1301).
   *
   * `live=true`면 Provider마다 최소 완성 호출을 1회 실행한다 — **실제로
   * 과금이 발생**하므로 기본은 형식 검사만 한다. 형식이 맞아도 유효한
   * 키라는 보장은 없고, 그 사실을 메시지에 그대로 적는다.
   */
  async validateProviders(
    options: { live?: boolean } = {},
  ): Promise<ProviderValidationReportDto> {
    const live = options.live ?? false;
    const available = this.llm.routing().availableProviders;
    const env = process.env as Record<string, string | undefined>;

    const providers: ProviderValidationDto[] = [];
    for (const info of LLM_PROVIDER_REGISTRY) {
      if (!info.keyEnv) {
        continue; // mock — 키가 필요 없는 Provider는 검증 대상이 아니다
      }
      const format = validateApiKeyFormat(info.name, env[info.keyEnv]);
      const instantiated = available.includes(info.name);
      const required = providerKeyRequired(info.name, env);

      // Live Check는 어댑터가 실제로 만들어진 Provider에만 의미가 있다
      let liveResult: LlmHealthDto | null = null;
      if (live && instantiated) {
        try {
          liveResult = await this.llm.health(info.name);
        } catch (error) {
          this.logger.warn(
            `${info.name} Live Check 실패: ${error instanceof Error ? error.message : String(error)}`,
          );
          liveResult = {
            provider: info.name,
            model: info.defaultModel,
            status: "error",
            latencyMs: 0,
            error: error instanceof Error ? error.message : String(error),
            checkedAt: new Date().toISOString(),
          };
        }
      }

      providers.push({
        provider: info.name,
        title: info.title,
        keyEnv: info.keyEnv,
        format: format.status,
        message: format.message,
        hint: format.hint,
        length: format.length,
        required,
        instantiated,
        defaultModel: info.defaultModel,
        live: liveResult,
      });
    }

    const blockers: string[] = [];
    for (const entry of providers) {
      if (entry.required && entry.format === "missing") {
        blockers.push(
          `${entry.provider}: 설정에서 참조하는데 ${entry.keyEnv}가 없습니다 (CTO 결정 1202-②).`,
        );
      }
      if (entry.format === "invalid" || entry.format === "placeholder") {
        blockers.push(`${entry.provider}: ${entry.message}`);
      }
      if (entry.live && entry.live.status === "error") {
        blockers.push(
          `${entry.provider}: Live Check 실패 — ${entry.live.error ?? "원인 불명"}`,
        );
      }
    }

    return {
      ok: blockers.length === 0,
      production: this.production,
      liveChecked: live,
      providers,
      blockers,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Cost Verification (TASK-1301) — 최근 구간의 Execution을 가격표로
   * 재계산해 검증한다. 성공 호출만 본다 (실패는 usage가 없는 게 정상).
   */
  async verifyCost(options: { hours?: number } = {}): Promise<CostVerificationDto> {
    const hours = Math.min(Math.max(options.hours ?? 24, 1), 24 * 30);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const records = await this.prisma.execution.findMany({
      where: { createdAt: { gte: since }, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cost: true,
        createdAt: true,
      },
    });

    const samples: CostSample[] = records.map((record) => ({
      id: record.id,
      provider: record.provider,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cost: record.cost === null ? null : Number(record.cost),
      createdAt: record.createdAt.toISOString(),
    }));

    // OCR도 같은 검증을 받는다 (TASK-3001, CTO 결정 2901-④) — 원장은 둘이지만
    // "AI 비용이 맞는가"는 한 질문이다. 따로 보여 주면 한쪽만 보는 사각이 생긴다.
    const ocrRecords = await this.prisma.ocrResult.findMany({
      where: { createdAt: { gte: since }, status: "SUCCESS" },
      select: {
        id: true,
        provider: true,
        units: true,
        cost: true,
        createdAt: true,
      },
    });
    const ocrSamples: OcrCostSample[] = ocrRecords.map((record) => ({
      id: record.id,
      provider: record.provider,
      units: record.units,
      cost: record.cost === null ? null : Number(record.cost),
      createdAt: record.createdAt.toISOString(),
    }));

    // 검증은 **그 시점에 유효했던 단가**로 대조한다 (TASK-3101, 정책 3101-②).
    // 비용 기록은 수정하지 않으므로, 새 단가로 과거를 대조하면 단가를 한 번
    // 바꿀 때마다 과거 전체가 "불일치"로 보고되고 그 경보는 곧 무시된다.
    const resolvers = await this.pricing.resolvers();
    const result = verifyCosts(samples, resolvers.llm);
    const ocr = verifyOcrCosts(ocrSamples, resolvers.ocr);
    const effective = await this.pricing.effective();
    return {
      ok: result.ok && ocr.ok,
      hours,
      checked: result.checked + ocr.checked,
      unpricedCalls: result.unpricedCalls + ocr.unpricedCalls,
      recordedTotal: Number(
        (result.recordedTotal + ocr.recordedTotal).toFixed(6),
      ),
      expectedTotal: Number(
        (result.expectedTotal + ocr.expectedTotal).toFixed(6),
      ),
      issues: [...result.issues, ...ocr.issues],
      // 원장별 합계를 밝힌다 — 총액만 보면 어디서 늘었는지 알 수 없다
      bySource: {
        llm: result.recordedTotal,
        ocr: ocr.recordedTotal,
      },
      // 지금 실제로 쓰는 단가를 보여 준다 — 코드 기본값을 보여 주면
      // 승인·적용된 단가와 화면이 어긋난다 (TASK-3101)
      pricing: pricedModels(effective.llm),
      ocrPricing: describeOcrPricing(effective.ocr),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * OCR 관측 (TASK-3001, CTO 결정 2901-④).
   *
   * LLM과 **같은 판정 함수**(`monitorProduction`)를 씁니다 — 성공률·지연·비용을
   * 보는 기준이 엔진에 따라 다를 이유가 없고, 다르면 한쪽 기준이 조용히 낡습니다.
   *
   * 다만 **같은 표에 섞지는 않습니다**: OCR은 LLM 호출이 아니므로 토큰·모델·
   * Failover 통계에 섞이면 판정이 흐려집니다. 결과는 별도 블록으로 돌려주고,
   * 장애 경보는 같은 종류(`provider-failure`)로 냅니다 — 운영자에게는 "AI 경로가
   * 죽었다"는 같은 사건입니다.
   */
  async monitorOcr(
    options: { minutes?: number } = {},
  ): Promise<ProductionMonitorDto> {
    const minutes = Math.min(Math.max(options.minutes ?? 60, 1), 60 * 24 * 7);
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const records = await this.prisma.ocrResult.findMany({
      where: {
        createdAt: { gte: since },
        // 아직 돌고 있는 실행은 성공도 실패도 아니다 — 판정에 섞지 않는다
        status: { in: ["SUCCESS", "FAILED"] },
      },
      select: {
        provider: true,
        status: true,
        cost: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    const samples: MonitorSample[] = records.map((record) => ({
      provider: record.provider,
      model: OCR_UNIT_MODEL,
      success: record.status === "SUCCESS",
      // 소요 시간은 시작~완료다 — 없으면 0으로 두되 성공/실패 판정은 그대로다
      latencyMs:
        record.startedAt && record.completedAt
          ? Math.max(
              0,
              record.completedAt.getTime() - record.startedAt.getTime(),
            )
          : 0,
      cost: record.cost === null ? null : Number(record.cost),
      createdAt: record.createdAt.toISOString(),
    }));

    const result = monitorProduction(samples, {
      ...resolveMonitorOptions(process.env as Record<string, string | undefined>),
      windowMinutes: minutes,
    });
    return {
      status: result.status,
      windowMinutes: result.windowMinutes,
      minSamples: result.minSamples,
      totals: result.totals,
      providers: result.providers,
      alerts: result.alerts,
      // OCR에는 진단 호출 개념이 없다 (Live Check 대상이 아니다)
      diagnosticCalls: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Production Monitoring (TASK-1301) — 관측 창 안의 Execution으로
   * Provider별 성공률·지연 분포(p50/p95/p99)·비용을 계산한다.
   *
   * **진단 호출(Health Check·Live Check)은 제외한다** (TASK-1302,
   * CTO 결정 1301-③) — Provider를 실제로 호출하긴 하지만 사용자 트래픽이
   * 아니므로 성공률·지연 분포에 섞이면 판정이 왜곡된다. feature를 새로
   * 만들지 않고 `executions.diagnostic` 메타데이터로 구분한다.
   * 진단 호출 수는 `diagnosticCalls`로 따로 보여 준다 — 숨기지는 않는다.
   *
   * 판정 기준(성공률·최소 표본·p95)은 환경변수로 조정할 수 있고, 미설정 시
   * CTO 결정 1301-②의 확정 기본값을 쓴다.
   */
  async monitor(options: { minutes?: number } = {}): Promise<ProductionMonitorDto> {
    const minutes = Math.min(Math.max(options.minutes ?? 60, 1), 60 * 24 * 7);
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const [records, diagnosticCalls] = await Promise.all([
      this.prisma.execution.findMany({
        where: { createdAt: { gte: since }, diagnostic: false },
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          provider: true,
          model: true,
          status: true,
          latencyMs: true,
          cost: true,
          createdAt: true,
        },
      }),
      this.prisma.execution.count({
        where: { createdAt: { gte: since }, diagnostic: true },
      }),
    ]);

    const samples: MonitorSample[] = records.map((record) => ({
      provider: record.provider,
      model: record.model,
      success: record.status === "SUCCESS",
      latencyMs: record.latencyMs,
      cost: record.cost === null ? null : Number(record.cost),
      createdAt: record.createdAt.toISOString(),
    }));

    const result = monitorProduction(samples, {
      ...resolveMonitorOptions(process.env as Record<string, string | undefined>),
      windowMinutes: minutes,
    });
    return {
      status: result.status,
      windowMinutes: result.windowMinutes,
      minSamples: result.minSamples,
      totals: result.totals,
      providers: result.providers,
      alerts: result.alerts,
      diagnosticCalls,
      checkedAt: new Date().toISOString(),
    };
  }
  /**
   * Provider 연결 순서 현황 (TASK-2901, CTO 결정 2801-⑤).
   *
   * **연결됨의 근거는 선언이 아니라 사실입니다** — 그 Provider로 성공한
   * 실행 기록이 있어야 `connected`입니다. 키 형식만 맞는 상태는
   * `unverified`(모르는 것)로 남습니다: 형식 검사는 오타를 잡을 뿐이고,
   * 그것을 연결 완료로 세면 **붙지 않은 시스템이 붙은 것처럼 보고**됩니다.
   *
   * 진단 호출(Live Check)의 성공도 근거로 셉니다 — 실제로 키가 통했다는
   * 증거이기 때문입니다(비용 통계에서 분리하는 것과는 다른 판단입니다).
   */
  async rollout(): Promise<ProviderRolloutDto> {
    // 근거에는 기한이 있다 — 2년 전 성공으로 "지금도 붙어 있다"고 말할 수 없다
    const since = new Date(
      Date.now() - ROLLOUT_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [llmGroups, visionSuccesses, ocrGroups] = await Promise.all([
      this.prisma.execution.groupBy({
        by: ["provider"],
        where: {
          status: "SUCCESS",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.execution.count({
        where: {
          status: "SUCCESS",
          feature: "vision-analysis",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
      }),
      this.prisma.ocrResult.groupBy({
        by: ["provider"],
        where: {
          status: "SUCCESS",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
    ]);

    const judged = judgeProviderRollout({
      env: process.env as Record<string, string | undefined>,
      llmSuccesses: countByProvider(llmGroups),
      visionSuccesses,
      ocrSuccesses: countByProvider(ocrGroups),
    });

    return {
      order: judged.order,
      stages: judged.stages,
      next: judged.next,
      outOfOrder: judged.outOfOrder,
      summary: judged.summary,
      detail: judged.detail,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** groupBy 결과를 { provider: 성공 수 }로 — 없는 Provider는 키가 없다 */
function countByProvider(
  groups: { provider: string; _count: { _all: number } }[],
): Record<string, number> {
  return Object.fromEntries(
    groups.map((group) => [group.provider, group._count._all]),
  );
}
