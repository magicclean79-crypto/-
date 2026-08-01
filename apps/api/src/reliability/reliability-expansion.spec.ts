import { Logger } from "@nestjs/common";
import { AUTO_RESUME_MAX_ROUNDS, HEARTBEAT_STALE_MS } from "@acos/core";

import type { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";
import { describeBatch, judgeBatchItem, stopsBatch } from "./batch-stage";
import { JobQueueService } from "./job-queue.service";
import { JobRegistryService } from "./job-registry.service";
import { TokenMeterService } from "./token-meter.service";
import type { JobResult } from "./job-runner.service";

beforeAll(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

// ── 단계별 토큰·비용 (지시 2) ────────────────────────────────

describe("TokenMeterService (TASK-4701)", () => {
  function meter(rows: unknown[]) {
    const prisma = {
      execution: { findMany: jest.fn(async () => rows) },
    } as unknown as PrismaService;
    return { service: new TokenMeterService(prisma), prisma };
  }

  /**
   * 못 잰 것을 0으로 채우면 "이 단계는 공짜였다"로 읽히고, 그 합계로
   * 예산을 재면 상한이 실제보다 여유 있어 보인다.
   */
  it("요청 끈이 없으면 재지 않는다 — 0이 아니라 모른다", async () => {
    const { service, prisma } = meter([]);
    const usage = await service.measure(null, new Date(0), new Date());
    expect(usage.tokens).toBeNull();
    expect(usage.costUsd).toBeNull();
    expect(usage.unpricedCalls).toBeNull();
    // 물어보지도 않았다 — 시간만으로 묶으면 남의 호출까지 센다
    expect(
      (prisma as unknown as { execution: { findMany: jest.Mock } }).execution.findMany,
    ).not.toHaveBeenCalled();
  });

  it("빈 문자열도 끈이 없는 것으로 본다", async () => {
    const { service } = meter([]);
    expect((await service.measure("", new Date(0), new Date())).costUsd).toBeNull();
  });

  /**
   * 물어봤고 답이 "없다"였다 — 이건 모르는 것과 다르다. AI 호출이 없는
   * 단계를 "모름"으로 두면 작업 전체의 합계가 영원히 null이 된다.
   */
  it("호출이 하나도 없었으면 0이라고 말한다", async () => {
    const { service } = meter([]);
    const usage = await service.measure("req-1", new Date(0), new Date());
    expect(usage.calls).toBe(0);
    expect(usage.costUsd).toBe(0);
    expect(usage.tokens).toEqual({ input: 0, output: 0 });
    expect(usage.detail).toContain("과금되는 호출이 없었습니다");
  });

  it("토큰과 비용을 더한다", async () => {
    const { service } = meter([
      { inputTokens: 100, outputTokens: 20, cost: "0.001", model: "gpt-4o" },
      { inputTokens: 50, outputTokens: 10, cost: "0.0005", model: "gpt-4o" },
    ]);
    const usage = await service.measure("req-1", new Date(0), new Date());
    expect(usage.calls).toBe(2);
    expect(usage.tokens).toEqual({ input: 150, output: 30 });
    expect(usage.costUsd).toBeCloseTo(0.0015, 6);
  });

  it("토큰을 모르는 호출이 섞이면 합계를 내지 않는다", async () => {
    const { service } = meter([
      { inputTokens: 100, outputTokens: 20, cost: "0.001", model: "gpt-4o" },
      { inputTokens: null, outputTokens: null, cost: null, model: "새-모델" },
    ]);
    const usage = await service.measure("req-1", new Date(0), new Date());
    expect(usage.tokens).toEqual({ input: null, output: null });
  });

  /** 최소값을 실제값으로 읽으면 예산이 실제보다 여유 있어 보인다 */
  it("비용이 빠진 호출이 있으면 합계가 최소값이라고 말한다", async () => {
    const { service } = meter([
      { inputTokens: 100, outputTokens: 20, cost: "0.001", model: "gpt-4o" },
      { inputTokens: 10, outputTokens: 5, cost: null, model: "가격표에-없는-모델" },
    ]);
    const usage = await service.measure("req-1", new Date(0), new Date());
    expect(usage.unpricedCalls).toBe(1);
    expect(usage.detail).toContain("최소");
  });

  /** 재는 데 실패한 것을 "0원"으로 적지 않는다 */
  it("조회가 실패해도 0원이라고 하지 않는다", async () => {
    const prisma = {
      execution: {
        findMany: jest.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as unknown as PrismaService;
    const usage = await new TokenMeterService(prisma).measure(
      "req-1",
      new Date(0),
      new Date(),
    );
    expect(usage.costUsd).toBeNull();
  });
});

// ── 묶음 한 건의 판정 (지시 1) ────────────────────────────────

describe("judgeBatchItem (TASK-4701)", () => {
  /**
   * 4603 라이브 결함 4건 중 2건이 이 규칙이었다. 같은 모양의 작업이 넷이
   * 되었으므로 한자리에 모았다.
   */
  it("공통 원인이면 묶음을 멈춘다 (던진다)", async () => {
    await expect(
      judgeBatchItem(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        });
      }),
    ).rejects.toThrow();
  });

  it("정책으로 막힌 것도 묶음을 멈춘다", async () => {
    await expect(
      judgeBatchItem(async () => {
        throw new Error("일간 AI 비용 예산을 초과해 차단했습니다");
      }),
    ).rejects.toThrow();
  });

  it("이 한 건의 문제면 건너뛰고 사유를 남긴다", async () => {
    const verdict = await judgeBatchItem(async () => {
      throw Object.assign(new Error("no such file"), { status: 404 });
    });
    expect(verdict.done).toBe(false);
    if (!verdict.done) {
      expect(verdict.kind).toBe("rejected");
      expect(verdict.reason).not.toContain("no such file");
      expect(verdict.detail).toContain("no such file");
    }
  });

  /**
   * 모르는 실패 하나로 묶음 전체를 멈추면 그 한 건 때문에 나머지가 영영
   * 안 돌고, 그 이유를 아무도 모른다.
   */
  it("모르는 실패는 건너뛴다", async () => {
    const verdict = await judgeBatchItem(async () => {
      throw new Error("무언가 이상함");
    });
    expect(verdict.done).toBe(false);
  });

  /**
   * **던지지 않았다고 성공이 아니다** — 4603 라이브 결함.
   */
  it("던지지 않고 실패로 돌아온 결과를 성공으로 세지 않는다", async () => {
    const verdict = await judgeBatchItem<string>(async () => ({
      ok: false,
      error: "이 파일에서 글자를 찾지 못했습니다",
    }));
    expect(verdict.done).toBe(false);
  });

  /**
   * Provider가 통째로 죽은 것을 "이 한 건의 문제"로 보면, 전부 건너뛰고
   * 작업은 성공으로 끝난다 — 4603 라이브 결함.
   */
  it("던지지 않고 돌아온 실패도 공통 원인이면 묶음을 멈춘다", async () => {
    await expect(
      judgeBatchItem<string>(async () => ({
        ok: false,
        error: "fetch failed (원인: connect ECONNREFUSED 127.0.0.1:9100)",
      })),
    ).rejects.toThrow();
  });

  it("성공하면 값을 그대로 돌려준다", async () => {
    const verdict = await judgeBatchItem<string>(async () => ({
      ok: true,
      value: "ocr-1",
    }));
    expect(verdict).toEqual({ done: true, value: "ocr-1" });
  });

  /**
   * 거버넌스 사유는 사람이 쓴 글이라 언젠가 우리 차단 문구와 겹친다.
   * 겹치는 날 한 건 때문에 묶음이 통째로 멈춘다.
   */
  it("부르는 쪽이 '이 한 건의 문제'라고 하면 멈추지 않는다", async () => {
    const verdict = await judgeBatchItem<string>(
      async () => {
        throw new Error("발행 거버넌스 판정을 통과하지 못했습니다 — 차단했습니다");
      },
      { itemProblem: () => true },
    );
    expect(verdict.done).toBe(false);
  });

  /**
   * 라이브에서 잡은 것 (TASK-4701): Vision이 503을 내는데도 묶음이
   * "성공"으로 끝났다. 어댑터가 남긴 문장에서 상태 코드를 되찾게 고쳤다.
   */
  it("상대가 통째로 죽으면(503) 묶음을 멈춘다", async () => {
    await expect(
      judgeBatchItem<string>(async () => ({
        ok: false,
        error: "Google Cloud Vision 장애 (503) — 우리 설정 문제가 아닙니다: Backend unavailable",
      })),
    ).rejects.toThrow();
  });

  /**
   * 자격 증명은 항목마다 다르지 않다 — 한 건이 401을 받았다면 나머지도
   * 전부 받는다. "이 한 건의 문제"로 처리하면 키가 만료된 날 전부 건너뛰고
   * 작업은 성공으로 끝난다.
   */
  it("키가 틀린 것은 한 건의 문제가 될 수 없다", async () => {
    await expect(
      judgeBatchItem<string>(async () => ({
        ok: false,
        error: "Google Cloud Vision 인증 실패 (403) — API 키가 유효하지 않습니다",
      })),
    ).rejects.toThrow();
  });

  /** 없는 파일 하나 때문에 나머지 아홉 건을 못 하면 묶음의 의미가 없다 */
  it("파일 하나가 없는 것은 그 한 건의 문제다", async () => {
    const verdict = await judgeBatchItem<string>(async () => ({
      ok: false,
      error: "이미지를 읽을 수 없습니다: The specified key does not exist.",
    }));
    expect(verdict.done).toBe(false);
  });

  /** 버킷이 통째로 없으면 전부의 문제다 */
  it("버킷이 없는 것은 전부의 문제다", async () => {
    await expect(
      judgeBatchItem<string>(async () => ({
        ok: false,
        error: "이미지를 읽을 수 없습니다: 버킷을 찾을 수 없습니다: acos",
      })),
    ).rejects.toThrow();
  });

  it("stopsBatch는 재시도 가능·막힌 것·자격 증명 실패를 멈춘다", () => {
    expect(stopsBatch("network", true)).toBe(true);
    expect(stopsBatch("blocked", false)).toBe(true);
    expect(stopsBatch("unauthorized", false)).toBe(true);
    expect(stopsBatch("rejected", false)).toBe(false);
    expect(stopsBatch("unknown", false)).toBe(false);
  });
});

describe("describeBatch (TASK-4701)", () => {
  /** 아무것도 못 얻은 실행이 성공으로 읽히면 안 된다 */
  it("전부 건너뛰었으면 그 사실을 말한다", () => {
    const text = describeBatch({
      total: 3,
      done: 0,
      skipped: [{ reason: "a" }, { reason: "b" }, { reason: "c" }],
      skippedIds: ["a", "b", "c"],
      unit: "단계",
    });
    expect(text).toContain("결과를 얻은 항목이 하나도 없습니다");
  });

  it("건너뛴 것이 없으면 조용하다", () => {
    const text = describeBatch({
      total: 3,
      done: 3,
      skipped: [],
      skippedIds: [],
      unit: "단계",
    });
    expect(text).not.toContain("건너뛴");
  });

  it("건너뛴 항목이 많으면 잘라 보여주되 잘랐다고 말한다", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `id-${index}`);
    const text = describeBatch({
      total: 15,
      done: 0,
      skipped: ids.map(() => ({ reason: "x" })),
      skippedIds: ids,
      unit: "단계",
    });
    expect(text).toContain("외 5건");
  });
});

