import { BadRequestException, Injectable } from "@nestjs/common";
import {
  OCR_UNIT_MODEL,
  buildBillingReport,
  forecastMonthlySpend,
  utcMonthStart,
} from "@acos/core";
import type { BillingGroupInput, DailySpendPoint } from "@acos/core";
import type { BillingReportDto, CostForecastDto } from "@acos/shared";
import { Prisma } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";

/** 리포트 조회 최대 기간 — 1년치 이상을 한 번에 읽을 이유가 없다 */
export const BILLING_MAX_RANGE_DAYS = 366;

/** 일별 지출 집계 행 ($queryRaw 반환 형태) */
interface DailyRow {
  date: string;
  total: number;
  calls: number;
  unpriced: number;
}

/**
 * 비용 인텔리전스 서비스. (TASK-3101, Sprint 31 — CTO 정책 3101-③④)
 *
 * 두 가지를 만든다. **둘 다 아무것도 막지 않는다.**
 *
 * | 산출물 | 무엇인가 | 무엇이 아닌가 |
 * | --- | --- | --- |
 * | **Forecast** | 관측된 일별 지출로 월말을 추정한 **참고자료** | 차단 근거가 아니다 — Budget Gate는 실제 비용만 본다 (정책 3101-③) |
 * | **Billing Report** | Provider·모델별 지출 **운영 지표** | 회계 청구서가 아니다 (정책 3101-④) |
 *
 * 두 원장(LLM Execution · OCR 실행 이력)을 함께 읽는다 — 예산이 AI 지출
 * 총액을 보므로(결정 2901-④) 리포트와 예측도 같은 범위를 봐야 한다. 한쪽만
 * 보면 실 OCR 엔진을 붙인 순간부터 리포트가 조용히 틀린다.
 *
 * **성공한 호출만** 집계한다 — 비용은 성공에만 기록되기 때문이다. 실패 호출도
 * Provider에 따라 과금될 수 있고, 그 사실은 면책 문구가 밝힌다.
 */
