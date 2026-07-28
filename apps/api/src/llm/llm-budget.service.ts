import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_BUDGET_ALERT_RATIO,
  evaluateBudgetWindow,
  utcDayStart,
  utcMonthStart,
} from "@acos/core";
import type { LlmBudgetDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * LLM 비용 예산 서비스. (TASK-0902, Sprint 9 — Cost Governance)
 *
 * - Daily/Monthly Budget: `LLM_DAILY_BUDGET_USD` / `LLM_MONTHLY_BUDGET_USD`
 *   (미설정 = 무제한 — 기존 동작, 검사 오버헤드 없음)
 * - Cost Alert: 예산의 80%(`LLM_BUDGET_ALERT_RATIO`) 도달 시 경고 상태 +
 *   상태 전이 시 서버 로그 경고. 대시보드(/providers)에 항상 표시
 * - 초과 시: 새 LLM 호출을 429로 차단 — 호출 전 검사이므로 Execution은
 *   기록되지 않는다(검증 오류와 동일 원칙). 예산 상향/윈도우 경과로 자동 해제
 * - 지출 합계는 Execution.cost(USD) 기준, 경계는 UTC (시계열 표준과 동일)
 */
@Injectable()
export class LlmBudgetService {
  private readonly logger = new Logger(LlmBudgetService.name);
  private lastLoggedState: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private config(): {
    daily: number | null;
    monthly: number | null;
    alertRatio: number;
  } {
    const parse = (value: string | undefined): number | null => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const ratio = Number(process.env.LLM_BUDGET_ALERT_RATIO);
    return {
      daily: parse(process.env.LLM_DAILY_BUDGET_USD),
      monthly: parse(process.env.LLM_MONTHLY_BUDGET_USD),
      alertRatio:
        Number.isFinite(ratio) && ratio > 0 && ratio <= 1
          ? ratio
          : DEFAULT_BUDGET_ALERT_RATIO,
    };
  }

  private async spendSince(from: Date): Promise<number> {
    const result = await this.prisma.execution.aggregate({
      _sum: { cost: true },
      where: { createdAt: { gte: from } },
    });
    return Number(result._sum.cost ?? 0);
  }

  /** 예산 현황 (GET /llm/budget · Provider Dashboard) */
  async status(): Promise<LlmBudgetDto> {
    const { daily, monthly, alertRatio } = this.config();
    const now = new Date();
    const [daySpend, monthSpend] = await Promise.all([
      this.spendSince(utcDayStart(now)),
      this.spendSince(utcMonthStart(now)),
    ]);
    return {
      daily: evaluateBudgetWindow(daySpend, daily, alertRatio),
      monthly: evaluateBudgetWindow(monthSpend, monthly, alertRatio),
      alertRatio,
      checkedAt: now.toISOString(),
    };
  }

  /**
   * 호출 전 예산 검사 (LlmService 단일 관문에서 호출) —
   * 초과 시 429, 경고/초과 상태 전이는 로그로 알린다 (Cost Alert).
   */
  async assertWithinBudget(): Promise<void> {
    const { daily, monthly } = this.config();
    if (daily === null && monthly === null) {
      return; // 예산 미설정 — 검사 없음 (기본)
    }
    const status = await this.status();

    const state = [status.daily.status, status.monthly.status].includes(
      "exceeded",
    )
      ? "exceeded"
      : [status.daily.status, status.monthly.status].includes("alert")
        ? "alert"
        : "ok";
    if (state !== this.lastLoggedState) {
      if (state === "alert") {
        this.logger.warn(
          `LLM 비용 경고: 일 $${status.daily.spend.toFixed(4)}/${status.daily.budget ?? "∞"} · ` +
            `월 $${status.monthly.spend.toFixed(4)}/${status.monthly.budget ?? "∞"} (임계 ${status.alertRatio * 100}%)`,
        );
      } else if (state === "exceeded") {
        this.logger.error(
          `LLM 비용 예산 초과 — 새 호출을 차단합니다: 일 $${status.daily.spend.toFixed(4)}/${status.daily.budget ?? "∞"} · ` +
            `월 $${status.monthly.spend.toFixed(4)}/${status.monthly.budget ?? "∞"}`,
        );
      }
      this.lastLoggedState = state;
    }

    if (state === "exceeded") {
      const which =
        status.daily.status === "exceeded" ? "일간" : "월간";
      throw new HttpException(
        `LLM ${which} 비용 예산을 초과했습니다 — 예산 상향(LLM_DAILY/MONTHLY_BUDGET_USD) 또는 기간 경과 후 다시 시도해 주세요.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
