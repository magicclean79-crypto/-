import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

/**
 * 단계 하나가 쓴 토큰과 돈. (TASK-4701, Sprint 47 — 지시 2)
 *
 * ## 토큰은 이미 있었는데 작업은 그것을 못 보고 있었습니다
 *
 * TASK-4603 보고에 이렇게 적었습니다: "토큰 사용량은 여전히 대부분
 * `null`입니다." 그 문장은 절반만 맞았습니다. **어댑터는 처음부터 usage를
 * 받아 `executions`에 적고 있었습니다.** 없던 것은 토큰이 아니라
 * **작업과 호출을 잇는 선**이었습니다.
 *
 * 그래서 여기서는 새로 재지 않습니다 — **이미 기록된 것을 읽어 옵니다.**
 * 다시 재면 같은 사실에 두 개의 답이 생기고, 둘이 어긋나는 날 어느 쪽도
 * 믿을 수 없게 됩니다.
 *
 * ## 무엇을 근거로 묶는가
 *
 * 작업은 요청 하나 안에서 돕니다. `ExecutionTracker`는 그 요청의
 * `requestId`를 호출 기록에 남깁니다. 그래서 **같은 `requestId` + 그 단계가
 * 돈 시간 구간**이면 그 단계가 부른 호출입니다.
 *
 * 이 방법의 한계를 그대로 적습니다:
 *
 * - `requestId`를 모르면 **재지 않습니다.** 시간만으로 묶으면 같은 순간
 *   다른 요청이 부른 호출까지 이 작업의 것으로 셉니다 — 그렇게 만든 비용은
 *   관측이 아니라 짐작입니다.
 * - 같은 요청이 작업 **밖에서도** LLM을 부르면 그 몫이 섞입니다. 지금
 *   `/jobs/*` 요청은 작업만 돌리므로 섞일 자리가 없지만, 그 사실은
 *   **경로에 달린 성질**이지 이 함수가 보장하는 것이 아닙니다.
 */

/** 한 구간의 사용량 — 모르는 것은 전부 null */
export interface StageUsage {
  /** 이 구간에 기록된 호출 수 */
  calls: number;
  /** 토큰 합계 — 하나라도 모르면 null */
  tokens: { input: number | null; output: number | null } | null;
  /** 비용 합계 (USD) — 못 재면 null */
  costUsd: number | null;
  /** 가격표에 없어 비용이 빠진 호출 수 — 못 재면 null */
  unpricedCalls: number | null;
  /** 왜 이 값인가 — 사람이 읽는다 */
  detail: string;
}

/** 잴 수 없었다 — 0이 아니라 **모른다** */
const UNMEASURED: StageUsage = {
  calls: 0,
  tokens: null,
  costUsd: null,
  unpricedCalls: null,
  detail:
    "이 단계가 부른 호출을 요청과 묶지 못해 토큰·비용을 재지 않았습니다 — " +
    "시간만으로 묶으면 남의 호출까지 셉니다.",
};

@Injectable()
export class TokenMeterService {
  private readonly logger = new Logger(TokenMeterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `requestId`가 `[from, to]` 사이에 부른 호출의 토큰·비용.
   *
   * **못 재면 0이 아니라 `null`입니다.** 0으로 채우면 "이 단계는 공짜였다"로
   * 읽히고, 그 합계로 예산을 재면 상한이 실제보다 여유 있어 보입니다.
   */
  async measure(
    requestId: string | null,
    from: Date,
    to: Date,
  ): Promise<StageUsage> {
    if (requestId === null || requestId === "") {
      return UNMEASURED;
    }

    let rows: {
      inputTokens: number | null;
      outputTokens: number | null;
      cost: unknown;
      model: string;
    }[];
    try {
      rows = await this.prisma.execution.findMany({
        where: { requestId, createdAt: { gte: from, lte: to } },
        select: { inputTokens: true, outputTokens: true, cost: true, model: true },
      });
    } catch (error) {
      // 재는 데 실패한 것을 "0원"으로 적지 않습니다.
      this.logger.warn(`단계 사용량을 읽지 못했습니다: ${String(error)}`);
      return UNMEASURED;
    }

    if (rows.length === 0) {
      // **여기는 0이 맞습니다.** 물어봤고, 답이 "없다"였습니다 — 모르는 것과
      // 다릅니다. 이 구간에 AI 호출이 없는 단계(파일 읽기·DB 쓰기)가 실제로
      // 있고, 그 단계를 "모름"으로 두면 작업 전체의 합계가 영원히 null이
      // 됩니다.
      return {
        calls: 0,
        tokens: { input: 0, output: 0 },
        costUsd: 0,
        unpricedCalls: 0,
        detail: "이 단계에서는 과금되는 호출이 없었습니다.",
      };
    }

    let input: number | null = 0;
    let output: number | null = 0;
    let cost = 0;
    let unpriced = 0;

    for (const row of rows) {
      if (row.inputTokens === null) input = null;
      else if (input !== null) input += row.inputTokens;
      if (row.outputTokens === null) output = null;
      else if (output !== null) output += row.outputTokens;

      if (row.cost === null || row.cost === undefined) {
        // 가격표에 없거나 토큰을 몰라 산정되지 않은 호출 — 합계에서 빠지므로
        // 합계는 **최소값**이 됩니다.
        unpriced += 1;
      } else {
        cost += Number(row.cost);
      }
    }

    const costUsd = Number(cost.toFixed(6));
    return {
      calls: rows.length,
      tokens: { input, output },
      costUsd,
      unpricedCalls: unpriced,
      detail:
        unpriced > 0
          ? `호출 ${rows.length}건 · 최소 $${costUsd.toFixed(6)} — 비용이 산정되지 않은 호출 ${unpriced}건은 빠져 있습니다.`
          : `호출 ${rows.length}건 · $${costUsd.toFixed(6)}.`,
    };
  }
}