// ── 등록소 (지시 3) ──────────────────────────────────────────

describe("JobRegistryService (TASK-4701)", () => {
  const result = { jobId: "j1" } as JobResult;

  it("모르는 종류는 null이다 — 실패가 아니라 모른다", async () => {
    const registry = new JobRegistryService();
    expect(registry.knows("없는-종류")).toBe(false);
    expect(await registry.resume("없는-종류", "j1", {})).toBeNull();
  });

  it("등록한 종류를 이어한다", async () => {
    const registry = new JobRegistryService();
    registry.register("t", {
      resume: async () => result,
      countItems: (input) => (input as { ids: string[] }).ids.length,
    });
    expect(await registry.resume("t", "j1", {})).toBe(result);
    expect(registry.countItems("t", { ids: ["a", "b"] })).toBe(2);
    expect(registry.kinds()).toEqual(["t"]);
  });

  /** 셀 줄 모르는 것은 0이며, 0은 "항목이 없다"가 아니다 */
  it("모르는 종류의 항목 수는 0이다", () => {
    expect(new JobRegistryService().countItems("없는-종류", { ids: ["a"] })).toBe(0);
  });
});

// ── 자동 이어하기 큐 (지시 3) ─────────────────────────────────

describe("JobQueueService (TASK-4701)", () => {
  function build(rows: Record<string, unknown>[]) {
    const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    const prisma = {
      jobRun: {
        findMany: jest.fn(async () => rows),
        updateMany: jest.fn(
          async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updates.push(args);
            return { count: 1 };
          },
        ),
      },
    } as unknown as PrismaService;
    const registry = new JobRegistryService();
    const resumed: string[] = [];
    registry.register("ocr-batch", {
      resume: async (jobId) => {
        resumed.push(jobId);
        return { jobId } as JobResult;
      },
      countItems: () => 1,
    });
    const queue = new JobQueueService(prisma, registry, new RequestContextService());
    return { queue, updates, resumed, prisma };
  }

  const now = Date.parse("2026-08-01T12:00:00Z");

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "job-1",
      kind: "ocr-batch",
      status: "failed",
      failureKind: "network",
      autoResumeRounds: 0,
      heartbeatAt: null,
      input: { imageIds: ["a"] },
      startedAt: new Date(now - 60_000),
      updatedAt: new Date(now - 3_600_000),
      autoResumeAt: null,
      ...overrides,
    };
  }

  /**
   * 기본을 꺼짐으로 둔 이유: 자동 이어하기는 아무도 안 보는 사이에 돈이
   * 나가는 호출을 한다. 켜는 것은 그 사실을 아는 사람의 결정이어야 한다.
   */
  it("기본은 꺼져 있다", () => {
    delete process.env.JOB_AUTO_RESUME;
    expect(build([]).queue.enabled).toBe(false);
    process.env.JOB_AUTO_RESUME = "on";
    expect(build([]).queue.enabled).toBe(true);
    delete process.env.JOB_AUTO_RESUME;
  });

  it("이어할 수 있는 작업을 이어한다", async () => {
    const { queue, resumed } = build([row()]);
    const report = await queue.sweep(now);
    expect(report.resumed).toBe(1);
    // 실행은 비동기로 떨어져 나가므로 한 틱 기다린다
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resumed).toEqual(["job-1"]);
  });

  /**
   * 두 인스턴스가 같은 작업을 집으면 안 된다 — 조건부 갱신으로 막는다.
   */
  it("가져갈 때 지금 상태를 조건에 담는다", async () => {
    const { queue, updates } = build([row()]);
    await queue.sweep(now);
    const claim = updates.find((entry) => entry.data.autoResumeRounds === 1);
    expect(claim?.where).toMatchObject({
      id: "job-1",
      status: "failed",
      autoResumeRounds: 0,
    });
  });

  it("다시 해도 같은 실패는 자동으로 돌리지 않는다", async () => {
    const { queue, resumed } = build([row({ failureKind: "blocked" })]);
    const report = await queue.sweep(now);
    expect(report.resumed).toBe(0);
    expect(resumed).toEqual([]);
    expect(report.summary).toContain("사람이 봐야 하는 작업");
  });

  it("상한에 닿은 작업은 그만두되 목록에 남는다", async () => {
    const { queue } = build([row({ autoResumeRounds: AUTO_RESUME_MAX_ROUNDS })]);
    const report = await queue.sweep(now);
    expect(report.resumed).toBe(0);
    expect(report.summary).toContain("자동이 포기한 작업");
  });

  /**
   * 돌고 있는 작업을 죽었다고 보고 또 돌리면 같은 일을 두 번 산다.
   */
  it("심장박동이 있는 작업은 건드리지 않는다", async () => {
    const { queue, updates } = build([
      row({ status: "running", heartbeatAt: new Date(now - 5_000) }),
    ]);
    const report = await queue.sweep(now);
    expect(report.orphaned).toBe(0);
    expect(report.resumed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("심장박동이 멈춘 작업을 중단됨으로 표시한다", async () => {
    const { queue, updates } = build([
      row({ status: "running", heartbeatAt: new Date(now - HEARTBEAT_STALE_MS - 1000) }),
    ]);
    const report = await queue.sweep(now);
    expect(report.orphaned).toBe(1);
    expect(updates[0].data.status).toBe("interrupted");
    // 표시만 하고 같은 차례에 돌리지는 않는다 — 잘못 판단했을 때
    // 되돌릴 틈이 없어진다
    expect(report.resumed).toBe(0);
  });

  /** 모르는 종류를 비슷한 것으로 대신 돌리지 않는다 */
  it("이어하는 법을 모르는 종류는 손대지 않는다", async () => {
    const { queue, resumed } = build([row({ kind: "모르는-작업" })]);
    const report = await queue.sweep(now);
    expect(report.unknownKind).toBe(1);
    expect(report.resumed).toBe(0);
    expect(resumed).toEqual([]);
    expect(report.summary).toContain("모르는 종류");
  });

  it("훑기가 겹치면 이번 차례를 건너뛴다", async () => {
    const { queue } = build([row()]);
    const first = queue.sweep(now);
    const second = await queue.sweep(now);
    expect(second.summary).toContain("건너뜁니다");
    await first;
  });
});
