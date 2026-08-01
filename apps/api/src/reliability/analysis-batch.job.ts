import { Injectable } from "@nestjs/common";
import type { Checkpoint } from "@acos/core";

import { AnalysisService } from "../analysis/analysis.service";
import { judgeBatchItem } from "./batch-stage";
import { JobLoggerService } from "./job-logger.service";
import type { JobDefinition, JobStage } from "./job-runner.service";

export interface AnalysisBatchInput {
  productIds: string[];
  /** 분석 결과를 상품에 반영할 것인가 — 기존 API와 같은 뜻 */
  apply: boolean;
}

export interface AnalysisBatchState {
  productIds: string[];
  done: { productId: string; analysisId: string }[];
  skipped: { productId: string; reason: string }[];
}

/**
 * 상품 묶음 분석. (TASK-4701, Sprint 47 — 지시 1)
 *
 * ## 왜 이것이 두 번째인가
 *
 * 분석은 **이미지를 첨부한 멀티모달 호출**이라 이 저장소에서 가장 비싼
 * 호출입니다. 스무 개를 돌리다 열다섯 번째에서 죽으면 앞의 열넷을 다시
 * 사고, 그 값은 OCR보다 훨씬 큽니다.
 *
 * ## 기존 분석을 고치지 않습니다
 *
 * `AnalysisService.runAnalysis`를 **그대로 부릅니다.** 기존
 * `POST /products/:id/analysis`는 예전과 똑같이 동작합니다 — 재시도
 * (`ANALYSIS_MAX_ATTEMPTS`)도 그 안에 그대로 있습니다.
 *
 * ## 재시도가 두 겹이 되는 것에 대해
 *
 * 분석은 자체 재시도를 가지고 있고, 작업 실행기도 재시도를 가지고 있습니다.
 * 겹으로 도는 것처럼 보이지만 **잡는 것이 다릅니다**: 안쪽은 한 번의 호출이
 * 흔들린 것, 바깥쪽은 그 상품 전체가 실패한 것입니다. 다만 곱해지면 최대
 * 시도 수가 늘어나므로, **바깥은 이 상품을 다시 사지 않고 이어합니다** —
 * 이미 끝난 상품은 체크포인트가 건너뜁니다.
 */
@Injectable()
export class AnalysisBatchJob {
  static readonly KIND = "analysis-batch";

  constructor(
    private readonly analysis: AnalysisService,
    private readonly jobLog: JobLoggerService,
  ) {}

  definition(
    input: AnalysisBatchInput,
  ): JobDefinition<AnalysisBatchInput, AnalysisBatchState> {
    const stages: JobStage<AnalysisBatchState>[] = input.productIds.map(
      (productId, index) => ({
        name: `analysis:${index + 1}:${productId}`,
        // 멀티모달 호출은 OCR보다 오래 걸립니다. Provider 타임아웃보다
        // 넉넉하게 둬야 상대가 남긴 실패 이유를 볼 수 있습니다.
        timeoutMs: 180_000,
        run: async (state) => {
          if (state.done.some((row) => row.productId === productId)) {
            return state;
          }

          const verdict = await judgeBatchItem<string>(async () => {
            const result = await this.analysis.runAnalysis(productId, input.apply);
            // OCR과 같습니다 — **던지지 않았다고 성공이 아닙니다.**
            // 분석도 실패를 기록하고 `FAILED`로 돌려줍니다.
            return result.status === "SUCCESS"
              ? { ok: true, value: result.id }
              : { ok: false, error: result.error ?? "분석이 실패로 끝났습니다" };
          });

          if (verdict.done) {
            return {
              ...state,
              done: [...state.done, { productId, analysisId: verdict.value }],
            };
          }

          this.jobLog.warn("상품 하나를 건너뜁니다.", {
            productId,
            kind: verdict.kind,
            detail: verdict.detail,
          });
          return {
            ...state,
            skipped: [...state.skipped, { productId, reason: verdict.reason }],
          };
        },
      }),
    );

    return {
      kind: AnalysisBatchJob.KIND,
      stages,
      initial: (value) => ({ productIds: value.productIds, done: [], skipped: [] }),
      // 체크포인트에는 **id만** — 분석 본문은 이미 analysis_results에 있고,
      // 여기 담으면 매 단계 쓰기가 그만큼 느려집니다.
      snapshot: (state) => ({ done: state.done, skipped: state.skipped }),
      restore: (value, checkpoints) => restoreState(value, checkpoints),
    };
  }
}

function restoreState(
  input: AnalysisBatchInput,
  checkpoints: Checkpoint[],
): AnalysisBatchState {
  const newest = checkpoints
    .filter((row) => row.done)
    .reduce<Checkpoint | null>(
      (best, row) => (best === null || row.at > best.at ? row : best),
      null,
    );
  const output = (newest?.output ?? {}) as Partial<AnalysisBatchState>;
  return {
    productIds: input.productIds,
    done: Array.isArray(output.done) ? output.done : [],
    skipped: Array.isArray(output.skipped) ? output.skipped : [],
  };
}
