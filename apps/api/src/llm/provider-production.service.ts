import { Injectable, Logger } from "@nestjs/common";
import {
  LLM_PROVIDER_REGISTRY,
  monitorProduction,
  pricedModels,
  providerKeyRequired,
  resolveMonitorOptions,
  validateApiKeyFormat,
  verifyCosts,
} from "@acos/core";
import type { CostSample, MonitorSample } from "@acos/core";
import type {
  CostVerificationDto,
  LlmHealthDto,
  ProductionMonitorDto,
  ProviderValidationDto,
  ProviderValidationReportDto,
} from "@acos/shared";
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

    const result = verifyCosts(samples);
    return {
      ok: result.ok,
      hours,
      checked: result.checked,
      unpricedCalls: result.unpricedCalls,
      recordedTotal: result.recordedTotal,
      expectedTotal: result.expectedTotal,
      issues: result.issues,
      pricing: pricedModels(),
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
}
