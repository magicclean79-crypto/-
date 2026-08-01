import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";
import { JobContextService } from "./job-context.service";
import { JobLoggerService } from "./job-logger.service";
import { JobRunnerService } from "./job-runner.service";
import type { JobDefinition } from "./job-runner.service";
import { TokenMeterService } from "./token-meter.service";

/** job_runs · job_events · job_stage_metrics를 흉내 내는 인메모리 Prisma */
function createPrismaMock() {
  const runs: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const metrics: Record<string, unknown>[] = [];
  let sequence = 0;

  return {
    runs,
    events,
    metrics,
    jobRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, startedAt: new Date(), completedAt: null };
        runs.push(row as never);
        return { ...row };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = runs.find((entry) => entry.id === where.id);
          if (row === undefined) throw new Error("no job");
          Object.assign(row, data);
          return { ...row };
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = runs.find((entry) => entry.id === where.id);
        return row === undefined ? null : { ...row };
      }),
      findMany: jest.fn(async () => runs.map((row) => ({ ...row }))),
    },
    jobEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = { id: `evt-${sequence}`, at: new Date(), ...data };
        events.push(row);
        return { ...row };
      }),
      findMany: jest.fn(async () => events.map((row) => ({ ...row }))),
    },
    execution: {
      // 단계별 토큰·비용은 **다시 재지 않고 기록에서 읽어 옵니다**
      // (TokenMeterService, TASK-4701). 이 테스트에는 호출 기록이 없으므로
      // "물어봤고 없었다" = 0건입니다.
      findMany: jest.fn(async () => []),
    },
    jobStageMetric: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = { id: `m-${sequence}`, at: new Date(), ...data };
        metrics.push(row);
        return { ...row };
      }),
      findMany: jest.fn(async () => metrics.map((row) => ({ ...row }))),
    },
  };
}

/** 테스트에서 대기하지 않는 실행기 */
class NoWaitRunner extends JobRunnerService {
  protected override wait(): Promise<void> {
    return Promise.resolve();
  }
}

interface CountState {
  visited: string[];
}

async function build(prisma: ReturnType<typeof createPrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: JobRunnerService, useClass: NoWaitRunner },
      JobContextService,
      JobLoggerService,
      RequestContextService,
      TokenMeterService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return {
    runner: moduleRef.get(JobRunnerService),
    context: moduleRef.get(JobContextService),
  };
}

function definition(
  stages: { name: string; run: (state: CountState) => Promise<CountState>; timeoutMs?: number }[],
): JobDefinition<{ items: string[] }, CountState> {
  return {
    kind: "test-job",
    stages: stages.map((stage) => ({
      name: stage.name,
      timeoutMs: stage.timeoutMs,
      run: (state) => stage.run(state),
    })),
    initial: () => ({ visited: [] }),
    snapshot: (state) => ({ visited: state.visited }),
    restore: (_input, checkpoints) => {
      const newest = checkpoints
        .filter((row) => row.done)
        .reduce<(typeof checkpoints)[number] | null>(
          (best, row) => (best === null || row.at > best.at ? row : best),
          null,
        );
      const output = (newest?.output ?? {}) as { visited?: string[] };
      return { visited: Array.isArray(output.visited) ? output.visited : [] };
    },
  };
}

