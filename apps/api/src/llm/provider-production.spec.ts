import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { LlmService } from "./llm.service";
import { ProviderProductionService } from "./provider-production.service";

/**
 * Real AI Provider Production Integration 검증. (TASK-1301, Sprint 13)
 *
 * 판정 로직은 core(순수 함수)에서 검증하므로, 여기서는 **어댑터가 옳게
 * 연결되었는지**를 본다: 환경변수를 읽는가 / Execution을 옳은 조건으로
 * 조회하는가 / 키 값이 새어 나가지 않는가 / Live Check가 기본으로 꺼져 있는가.
 */

interface ExecutionRow {
  id?: string;
  provider: string;
  model: string;
  status?: "SUCCESS" | "FAILED";
  inputTokens?: number | null;
  outputTokens?: number | null;
  cost?: number | null;
  latencyMs?: number | null;
  createdAt: Date;
}

interface FindManyArgs {
  where?: { createdAt?: { gte?: Date }; status?: string };
}

const ORIGINAL_ENV = { ...process.env };

async function build(options: {
  rows?: ExecutionRow[];
  available?: string[];
  health?: (provider: string) => Promise<unknown>;
}) {
  const calls: FindManyArgs[] = [];
  const prisma = {
    execution: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        return options.rows ?? [];
      },
    },
  };
  const llm = {
    routing: () => ({
      availableProviders: options.available ?? ["mock"],
    }),
    health:
      options.health ??
      (async (provider: string) => ({
        provider,
        model: "m",
        status: "ok",
        latencyMs: 12,
        error: null,
        checkedAt: new Date().toISOString(),
      })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ProviderProductionService,
      { provide: PrismaService, useValue: prisma },
      { provide: LlmService, useValue: llm },
    ],
  }).compile();

  return {
    service: moduleRef.get(ProviderProductionService),
    calls,
  };
}

