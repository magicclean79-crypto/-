import { HttpException } from "@nestjs/common";
import { MockLlmProvider, utcDayStart } from "@acos/core";
import type { PrismaService } from "../prisma/prisma.service";
import { LlmBudgetService } from "./llm-budget.service";
import { LlmService } from "./llm.service";

/** 일/월 지출을 지정해 반환하는 prisma aggregate mock */
function createPrismaMock(daySpend: number, monthSpend: number) {
  const aggregate = jest.fn(
    async ({ where }: { where: { createdAt: { gte: Date } } }) => {
      const dayStart = utcDayStart(new Date()).getTime();
      const isDaily = where.createdAt.gte.getTime() >= dayStart;
      return { _sum: { cost: isDaily ? daySpend : monthSpend } };
    },
  );
  return { execution: { aggregate }, aggregate } as unknown as PrismaService & {
    aggregate: jest.Mock;
  };
}

describe("LLM 비용 예산 (TASK-0902)", () => {
  afterEach(() => {
    delete process.env.LLM_DAILY_BUDGET_USD;
    delete process.env.LLM_MONTHLY_BUDGET_USD;
    delete process.env.LLM_BUDGET_ALERT_RATIO;
  });

  it("status — 일/월 지출·예산·상태를 UTC 기준으로 계산한다", async () => {
    process.env.LLM_DAILY_BUDGET_USD = "10";
    process.env.LLM_MONTHLY_BUDGET_USD = "100";
    const service = new LlmBudgetService(createPrismaMock(8.5, 42));

    const status = await service.status();
    expect(status.daily).toMatchObject({
      budget: 10,
      spend: 8.5,
      ratio: 0.85,
      status: "alert",
    });
    expect(status.monthly).toMatchObject({
      budget: 100,
      spend: 42,
      status: "ok",
    });
    expect(status.alertRatio).toBe(0.8);
  });

  it("예산 미설정 — assertWithinBudget는 조회 없이 통과 (기본 무제한)", async () => {
    const prisma = createPrismaMock(999, 999);
    const service = new LlmBudgetService(prisma);
    await expect(service.assertWithinBudget()).resolves.toBeUndefined();
    expect(prisma.aggregate).not.toHaveBeenCalled();
  });

  it("예산 초과 — 429로 차단하고, LlmService 호출도 차단된다 (Execution 미기록)", async () => {
    process.env.LLM_DAILY_BUDGET_USD = "10";
    const budget = new LlmBudgetService(createPrismaMock(10.5, 10.5));

    await expect(budget.assertWithinBudget()).rejects.toMatchObject({
      status: 429,
    });
    await expect(budget.assertWithinBudget()).rejects.toBeInstanceOf(
      HttpException,
    );

    // LlmService 단일 관문 차단 — Provider 호출·Execution 기록 없음
    const executions: unknown[] = [];
    const llm = new LlmService(
      new MockLlmProvider(),
      {
        record: async (entry) => {
          executions.push(entry);
          return { ...entry, id: "x", createdAt: new Date() };
        },
      },
      budget,
    );
    await expect(
      llm.complete(
        { messages: [{ role: "user", content: "ping" }] },
        { feature: "content-generation" },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(executions).toHaveLength(0);
  });

  it("월 예산 초과도 차단하며, 경고 임계는 조정 가능", async () => {
    process.env.LLM_MONTHLY_BUDGET_USD = "100";
    process.env.LLM_BUDGET_ALERT_RATIO = "0.5";
    const service = new LlmBudgetService(createPrismaMock(1, 60));

    const status = await service.status();
    expect(status.monthly.status).toBe("alert"); // 60% ≥ 50% 임계
    expect(status.alertRatio).toBe(0.5);

    process.env.LLM_MONTHLY_BUDGET_USD = "50";
    await expect(service.assertWithinBudget()).rejects.toMatchObject({
      status: 429,
    });
  });
});
