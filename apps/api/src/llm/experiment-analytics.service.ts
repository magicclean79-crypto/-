import { Injectable } from "@nestjs/common";
import { analyzeExperiment, describeExperiment } from "@acos/core";
import type { Experiment, VariantSample } from "@acos/core";
import type { ExperimentAnalyticsDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  featureExperiment,
  minSamplesForRecommendation,
} from "./experiment-config";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmService } from "./llm.service";

/**
 * Experiment Analytics & Recommendation. (TASK-1102, Sprint 11)
 *
 * 변형별 실행 성과(Execution 기준)를 모아 core의 순수 분석 로직에 넘긴다.
 * **관측 기간**은 실험 상태가 만들어진 시점(또는 마지막 START) 이후로 잡는다
 * — 실험 시작 전 이력이 비교에 섞이지 않도록.
 *
 * 배정(Assignment)이 아니라 **실행(Execution)** 을 근거로 삼는다
 * (CTO 결정 1003-④ — 둘은 다를 수 있고, 성과는 실제 수행 결과로 판단한다).
 */
@Injectable()
export class ExperimentAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ExperimentLifecycleService,
    private readonly llm: LlmService,
    private readonly settings: AdminSettingsService,
  ) {}

  /**
   * 관측 시작 시각 (CTO 결정 1102-③).
   * **정의 서명이 바뀔 때만 초기화**하고 START/STOP은 기간을 이어간다.
   * 서명 기록이 없으면 상태 생성 시점(없으면 전체 기간).
   */
  private async observationStart(
    feature: string,
    experiment: Experiment | null,
  ): Promise<Date | null> {
    return this.lifecycle.syncSignature(feature, experiment);
  }

  async analyze(feature: string): Promise<ExperimentAnalyticsDto> {
    const experiment = featureExperiment(feature, this.settings.get.bind(this.settings));
    const available = this.llm.routing().availableProviders;
    const since = await this.observationStart(feature, experiment);

    // 변형별 실행 집계 — provider+model 단위 (변형 키와 같은 축)
    const rows = await this.prisma.execution.groupBy({
      by: ["provider", "model", "status"],
      where: {
        feature,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cost: true },
      _avg: { latencyMs: true },
    });

    // 모델 미지정 변형(`provider`)은 그 Provider의 모든 모델을 합산한다
    const view = experiment
      ? describeExperiment(experiment, available)
      : { variants: [] as { key: string; provider: string; model: string | null; weightShare: number }[] };

    const samples: VariantSample[] = view.variants.map((variant) => {
      const matched = rows.filter(
        (row) =>
          row.provider === variant.provider &&
          (variant.model === null || row.model === variant.model),
      );
      const calls = matched.reduce((sum, row) => sum + row._count._all, 0);
      const successes = matched
        .filter((row) => row.status === "SUCCESS")
        .reduce((sum, row) => sum + row._count._all, 0);
      const costs = matched
        .map((row) => (row._sum.cost === null ? null : Number(row._sum.cost)))
        .filter((value): value is number => value !== null);
      // 지연은 호출 수로 가중 평균 (그룹 평균을 단순 평균하면 왜곡된다)
      const latencyWeighted = matched.reduce(
        (sum, row) => sum + (row._avg.latencyMs ?? 0) * row._count._all,
        0,
      );
      return {
        key: variant.key,
        provider: variant.provider,
        model: variant.model,
        calls,
        successes,
        failures: calls - successes,
        avgLatencyMs: calls > 0 ? latencyWeighted / calls : null,
        cost: costs.length > 0 ? costs.reduce((sum, v) => sum + v, 0) : null,
        inputTokens: matched.reduce(
          (sum, row) => sum + (row._sum.inputTokens ?? 0),
          0,
        ),
        outputTokens: matched.reduce(
          (sum, row) => sum + (row._sum.outputTokens ?? 0),
          0,
        ),
      };
    });

    const weightShares = Object.fromEntries(
      view.variants.map((variant) => [variant.key, variant.weightShare]),
    );
    const result = analyzeExperiment({
      samples,
      weightShares,
      minSamples: minSamplesForRecommendation(),
    });
    const state = await this.lifecycle.lifecycle(feature);

    return {
      feature,
      name: experiment?.name ?? feature,
      configured: experiment !== null,
      status: state.status,
      promotedVariant: state.promotedVariant,
      since: since?.toISOString() ?? null,
      totalCalls: result.totalCalls,
      baseline: result.baseline,
      variants: result.variants.map((variant) => ({
        key: variant.key,
        provider: variant.provider,
        model: variant.model,
        weightShare: variant.weightShare,
        calls: variant.calls,
        successes: variant.successes,
        failures: variant.failures,
        successRate: variant.successRate,
        successRateLow: variant.successRateInterval?.[0] ?? null,
        successRateHigh: variant.successRateInterval?.[1] ?? null,
        avgLatencyMs: variant.avgLatencyMs,
        cost: variant.cost,
        costPerCall: variant.costPerCall,
        inputTokens: variant.inputTokens,
        outputTokens: variant.outputTokens,
      })),
      comparisons: result.comparisons,
      recommendation: result.recommendation,
      checkedAt: new Date().toISOString(),
    };
  }
}
