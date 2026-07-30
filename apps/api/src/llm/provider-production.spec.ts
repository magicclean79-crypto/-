import { Test } from "@nestjs/testing";
import { PricingService } from "../pricing/pricing.service";
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
  where?: {
    createdAt?: { gte?: Date };
    status?: string | { in: string[] };
    diagnostic?: boolean;
    feature?: string;
    provider?: { not?: string };
  };
}

/** OCR 실행 이력 표본 (TASK-3001) */
interface OcrRow {
  id: string;
  provider: string;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  units: number;
  cost: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

const ORIGINAL_ENV = { ...process.env };

async function build(options: {
  rows?: ExecutionRow[];
  available?: string[];
  diagnosticCount?: number;
  health?: (provider: string) => Promise<unknown>;
  /** Provider별 성공 실행 수 (TASK-2901 연결 순서 판정 근거) */
  llmSuccesses?: Record<string, number>;
  visionSuccesses?: number;
  ocrSuccesses?: Record<string, number>;
  /** OCR 실행 이력 (비용 검증·관측용) */
  ocrRows?: OcrRow[];
  /** 적용된 단가 이력 (TASK-3101 — 시점별 대조) */
  appliedPricing?: {
    target: string;
    key: string;
    price: Record<string, number>;
    appliedAt: Date;
  }[];
}) {
  const calls: FindManyArgs[] = [];
  const countCalls: FindManyArgs[] = [];
  const groupByCalls: FindManyArgs[] = [];
  const ocrFindManyCalls: FindManyArgs[] = [];
  /**
   * groupBy는 **조건을 실제로 본다** (TASK-2901): mock 제외·SUCCESS 조건을
   * 무시하면 "실패한 호출도 연결 근거로 세는" 결함이 검증되지 않는다.
   */
  const groupOf = (source: Record<string, number>, args: FindManyArgs) =>
    Object.entries(source)
      .filter(([provider]) => provider !== args.where?.provider?.not)
      .map(([provider, count]) => ({ provider, _count: { _all: count } }));

  const prisma = {
    // 적용된 단가 이력 (TASK-3101) — 비용 검증이 시점별 단가로 대조한다
    pricingProposal: {
      findMany: async () => options.appliedPricing ?? [],
    },
    execution: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        return options.rows ?? [];
      },
      // 진단 호출 수 (TASK-1302, CTO 결정 1301-③) /
      // vision-analysis 성공 수 (TASK-2901) — 조건으로 가른다
      count: async (args: FindManyArgs) => {
        countCalls.push(args);
        if (args.where?.feature === "vision-analysis") {
          return options.visionSuccesses ?? 0;
        }
        return options.diagnosticCount ?? 0;
      },
      groupBy: async (args: FindManyArgs) => {
        groupByCalls.push(args);
        return groupOf(options.llmSuccesses ?? {}, args);
      },
    },
    ocrResult: {
      groupBy: async (args: FindManyArgs) => {
        groupByCalls.push(args);
        return groupOf(options.ocrSuccesses ?? {}, args);
      },
      /**
       * OCR 비용 검증·관측이 읽는다 (TASK-3001) — **조건을 실제로 본다**:
       * 무시하면 실패한 실행을 비용 검증에 넣거나, 아직 돌고 있는 실행을
       * 성공률 판정에 섞는 결함이 검증되지 않는다.
       */
      findMany: async (args: FindManyArgs) => {
        ocrFindManyCalls.push(args);
        const rows = options.ocrRows ?? [];
        const status = args.where?.status;
        return rows.filter((row) => {
          if (typeof status === "string") {
            return row.status === status;
          }
          if (status && Array.isArray(status.in)) {
            return status.in.includes(row.status);
          }
          return true;
        });
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
      // 실제 PricingService를 쓴다 — 스텁을 끼우면 "적용된 단가로 대조하는가"가
      // 검증되지 않는다 (TASK-3101)
      PricingService,
    ],
  }).compile();

  return {
    service: moduleRef.get(ProviderProductionService),
    calls,
    countCalls,
    groupByCalls,
    ocrFindManyCalls,
  };
}

