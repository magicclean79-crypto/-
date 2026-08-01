import { Injectable } from "@nestjs/common";
import { judgePriceFreshness, reportUnpricedModels } from "@acos/core";
import type {
  PriceFreshnessReport,
  UnpricedCall,
  UnpricedModelReport,
} from "@acos/core";

import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "./pricing.service";

/**
 * 가격표를 얼마나 믿을 수 있는가. (TASK-4701, Sprint 47 — 지시 5)
 *
 * ## 지금까지 미산정은 "건수"였습니다
 *
 * 화면에 "비용이 빠진 호출 12건"이라고 떴습니다. 그 문장을 보고 사람이 할
 * 수 있는 일이 없습니다 — **무엇을** 등록해야 하는지, **어디서** 부르고
 * 있는지, **언제부터**인지가 없기 때문입니다. 그래서 그 12건은 계속
 * 12건으로 남았습니다.
 *
 * 이제 **모델 이름 · 부른 기능 · 처음 본 날**까지 냅니다. 그러면 할 일이
 * 한 줄로 정해집니다.
 *
 * ## 단가를 추정하지 않습니다
 *
 * 표에 없는 모델을 "비슷한 모델 값"으로 채우면 미산정 경보가 사라지고
 * 화면이 초록이 됩니다. **그 초록은 거짓말입니다.** 근거 없는 숫자로 낸
 * 비용은 없는 것보다 나쁩니다 — 없으면 "모른다"가 보이지만, 지어내면
 * 아무도 다시 확인하지 않습니다.
 *
 * ## 단가의 나이도 함께 봅니다
 *
 * 표에 값이 있다는 것과 그 값이 맞다는 것은 다릅니다. 단가는 조용히
 * 바뀌고, 바뀐 날 우리 표에는 아무 일도 일어나지 않습니다 — 그 뒤로 우리가
 * 내는 모든 비용 숫자는 **틀렸는데 초록색**입니다.
 */

export interface PricingHealthDto {
  ok: boolean;
  hours: number;
  freshness: PriceFreshnessReport;
  unpriced: UnpricedModelReport;
  /** 사람이 먼저 읽을 한 줄 — 못 믿는 것부터 */
  detail: string;
  checkedAt: string;
}

@Injectable()
export class PricingHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async health(options: { hours?: number } = {}): Promise<PricingHealthDto> {
    const now = Date.now();
    const hours = Math.min(Math.max(options.hours ?? 24 * 7, 1), 24 * 90);
    const since = new Date(now - hours * 3_600_000);

    // 지금 유효한 표로 봅니다 — 나이를 묻는 질문이므로 과거 시점 표가
    // 아니라 **지금 쓰이는 표**가 대상입니다.
    const effective = await this.pricing.effective();

    const rows = await this.prisma.execution.findMany({
      where: {
        createdAt: { gte: since },
        status: "SUCCESS",
        // 비용이 비어 있는 것만 봅니다. 토큰을 몰라 비운 것도 여기 섞이는데,
        // 그것도 예산에서 빠지기는 마찬가지이므로 같이 드러냅니다.
        cost: null,
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        model: true,
        provider: true,
        feature: true,
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
      },
    });

    // 토큰을 몰라 비용이 없는 것과 **가격표가 없어** 비용이 없는 것은
    // 조치가 다릅니다. 여기는 후자만 셉니다 — 전자를 섞으면 "단가를
    // 등록하세요"라는 안내가 엉뚱한 곳을 가리킵니다.
    const calls: UnpricedCall[] = rows
      .filter((row) => row.inputTokens !== null && row.outputTokens !== null)
      .map((row) => ({
        model: row.model,
        provider: row.provider,
        feature: row.feature,
        createdAt: row.createdAt.toISOString(),
      }));

    const freshness = judgePriceFreshness(effective.llm, now);
    const unpriced = reportUnpricedModels(calls);

    const problems: string[] = [];
    if (unpriced.rows.length > 0) {
      problems.push(unpriced.summary);
    }
    if (freshness.stale > 0 || freshness.unknownSource > 0) {
      problems.push(freshness.summary);
    }

    return {
      ok: problems.length === 0,
      hours,
      freshness,
      unpriced,
      detail:
        problems.length === 0
          ? `최근 ${Math.round(hours / 24)}일 동안 가격표에 없는 모델로 나간 호출이 없고, ${freshness.summary}`
          : problems.join(" "),
      checkedAt: new Date(now).toISOString(),
    };
  }
}