describe("Provider Production API (TASK-1301)", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("API Key Validation", () => {
    it("Provider별 키 형식과 필수 여부를 보고한다 — 값은 노출하지 않는다", async () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-proj-secret-value-1234567890";
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.LLM_FAILOVER_PRIORITY;
      delete process.env.LLM_ROUTE_ANALYSIS;
      delete process.env.LLM_ROUTE_CONTENT;
      delete process.env.LLM_ROUTE_VISION;

      const { service } = await build({ available: ["mock", "openai"] });
      const report = await service.validateProviders();

      const openai = report.providers.find(
        (entry) => entry.provider === "openai",
      )!;
      expect(openai).toMatchObject({
        format: "ok",
        required: true,
        instantiated: true,
        keyEnv: "OPENAI_API_KEY",
      });
      expect(openai.hint).toBe("sk-pro…");
      expect(JSON.stringify(report)).not.toContain("secret-value");

      // 쓰지 않는 Provider는 키가 없어도 막지 않는다 (CTO 결정 1202-②)
      const anthropic = report.providers.find(
        (entry) => entry.provider === "anthropic",
      )!;
      expect(anthropic).toMatchObject({ format: "missing", required: false });
      expect(report.ok).toBe(true);

      // mock은 키가 없으므로 검증 대상이 아니다
      expect(report.providers.some((entry) => entry.provider === "mock")).toBe(
        false,
      );
    });

    it("참조하는데 키가 없거나 형식이 틀리면 blocker로 드러낸다", async () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-xxxxxxxxxxxxxxxxxxxx"; // 플레이스홀더
      process.env.LLM_FAILOVER_PRIORITY = "openai,anthropic";
      delete process.env.ANTHROPIC_API_KEY;

      const { service } = await build({ available: ["mock"] });
      const report = await service.validateProviders();

      expect(report.ok).toBe(false);
      expect(report.blockers.join("\n")).toContain("anthropic");
      expect(report.blockers.join("\n")).toContain("openai");
      expect(
        report.providers.find((entry) => entry.provider === "openai")?.format,
      ).toBe("placeholder");
    });

    it("Live Check는 기본으로 하지 않는다 — 실호출이라 과금된다", async () => {
      process.env.OPENAI_API_KEY = "sk-proj-abcdefghijklmnop1234";
      const checked: string[] = [];
      const { service } = await build({
        available: ["mock", "openai"],
        health: async (provider: string) => {
          checked.push(provider);
          return {
            provider,
            model: "gpt-4o",
            status: "ok",
            latencyMs: 30,
            error: null,
            checkedAt: new Date().toISOString(),
          };
        },
      });

      const off = await service.validateProviders();
      expect(off.liveChecked).toBe(false);
      expect(checked).toEqual([]);
      expect(off.providers.every((entry) => entry.live === null)).toBe(true);

      const on = await service.validateProviders({ live: true });
      expect(on.liveChecked).toBe(true);
      // 어댑터가 만들어진 Provider만 실호출한다 (키 없는 Provider는 무의미)
      expect(checked).toEqual(["openai"]);
      expect(
        on.providers.find((entry) => entry.provider === "openai")?.live?.status,
      ).toBe("ok");
    });

    it("Live Check 실패는 blocker이며, 예외가 나도 보고서로 회수한다", async () => {
      process.env.OPENAI_API_KEY = "sk-proj-abcdefghijklmnop1234";
      const { service } = await build({
        available: ["mock", "openai"],
        health: async () => {
          throw new Error("401 Incorrect API key provided");
        },
      });

      const report = await service.validateProviders({ live: true });
      expect(report.ok).toBe(false);
      expect(
        report.providers.find((entry) => entry.provider === "openai")?.live,
      ).toMatchObject({ status: "error" });
      expect(report.blockers.join("\n")).toContain("401");
    });
  });

  describe("Cost Verification", () => {
    it("성공한 Execution만 최근 구간에서 조회해 검증한다", async () => {
      const { service, calls } = await build({
        rows: [
          {
            id: "e1",
            provider: "openai",
            model: "gpt-4o",
            inputTokens: 1000,
            outputTokens: 500,
            cost: 0.0075,
            createdAt: new Date("2026-07-28T00:00:00.000Z"),
          },
        ],
      });

      const result = await service.verifyCost({ hours: 6 });
      expect(result.ok).toBe(true);
      expect(result.hours).toBe(6);
      expect(result.checked).toBe(1);
      expect(calls[0].where?.status).toBe("SUCCESS");
      expect(calls[0].where?.createdAt?.gte).toBeInstanceOf(Date);
      // 가격표를 함께 실어 보내 조치(단가 등록)를 바로 할 수 있게 한다
      expect(result.pricing.map((entry) => entry.model)).toContain("gpt-4o");
    });

    it("가격표에 없는 모델은 예산 상한 무력화로 보고한다", async () => {
      const { service } = await build({
        rows: [
          {
            id: "e1",
            provider: "openai",
            model: "gpt-5-preview",
            inputTokens: 100,
            outputTokens: 50,
            cost: null,
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.verifyCost({});
      expect(result.ok).toBe(false);
      expect(result.unpricedCalls).toBe(1);
      expect(result.issues[0]).toMatchObject({ kind: "unpriced" });
      expect(result.hours).toBe(24); // 기본 구간
    });

    it("구간은 1시간~30일로 제한한다", async () => {
      const { service } = await build({});
      expect((await service.verifyCost({ hours: 0 })).hours).toBe(1);
      expect((await service.verifyCost({ hours: 99_999 })).hours).toBe(720);
    });
  });

  describe("Production Monitoring", () => {
    it("Provider별 성공률·지연 분포·비용을 계산한다", async () => {
      const rows: ExecutionRow[] = [
        ...Array.from({ length: 9 }, (_, index) => ({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS" as const,
          latencyMs: 1000 + index,
          cost: 0.002,
          createdAt: new Date(),
        })),
        {
          provider: "openai",
          model: "gpt-4o",
          status: "FAILED" as const,
          latencyMs: 30_000,
          cost: null,
          createdAt: new Date(),
        },
      ];

      const { service, calls } = await build({ rows });
      const result = await service.monitor({ minutes: 30 });

      expect(result.windowMinutes).toBe(30);
      expect(calls[0].where?.status).toBeUndefined(); // 실패도 봐야 성공률이 나온다
      expect(result.providers[0]).toMatchObject({
        provider: "openai",
        calls: 10,
        successRate: 0.9,
        status: "degraded",
      });
      expect(result.providers[0].latency?.p50).toBe(1004);
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.status).toBe("degraded");
    });

    it("호출이 없으면 정상이라고 말하지 않는다 (unknown)", async () => {
      const { service } = await build({ rows: [] });
      const result = await service.monitor({});
      expect(result.status).toBe("unknown");
      expect(result.totals.calls).toBe(0);
      expect(result.windowMinutes).toBe(60);
    });
  });
});