/** OCR 실행 1건 */
function ocrRow(overrides: Partial<OcrRow> = {}): OcrRow {
  const now = new Date();
  return {
    id: "o-1",
    provider: "google-vision",
    status: "SUCCESS",
    units: 1,
    cost: 0.0015,
    startedAt: new Date(now.getTime() - 300),
    completedAt: now,
    createdAt: now,
    ...overrides,
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

      const { service, calls, countCalls } = await build({
        rows,
        diagnosticCount: 4,
      });
      const result = await service.monitor({ minutes: 30 });

      expect(result.windowMinutes).toBe(30);
      expect(calls[0].where?.status).toBeUndefined(); // 실패도 봐야 성공률이 나온다
      // 진단 호출은 관측에서 제외하되 숨기지 않는다 (CTO 결정 1301-③)
      expect(calls[0].where?.diagnostic).toBe(false);
      expect(countCalls[0].where?.diagnostic).toBe(true);
      expect(result.diagnosticCalls).toBe(4);
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

  describe("Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤)", () => {
    const OPENAI_KEY = `sk-${"a".repeat(30)}`;
    const GOOGLE_KEY = `AIza${"c".repeat(31)}`;

    it("성공 기록이 없으면 연결됨으로 세지 않는다", async () => {
      process.env.OPENAI_API_KEY = OPENAI_KEY;
      const { service } = await build({});

      const rollout = await service.rollout();
      const openai = rollout.stages.find((stage) => stage.stage === "openai")!;
      expect(openai.status).toBe("unverified");
      expect(rollout.summary).toEqual({ connected: 0, total: 5 });
      expect(rollout.next).toBe("openai");
    });

    it("성공 기록이 있으면 연결됨이고 근거가 붙는다", async () => {
      process.env.OPENAI_API_KEY = OPENAI_KEY;
      const { service } = await build({ llmSuccesses: { openai: 4 } });

      const rollout = await service.rollout();
      const openai = rollout.stages.find((stage) => stage.stage === "openai")!;
      expect(openai.status).toBe("connected");
      expect(openai.evidence).toBe("최근 30일 실 호출 성공 4건");
      expect(rollout.next).toBe("anthropic");
    });

    it("근거를 셀 때 실패 호출과 mock을 제외한다", async () => {
      // 실패한 호출이나 mock 호출을 근거로 세면 붙지 않은 것이 붙은 것으로 보인다
      const { groupByCalls, service } = await build({});
      await service.rollout();

      for (const call of groupByCalls) {
        expect(call.where?.status).toBe("SUCCESS");
        expect(call.where?.provider).toEqual({ not: "mock" });
        // 근거에는 기한이 있다 (최근 30일)
        expect(call.where?.createdAt?.gte).toBeInstanceOf(Date);
      }
    });

    it("Vision 근거는 vision-analysis 성공 수로 센다", async () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = OPENAI_KEY;
      const { service, countCalls } = await build({ visionSuccesses: 2 });

      const rollout = await service.rollout();
      const vision = rollout.stages.find((stage) => stage.stage === "vision")!;
      expect(vision.status).toBe("connected");
      expect(
        countCalls.some((call) => call.where?.feature === "vision-analysis"),
      ).toBe(true);
    });

    it("OCR 근거는 OCR 실행 이력에서 센다", async () => {
      process.env.OCR_PROVIDER = "google-vision";
      process.env.GOOGLE_VISION_API_KEY = GOOGLE_KEY;
      const { service } = await build({
        ocrSuccesses: { "google-vision": 1 },
      });

      const ocr = (await service.rollout()).stages.find(
        (stage) => stage.stage === "ocr",
      )!;
      expect(ocr.status).toBe("connected");
      expect(ocr.evidence).toBe("최근 30일 OCR 실행 성공 1건");
    });

    it("어떤 상태에서도 키 값이 새지 않는다", async () => {
      process.env.OPENAI_API_KEY = OPENAI_KEY;
      process.env.OCR_PROVIDER = "google-vision";
      process.env.GOOGLE_VISION_API_KEY = GOOGLE_KEY;
      const { service } = await build({});

      const payload = JSON.stringify(await service.rollout());
      expect(payload).not.toContain(OPENAI_KEY);
      expect(payload).not.toContain(GOOGLE_KEY);
    });
  });

  describe("OCR 비용·관측 편입 (TASK-3001, CTO 결정 2901-④)", () => {
    it("비용 검증이 LLM과 OCR을 합해 보고하고, 원장별로 밝힌다", async () => {
      const { service } = await build({
        rows: [
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            inputTokens: 1000,
            outputTokens: 500,
            cost: 0.0075,
            createdAt: new Date(),
          },
        ],
        ocrRows: [ocrRow(), ocrRow({ id: "o-2" })],
      });

      const result = await service.verifyCost({ hours: 24 });
      expect(result.checked).toBe(3); // LLM 1 + OCR 2
      expect(result.bySource).toEqual({ llm: 0.0075, ocr: 0.003 });
      expect(result.recordedTotal).toBe(0.0105);
      expect(result.ok).toBe(true);
      // OCR 단가표도 함께 보여 준다
      expect(result.ocrPricing.map((row) => row.provider)).toContain(
        "google-vision",
      );
    });

    it("가격표에 없는 OCR 엔진은 미산정으로 보고한다", async () => {
      const { service } = await build({
        ocrRows: [ocrRow({ provider: "clova", cost: null })],
      });

      const result = await service.verifyCost({ hours: 24 });
      expect(result.ok).toBe(false);
      expect(result.unpricedCalls).toBe(1);
      expect(
        result.issues.find((issue) => issue.provider === "clova")?.message,
      ).toContain("예산 상한이 적용되지 않습니다");
    });

    it("비용 검증은 성공한 OCR 실행만 본다", async () => {
      // 실패한 호출을 비용으로 세면 나가지 않은 돈이 지출로 잡힌다
      const { service, ocrFindManyCalls } = await build({
        ocrRows: [ocrRow(), ocrRow({ id: "o-2", status: "FAILED", cost: null })],
      });

      const result = await service.verifyCost({ hours: 24 });
      expect(result.checked).toBe(1);
      expect(ocrFindManyCalls[0].where?.status).toBe("SUCCESS");
    });

    it("OCR 관측은 LLM과 같은 판정 함수를 쓴다", async () => {
      const { service } = await build({
        ocrRows: [
          ocrRow(),
          ocrRow({ id: "o-2" }),
          ocrRow({ id: "o-3", status: "FAILED", cost: null }),
        ],
      });

      const monitor = await service.monitorOcr({ minutes: 60 });
      expect(monitor.totals.calls).toBe(3);
      expect(monitor.totals.successCount).toBe(2);
      expect(monitor.providers[0].provider).toBe("google-vision");
      // OCR에는 진단 호출 개념이 없다
      expect(monitor.diagnosticCalls).toBe(0);
    });

    it("아직 돌고 있는 실행은 성공률 판정에 섞지 않는다", async () => {
      const { service, ocrFindManyCalls } = await build({
        ocrRows: [ocrRow(), ocrRow({ id: "o-2", status: "RUNNING", cost: null })],
      });

      const monitor = await service.monitorOcr({ minutes: 60 });
      expect(monitor.totals.calls).toBe(1);
      expect(
        (ocrFindManyCalls.at(-1)!.where?.status as { in: string[] }).in.sort(),
      ).toEqual(["FAILED", "SUCCESS"]);
    });

    it("소요 시간은 시작~완료로 센다", async () => {
      const completedAt = new Date();
      const { service } = await build({
        ocrRows: Array.from({ length: 5 }, (_, index) =>
          ocrRow({
            id: `o-${index}`,
            startedAt: new Date(completedAt.getTime() - 250),
            completedAt,
          }),
        ),
      });

      const monitor = await service.monitorOcr({ minutes: 60 });
      expect(monitor.providers[0].latency?.p50).toBe(250);
    });
  });
});