describe("JobRunnerService (TASK-4603)", () => {
  beforeAll(() => {
    // 테스트 출력이 로그로 덮이지 않게 — 로그 내용 자체는 따로 검증한다
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("모든 단계를 순서대로 밟고 성공으로 남는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([
        { name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) },
        { name: "b", run: async (state) => ({ visited: [...state.visited, "b"] }) },
      ]),
      { items: ["x"] },
    );

    expect(result.status).toBe("succeeded");
    expect(result.completedStages).toEqual(["a", "b"]);
    expect(prisma.runs[0].status).toBe("succeeded");
  });

  /**
   * 실패한 단계가 얼마나 걸렸는지가 가장 알고 싶은 값인데, 던지면 그 위에서
   * 계측이 유실된다.
   */
  it("실패한 단계도 계측이 남는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    await runner.run(
      definition([
        { name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) },
        { name: "b", run: async () => { throw new Error("boom"); } },
      ]),
      { items: ["x"] },
    );

    expect(prisma.metrics).toHaveLength(2);
    expect(prisma.metrics[1]).toMatchObject({ stage: "b", ok: false });
    expect(typeof prisma.metrics[1].durationMs).toBe("number");
  });

  it("끝난 단계까지 체크포인트가 남는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([
        { name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) },
        { name: "b", run: async () => { throw new Error("boom"); } },
      ]),
      { items: ["x"] },
    );

    expect(result.status).toBe("failed");
    expect(result.completedStages).toEqual(["a"]);
    const checkpoints = prisma.runs[0].checkpoints as unknown as {
      stage: string;
      done: boolean;
    }[];
    expect(checkpoints).toEqual([expect.objectContaining({ stage: "a", done: true })]);
  });

  /**
   * 이것이 체크포인트의 존재 이유다 — 앞의 단계는 이미 값을 치렀다.
   */
  it("이어하면 끝난 단계를 다시 하지 않는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const calls: string[] = [];
    const stages = (failB: boolean) =>
      definition([
        {
          name: "a",
          run: async (state) => {
            calls.push("a");
            return { visited: [...state.visited, "a"] };
          },
        },
        {
          name: "b",
          run: async (state) => {
            calls.push("b");
            if (failB) throw new Error("boom");
            return { visited: [...state.visited, "b"] };
          },
        },
      ]);

    const first = await runner.run(stages(true), { items: ["x"] });
    expect(calls).toEqual(["a", "b"]);

    const second = await runner.run(stages(false), { items: ["x"] }, { resumeJobId: first.jobId });
    // a는 다시 부르지 않는다
    expect(calls).toEqual(["a", "b", "b"]);
    expect(second.status).toBe("succeeded");
    expect(second.attempts).toBe(2);
    // 같은 행에 이어 쓴다 — 새 행을 만들면 앞의 시도가 없던 일이 된다
    expect(prisma.runs).toHaveLength(1);
  });

  /**
   * 라이브에서 잡은 결함: 첫 단계에서 죽은 작업을 이어했더니 **새 행이
   * 생기고** 앞의 실패가 영영 failed로 남았다. planResume이 그때 "fresh"를
   * 돌려주는데, 그건 "건너뛸 것이 없다"는 뜻이지 "다른 작업"이라는 뜻이
   * 아니다.
   */
  it("끝난 단계가 없어도 이어하면 같은 행에 이어 쓴다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const make = (fail: boolean) =>
      definition([
        {
          name: "a",
          run: async (state) => {
            if (fail) throw new Error("boom");
            return { visited: [...state.visited, "a"] };
          },
        },
      ]);

    const first = await runner.run(make(true), { items: ["x"] });
    expect(first.completedStages).toEqual([]);

    const second = await runner.run(make(false), { items: ["x"] }, { resumeJobId: first.jobId });
    expect(second.jobId).toBe(first.jobId);
    expect(second.attempts).toBe(2);
    expect(prisma.runs).toHaveLength(1);
    expect(prisma.runs[0].status).toBe("succeeded");
    // 앞의 실패 흔적이 지워지지 않는다 — 몇 번 만에 됐는지가 남는다
    expect(prisma.runs[0].attempts).toBe(2);
  });

  /**
   * 바뀐 입력에 옛 결과를 붙이면 그 결과는 어느 입력의 것도 아니다.
   */
  it("입력이 달라지면 이어하지 않고 처음부터 한다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const calls: string[] = [];
    const make = (fail: boolean) =>
      definition([
        {
          name: "a",
          run: async (state) => {
            calls.push("a");
            if (fail) throw new Error("boom");
            return { visited: [...state.visited, "a"] };
          },
        },
      ]);

    const first = await runner.run(make(true), { items: ["x"] });
    calls.length = 0;
    await runner.run(make(false), { items: ["다른 입력"] }, { resumeJobId: first.jobId });
    expect(calls).toEqual(["a"]);
    // 입력이 달라 새 작업으로 시작한다
    expect(prisma.runs).toHaveLength(2);
  });

  /**
   * 끝나지 않는 단계는 실패보다 나쁘다 — 실패는 알림이 오지만 멈춰 있는
   * 것은 아무도 모른다.
   */
  it("시간 안에 안 끝나면 중단하고 시간 초과로 분류한다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([
        {
          name: "hang",
          timeoutMs: 20,
          run: () =>
            new Promise<CountState>((resolve) => {
              const timer = setTimeout(() => resolve({ visited: [] }), 5_000);
              timer.unref?.();
            }),
        },
      ]),
      { items: ["x"] },
    );

    expect(result.status).toBe("failed");
    expect(result.failureKind).toBe("timeout");
    expect(prisma.runs[0].failureKind).toBe("timeout");
  });

  /**
   * 정책은 기다린다고 바뀌지 않는다.
   */
  it("정책으로 막힌 실패는 이어할 수 있다고 말하지 않는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([
        { name: "a", run: async () => { throw new Error("예산을 초과해 차단했습니다"); } },
      ]),
      { items: ["x"] },
    );

    expect(result.failureKind).toBe("blocked");
    expect(result.detail).not.toContain("이어할 수 있습니다");
  });

  /**
   * 원문에 무엇이 들어 있는지 우리는 미리 알 수 없다.
   */
  it("사용자 문장과 운영자 원문을 따로 남긴다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    await runner.run(
      definition([
        {
          name: "a",
          run: async () => {
            throw Object.assign(new Error("sk-secret-123 로 호출 실패"), { status: 500 });
          },
        },
      ]),
      { items: ["x"] },
    );

    expect(String(prisma.runs[0].userMessage)).not.toContain("sk-secret-123");
    expect(String(prisma.runs[0].lastError)).toContain("sk-secret-123");
  });

  it("작업 로그가 작업 id와 단계를 달고 남는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([{ name: "a", run: async (state) => state }]),
      { items: ["x"] },
    );

    expect(prisma.events.length).toBeGreaterThan(0);
    for (const event of prisma.events) {
      expect(event.jobId).toBe(result.jobId);
      expect(typeof event.stage).toBe("string");
    }
  });

  /**
   * 로그를 남기다 서비스가 죽으면 그건 로그가 아니라 사고다.
   */
  it("로그 기록이 실패해도 작업은 끝난다", async () => {
    const prisma = createPrismaMock();
    prisma.jobEvent.create.mockRejectedValue(new Error("로그 표가 없음"));
    const { runner } = await build(prisma);
    const result = await runner.run(
      definition([{ name: "a", run: async (state) => state }]),
      { items: ["x"] },
    );
    expect(result.status).toBe("succeeded");
  });

  /**
   * 프로세스 전체 값을 이 단계의 것이라고 말하지 않는다.
   */
  it("메모리 칸을 프로세스 값으로 남긴다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);
    await runner.run(definition([{ name: "a", run: async (state) => state }]), {
      items: ["x"],
    });
    expect(prisma.metrics[0]).toHaveProperty("processHeapDeltaBytes");
    expect(prisma.metrics[0]).not.toHaveProperty("memoryUsedBytes");
  });

  it("작업 컨텍스트가 단계에 따라 바뀐다", async () => {
    const prisma = createPrismaMock();
    const { runner, context } = await build(prisma);
    const seen: string[] = [];
    await runner.run(
      definition([
        {
          name: "a",
          run: async (state) => {
            seen.push(context.current()?.stage ?? "-");
            return state;
          },
        },
        {
          name: "b",
          run: async (state) => {
            seen.push(context.current()?.stage ?? "-");
            return state;
          },
        },
      ]),
      { items: ["x"] },
    );
    expect(seen).toEqual(["a", "b"]);
    // 작업이 끝나면 컨텍스트가 남지 않는다
    expect(context.current()).toBeNull();
  });
});