@Injectable()
export class CostIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: LlmBudgetService,
  ) {}

  /**
   * 운영 비용 리포트 (GET /ops/billing).
   *
   * 기본 기간은 **이번 달**(UTC)이다 — 예산 창과 같은 경계를 써야 "예산은
   * 안 넘었는데 리포트는 넘었다" 같은 혼란이 생기지 않는다.
   */
  async billing(range: { from?: string; to?: string } = {}): Promise<BillingReportDto> {
    const now = new Date();
    const from = this.parseDate(range.from, utcMonthStart(now), "from");
    const to = this.parseDate(range.to, now, "to");
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException("from은 to보다 이후일 수 없습니다.");
    }
    const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (days > BILLING_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `리포트 기간은 최대 ${BILLING_MAX_RANGE_DAYS}일입니다. 범위를 좁혀 주세요.`,
      );
    }

    const window = { createdAt: { gte: from, lte: to } };
    const [llmGroups, ocrGroups] = await Promise.all([
      this.prisma.execution.groupBy({
        by: ["provider", "model"],
        where: { ...window, status: "SUCCESS" },
        _sum: { cost: true },
        // 비용이 기록된 호출 수를 따로 센다 — 전체와의 차이가 미산정이다
        _count: { _all: true, cost: true },
      }),
      this.prisma.ocrResult.groupBy({
        by: ["provider"],
        where: { ...window, status: "SUCCESS" },
        _sum: { cost: true },
        _count: { _all: true, cost: true },
      }),
    ]);

    const groups: BillingGroupInput[] = [
      ...llmGroups.map((row) => ({
        source: "llm" as const,
        provider: row.provider,
        model: row.model,
        calls: row._count._all,
        cost: row._sum.cost === null ? null : Number(row._sum.cost),
        unpricedCalls: row._count._all - row._count.cost,
      })),
      ...ocrGroups.map((row) => ({
        source: "ocr" as const,
        provider: row.provider,
        // OCR은 모델이 없다 — 단위 모델 이름으로 자리를 채운다
        model: OCR_UNIT_MODEL,
        calls: row._count._all,
        cost: row._sum.cost === null ? null : Number(row._sum.cost),
        unpricedCalls: row._count._all - row._count.cost,
      })),
    ];

    const report = buildBillingReport({ from, to, groups });
    return { ...report, checkedAt: new Date().toISOString() };
  }

  /**
   * 월말 비용 예측 (GET /ops/cost-forecast) — **참고자료다** (정책 3101-③).
   *
   * 표본이 최소 일수에 못 미치면 숫자를 만들지 않는다. 그리고 비용이 빠진
   * 호출이 있으면 **추정이 실제보다 작을 수 있다**는 사실을 함께 말한다 —
   * 미산정을 숨기면 "예산 안에 들어온다"는 낙관이 사실처럼 읽힌다.
   */
  async forecast(): Promise<CostForecastDto> {
    const now = new Date();
    const monthStart = utcMonthStart(now);
    const rows = await this.dailySpend(monthStart);
    const points: DailySpendPoint[] = rows.map((row) => ({
      date: row.date,
      total: row.total,
    }));
    const unpricedCalls = rows.reduce((sum, row) => sum + row.unpriced, 0);

    const forecast = forecastMonthlySpend({
      points,
      // UTC 기준 이번 달 일수 — 예산 창과 같은 경계다
      daysInMonth: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
      ).getUTCDate(),
      budget: this.budget.limits().monthly,
    });

    return {
      ...forecast,
      points,
      unpricedCalls,
      detail:
        forecast.detail +
        (unpricedCalls > 0
          ? ` 비용이 빠진 호출 ${unpricedCalls}건이 있어 추정도 실제보다 작을 수 있습니다.`
          : ""),
      checkedAt: now.toISOString(),
    };
  }

  /**
   * 이번 달 일별 지출 — 두 원장을 UTC 일자로 합친다.
   *
   * `date_trunc`은 UTC 저장 값을 그대로 자르므로 결과도 UTC 일자다
   * (Execution Timeline과 같은 표준). **관측이 없는 날은 행이 없다** —
   * 0원으로 채우면 "안 쓴 날"이 되고, 그러면 하루 평균이 실제보다 낮아진다.
   */
  private async dailySpend(from: Date): Promise<DailyRow[]> {
    const sum = async (table: string): Promise<DailyRow[]> =>
      this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT
          to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "date",
          COALESCE(SUM("cost"), 0)::float8 AS "total",
          COUNT(*)::int                    AS "calls",
          COUNT(*)::int - COUNT("cost")::int AS "unpriced"
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE "createdAt" >= ${from} AND "status" = 'SUCCESS'
        GROUP BY 1
      `);

    // 테이블 이름은 코드 상수다 — 외부 입력이 들어오지 않는다
    const [llm, ocr] = await Promise.all([
      sum("executions"),
      sum("ocr_results"),
    ]);

    const merged = new Map<string, DailyRow>();
    for (const row of [...llm, ...ocr]) {
      const current = merged.get(row.date);
      merged.set(row.date, {
        date: row.date,
        total: Number(((current?.total ?? 0) + row.total).toFixed(6)),
        calls: (current?.calls ?? 0) + row.calls,
        unpriced: (current?.unpriced ?? 0) + row.unpriced,
      });
    }
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  }


  /** 쿼리 파라미터의 시각 — 형식이 틀리면 조용히 기본값으로 돌리지 않는다 */
  private parseDate(value: string | undefined, fallback: Date, name: string): Date {
    if (value === undefined || value.trim() === "") {
      return fallback;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      // 잘못된 값을 무시하면 사람은 자기가 지정한 기간을 보고 있다고 믿는다
      throw new BadRequestException(
        `${name}이 올바른 날짜 형식이 아닙니다 (예: 2026-07-01).`,
      );
    }
    return parsed;
  }
}
