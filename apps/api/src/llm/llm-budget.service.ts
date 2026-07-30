import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  DEFAULT_BUDGET_ALERT_RATIO,
  combineAiSpend,
  describeAiSpend,
  evaluateBudgetWindow,
  markNoFailover,
  utcDayStart,
  utcMonthStart,
} from "@acos/core";
import type { LlmBudgetDto } from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * AI 비용 예산 서비스. (TASK-0902 → TASK-3001)
 *
 * **예산은 "LLM 지출"이 아니라 "AI 지출 총액"입니다** (CTO 결정 2901-④).
 * OCR도 호출당 과금되는 AI 호출이므로 같은 상한 안에 들어옵니다 — 원장은
 * 성격대로 둘(LLM Execution · OCR 실행 이력)로 나누되 **지출은 하나로**
 * 봅니다. 그러지 않으면 실 OCR 엔진을 붙인 순간부터 예산 밖에서 돈이 나갑니다.
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly settings?: AdminSettingsService,
  ) {}

  /** 콘솔 오버라이드 조회 (TASK-1201 Budget Management) */
  private override(key: string): string | null {
    return this.settings?.get(key) ?? null;
  }

  private config(): {
    daily: number | null;
    monthly: number | null;
    alertRatio: number;
  } {
    const parse = (value: string | undefined): number | null => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    // 콘솔 오버라이드가 환경변수보다 우선한다 (TASK-1201)
    const ratio = Number(
      this.override("budget.alertRatio") ?? process.env.LLM_BUDGET_ALERT_RATIO,
    );
    return {
      daily: parse(
        this.override("budget.daily") ?? process.env.LLM_DAILY_BUDGET_USD,
      ),
      monthly: parse(
        this.override("budget.monthly") ?? process.env.LLM_MONTHLY_BUDGET_USD,
      ),
      alertRatio:
        Number.isFinite(ratio) && ratio > 0 && ratio <= 1
          ? ratio
          : DEFAULT_BUDGET_ALERT_RATIO,
    };
  }

  /**
   * 기간 내 AI 지출 — **두 원장을 합친다** (TASK-3001).
   *
   * OCR은 성공한 호출에만 비용이 붙고, 가격표에 없는 엔진은 `null`이라
   * 합계에서 빠집니다(미산정) — 그 상태는 비용 검증이 별도로 경보합니다.
   */
  private async spendSince(
    from: Date,
  ): Promise<ReturnType<typeof combineAiSpend>> {
    const [llm, ocr] = await Promise.all([
      this.prisma.execution.aggregate({
        _sum: { cost: true },
        where: { createdAt: { gte: from } },
      }),
      this.prisma.ocrResult.aggregate({
        _sum: { cost: true },
        where: { createdAt: { gte: from } },
      }),
    ]);
    return combineAiSpend({
      llm: Number(llm._sum.cost ?? 0),
      ocr: Number(ocr._sum.cost ?? 0),
    });
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
      daily: evaluateBudgetWindow(daySpend.total, daily, alertRatio),
      monthly: evaluateBudgetWindow(monthSpend.total, monthly, alertRatio),
      // 총액만 말하면 "왜 늘었는가"에 답할 수 없다 — 원장별로 밝힌다
      bySource: {
        daily: daySpend.bySource,
        monthly: monthSpend.bySource,
      },
      alertRatio,
      checkedAt: now.toISOString(),
    };
  }

  /**
   * 호출 전 예산 검사 (LlmService 단일 관문에서 호출) —
   * 초과 시 429, 경고/초과 상태 전이는 로그로 알린다 (Cost Alert).
   */
  async assertWithinBudget(options: { what?: string } = {}): Promise<void> {
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
      const breakdown = describeAiSpend({
        total: status.daily.spend,
        bySource: status.bySource.daily,
      });
      if (state === "alert") {
        this.logger.warn(
          `AI 비용 경고: 일 $${status.daily.spend.toFixed(4)}/${status.daily.budget ?? "∞"} · ` +
            `월 $${status.monthly.spend.toFixed(4)}/${status.monthly.budget ?? "∞"} ` +
            `(임계 ${status.alertRatio * 100}%) — 오늘 ${breakdown}`,
        );
      } else if (state === "exceeded") {
        this.logger.error(
          `AI 비용 예산 초과 — 새 호출을 차단합니다: 일 $${status.daily.spend.toFixed(4)}/${status.daily.budget ?? "∞"} · ` +
            `월 $${status.monthly.spend.toFixed(4)}/${status.monthly.budget ?? "∞"} — 오늘 ${breakdown}`,
        );
      }
      this.lastLoggedState = state;
    }

    if (state === "exceeded") {
      const which =
        status.daily.status === "exceeded" ? "일간" : "월간";
      // 무엇이 막혔는지 말한다 — "LLM 예산"이라고만 하면 OCR을 눌렀다가
      // 429를 받은 사람은 엉뚱한 곳을 본다 (TASK-3001)
      const what = options.what ?? "AI 호출";
      // 예산 초과는 Provider를 바꿔도 같으므로 Failover 대상이 아니다
      // (CTO 지시, TASK-1002) — markNoFailover로 명시한다
      throw markNoFailover(
        new HttpException(
          `${which} AI 비용 예산을 초과해 ${what}을 차단했습니다 — ` +
            "예산 상향(LLM_DAILY/MONTHLY_BUDGET_USD) 또는 기간 경과 후 다시 시도해 주세요. " +
            "예산은 LLM과 OCR 지출을 합해서 봅니다 (CTO 결정 2901-④).",
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    }
  }
}