/**
 * 죽음 판정과 성공 문구. (TASK-4701 — 라이브에서 잡음)
 */
describe("JobRunnerService — 심장박동과 성공 문구 (TASK-4701)", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  /**
   * 박동을 30초 주기로만 찍으면 **30초 안에 끝나는 작업은 박동이 한 번도
   * 없습니다.** 큐는 그때 시작 시각을 보는데, 이어한 작업의 시작 시각은
   * 원래 시작한 때라 이미 오래됐습니다 — 그래서 큐가 **지금 돌고 있는
   * 작업을 죽었다고 표시**했습니다.
   */
  it("시작하는 순간 심장박동을 찍는다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);

    await runner.run(
      definition([{ name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) }]),
      { items: ["x"] },
    );

    expect(prisma.runs[0].heartbeatAt).toBeInstanceOf(Date);
  });

  /**
   * 화면에 "성공"이라는 표와 "서버가 멈춰 중단됐습니다"라는 문장이 나란히
   * 떴습니다 — 같은 사실에 두 개의 답입니다.
   */
  it("성공한 작업이 실패 문구를 달고 있지 않다", async () => {
    const prisma = createPrismaMock();
    const { runner } = await build(prisma);

    const first = await runner.run(
      definition([
        { name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) },
        {
          name: "b",
          run: async () => {
            throw Object.assign(new Error("끊김"), { code: "ECONNRESET" });
          },
        },
      ]),
      { items: ["x"] },
    );
    expect(prisma.runs[0].userMessage).not.toBeNull();

    // 도는 중에 누가 실패 문구를 다시 쓸 수도 있습니다 — 실제로 큐가
    // 그랬습니다. 그래서 끝나는 자리에서 한 번 더 지웁니다.
    prisma.runs[0].userMessage = "작업을 돌리던 서버가 멈춰 중단됐습니다.";
    prisma.runs[0].failureKind = "timeout";

    await runner.run(
      definition([
        { name: "a", run: async (state) => ({ visited: [...state.visited, "a"] }) },
        { name: "b", run: async (state) => ({ visited: [...state.visited, "b"] }) },
      ]),
      { items: ["x"] },
      { resumeJobId: first.jobId },
    );

    expect(prisma.runs[0].status).toBe("succeeded");
    expect(prisma.runs[0].userMessage).toBeNull();
    expect(prisma.runs[0].failureKind).toBeNull();
  });
});
