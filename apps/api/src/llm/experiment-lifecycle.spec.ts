import { BadRequestException } from "@nestjs/common";
import { MockLlmProvider, parseExperiment } from "@acos/core";
import type {
  ExecutionRecord,
  ExecutionStore,
  LlmProvider,
  LlmRequest,
  LlmResult,
  NewExecution,
} from "@acos/core";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmService } from "./llm.service";

/**
 * Experiment Lifecycle & Sticky Assignment 검증. (TASK-1101, Sprint 11)
 *
 * 실험 **정의**는 환경변수가 원천이고(결정 1003-②), 여기서 다루는 것은
 * 운영 중 바뀌는 **상태**와 **Project 기반 고정 배정**이다.
 * Prisma는 인메모리 스텁으로 대체해 상태 전이·배정 규칙 자체를 검증한다.
 */

class StubProvider implements LlmProvider {
  calls: string[] = [];
  constructor(
    readonly name: string,
    readonly defaultModel: string,
  ) {}
  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls.push(request.model ?? this.defaultModel);
    return {
      provider: this.name,
      model: request.model ?? this.defaultModel,
      text: `${this.name} 응답`,
      usage: { inputTokens: 5, outputTokens: 3 },
      raw: {},
    };
  }
}

/** Prisma 스텁 인자 타입 — 실제 Prisma 타입 대신 필요한 부분만 좁게 선언한다 */
interface StateFindArgs {
  where: { feature: string };
  include?: unknown;
}
interface StateUpdate {
  status?: string;
  promotedVariant?: string | null;
  actor?: string | null;
  note?: string | null;
}
interface EventCreate {
  stateId: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  fromVariant: string | null;
  toVariant: string | null;
  actor: string | null;
  note: string | null;
}
interface EventFindArgs {
  where: { stateId: string; action?: { not: string } };
}
interface AssignmentWhere {
  where: { feature_projectId: { feature: string; projectId: string } };
}
interface AssignmentEventCreate {
  feature: string;
  projectId: string;
  reason: string;
  fromVariant: string | null;
  toVariant: string;
  fromSignature: string | null;
  toSignature: string;
}
interface AssignmentUpsert extends AssignmentWhere {
  create: {
    stateId: string;
    feature: string;
    projectId: string;
    variantKey: string;
    signature: string;
  };
  update: { variantKey: string; signature: string };
}

/** experiment_states / experiment_events / experiment_assignments 인메모리 스텁 */
function createPrismaStub() {
  const states = new Map<
    string,
    {
      id: string;
      feature: string;
      status: string;
      promotedVariant: string | null;
      actor: string | null;
      note: string | null;
      updatedAt: Date;
    }
  >();
  const events: {
    id: string;
    stateId: string;
    action: string;
    fromStatus: string;
    toStatus: string;
    fromVariant: string | null;
    toVariant: string | null;
    actor: string | null;
    note: string | null;
    createdAt: Date;
  }[] = [];
  const assignments = new Map<
    string,
    {
      feature: string;
      projectId: string;
      variantKey: string;
      signature: string;
      stateId: string;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  const assignmentEvents: (AssignmentEventCreate & {
    id: string;
    createdAt: Date;
  })[] = [];
  let clock = 0;
  const tick = () => new Date(2026, 0, 1, 0, 0, (clock += 1));

  return {
    states,
    events,
    assignments,
    assignmentEvents,
    prisma: {
      experimentState: {
        findUnique: async ({ where, include }: StateFindArgs) => {
          const row = states.get(where.feature);
          if (!row) return null;
          if (!include) return row;
          return {
            ...row,
            events: events
              .filter((event) => event.stateId === row.id)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
            _count: {
              assignments: [...assignments.values()].filter(
                (item) => item.feature === row.feature,
              ).length,
            },
          };
        },
        upsert: async ({ where }: { where: { feature: string } }) => {
          const found = states.get(where.feature);
          if (found) return found;
          const created = {
            id: `state-${states.size + 1}`,
            feature: where.feature,
            status: "RUNNING",
            promotedVariant: null,
            actor: null,
            note: null,
            updatedAt: tick(),
          };
          states.set(where.feature, created);
          return created;
        },
        update: async ({ where, data }: { where: { id: string }; data: StateUpdate }) => {
          const row = [...states.values()].find((item) => item.id === where.id)!;
          Object.assign(row, data, { updatedAt: tick() });
          return row;
        },
      },
      experimentEvent: {
        create: async ({ data }: { data: EventCreate }) => {
          const created = {
            ...data,
            id: `event-${events.length + 1}`,
            createdAt: tick(),
          };
          events.push(created);
          return created;
        },
        findFirst: async ({ where }: EventFindArgs) =>
          events
            .filter(
              (event) =>
                event.stateId === where.stateId &&
                event.action !== where.action?.not,
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
          null,
      },
      experimentAssignment: {
        findUnique: async ({ where }: AssignmentWhere) => {
          const { feature, projectId } = where.feature_projectId;
          const found = assignments.get(`${feature}|${projectId}`);
          // Prisma는 새 객체를 돌려준다 — 복사본을 반환해 별칭 오염을 막는다
          return found ? { ...found } : null;
        },
        upsert: async ({ where, create, update }: AssignmentUpsert) => {
          const { feature, projectId } = where.feature_projectId;
          const key = `${feature}|${projectId}`;
          const found = assignments.get(key);
          if (found) {
            Object.assign(found, update, { updatedAt: tick() });
            return found;
          }
          const created = { ...create, createdAt: tick(), updatedAt: tick() };
          assignments.set(key, created);
          return created;
        },
        findMany: async ({ where }: { where?: { feature?: string } }) =>
          [...assignments.values()].filter((item) =>
            where?.feature ? item.feature === where.feature : true,
          ),
        groupBy: async ({ where }: { where?: { feature?: string } }) => {
          const counts = new Map<string, number>();
          for (const item of assignments.values()) {
            if (where?.feature && item.feature !== where.feature) continue;
            counts.set(item.variantKey, (counts.get(item.variantKey) ?? 0) + 1);
          }
          return [...counts.entries()].map(([variantKey, count]) => ({
            variantKey,
            _count: { _all: count },
          }));
        },
        deleteMany: async () => ({ count: 0 }),
      },
      experimentAssignmentEvent: {
        create: async ({ data }: { data: AssignmentEventCreate }) => {
          const created = { ...data, id: `ae-${assignmentEvents.length + 1}`, createdAt: tick() };
          assignmentEvents.push(created);
          return created;
        },
        findMany: async ({ where }: { where?: { feature?: string } }) =>
          [...assignmentEvents]
            .filter((item) =>
              where?.feature ? item.feature === where.feature : true,
            )
            .reverse(),
      },
      project: { findMany: async () => [] },
      $transaction: async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
    },
  };
}

function createStore(): { store: ExecutionStore; executions: NewExecution[] } {
  const executions: NewExecution[] = [];
  return {
    executions,
    store: {
      record: async (entry: NewExecution) => {
        executions.push(entry);
        return { ...entry, id: "exec", createdAt: new Date() } as ExecutionRecord;
      },
    },
  };
}

const MESSAGES = [{ role: "user" as const, content: "안녕" }];
const CANARY = "sonnet-canary|canary|openai=80,anthropic=20";

describe("Experiment Lifecycle & Sticky Assignment (TASK-1101)", () => {
  afterEach(() => {
    delete process.env.LLM_EXPERIMENT_ANALYSIS;
    delete process.env.LLM_ROUTE_ANALYSIS;
  });

  function createService() {
    const stub = createPrismaStub();
    const lifecycle = new ExperimentLifecycleService(stub.prisma as never);
    const mock = new MockLlmProvider();
    const openai = new StubProvider("openai", "gpt-4o");
    const anthropic = new StubProvider("anthropic", "claude-opus-5");
    const { store, executions } = createStore();
    const service = new LlmService(
      mock,
      store,
      { assertWithinBudget: async () => undefined } as never,
      new Map<string, LlmProvider>([
        ["mock", mock],
        ["openai", openai],
        ["anthropic", anthropic],
      ]),
      lifecycle,
    );
    return { service, lifecycle, openai, anthropic, executions, stub };
  }

  const analyze = (service: LlmService, projectId?: string) =>
    service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis", projectId },
    );

  it("Sticky Assignment — 같은 프로젝트는 항상 같은 변형을 받는다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = CANARY;
    const { service, stub } = createService();

    const first = await analyze(service, "proj-1");
    for (let i = 0; i < 15; i += 1) {
      const next = await analyze(service, "proj-1");
      expect(next.provider).toBe(first.provider);
    }

    // 배정은 한 번만 저장된다
    expect(stub.assignments.size).toBe(1);
    const stored = [...stub.assignments.values()][0];
    expect(stored).toMatchObject({
      feature: "product-analysis",
      projectId: "proj-1",
      signature: "openai=80,anthropic=20",
    });
    expect(stored.variantKey).toBe(first.provider);
  });

  it("프로젝트가 다르면 변형이 나뉜다 (전부 한쪽으로 몰리지 않는다)", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=50,anthropic=50";
    const { service, stub } = createService();

    for (let i = 0; i < 40; i += 1) {
      await analyze(service, `proj-${i}`);
    }
    const variants = new Set(
      [...stub.assignments.values()].map((item) => item.variantKey),
    );
    expect(variants).toEqual(new Set(["openai", "anthropic"]));
    expect(stub.assignments.size).toBe(40);
  });

  it("projectId가 없으면 기존 무상태 추첨 (TASK-1003 동작 유지)", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = CANARY;
    const { service, stub } = createService();

    for (let i = 0; i < 10; i += 1) {
      await analyze(service);
    }
    expect(stub.assignments.size).toBe(0); // 배정을 저장하지 않는다
  });

  it("STOP — 실험을 적용하지 않고 기존 라우팅으로 처리한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    const { service, lifecycle, openai, anthropic } = createService();

    await analyze(service, "proj-1");
    expect(openai.calls).toHaveLength(1);

    await lifecycle.transition({
      feature: "product-analysis",
      action: "STOP",
      actor: "admin@acos.local",
      experiment: parseExperiment("product-analysis", "openai=100"),
    });

    const result = await analyze(service, "proj-1");
    expect(result.provider).toBe("anthropic"); // 라우팅 규칙으로
    expect(openai.calls).toHaveLength(1); // 추가 호출 없음
    expect(anthropic.calls).toHaveLength(1);
  });

  it("START — 중단한 실험을 다시 켠다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    const { service, lifecycle, openai } = createService();
    const experiment = parseExperiment("product-analysis", "openai=100");

    await lifecycle.transition({
      feature: "product-analysis",
      action: "STOP",
      experiment,
    });
    await analyze(service, "proj-1");
    expect(openai.calls).toHaveLength(0);

    const started = await lifecycle.transition({
      feature: "product-analysis",
      action: "START",
      experiment,
    });
    expect(started.status).toBe("RUNNING");
    await analyze(service, "proj-1");
    expect(openai.calls).toHaveLength(1);
  });

  it("Winner Promotion — 승자 변형으로 전 트래픽을 보낸다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=99,anthropic=1";
    const { service, lifecycle, openai, anthropic } = createService();
    const experiment = parseExperiment(
      "product-analysis",
      "openai=99,anthropic=1",
    );

    const promoted = await lifecycle.transition({
      feature: "product-analysis",
      action: "PROMOTE",
      variantKey: "anthropic",
      actor: "admin@acos.local",
      experiment,
    });
    expect(promoted).toMatchObject({
      status: "PROMOTED",
      promotedVariant: "anthropic",
    });

    // 1% 변형이지만 승격됐으므로 전부 anthropic으로 간다
    for (let i = 0; i < 10; i += 1) {
      await analyze(service, `proj-${i}`);
    }
    expect(anthropic.calls).toHaveLength(10);
    expect(openai.calls).toHaveLength(0);
  });

  it("Winner Promotion — 정의에 없는 변형은 400으로 거부한다", async () => {
    const { lifecycle } = createService();
    await expect(
      lifecycle.transition({
        feature: "product-analysis",
        action: "PROMOTE",
        variantKey: "gemini",
        experiment: parseExperiment("product-analysis", "openai=99,anthropic=1"),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("Rollback — 직전 상태로 되돌린다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=99,anthropic=1";
    const { service, lifecycle, openai, anthropic } = createService();
    const experiment = parseExperiment(
      "product-analysis",
      "openai=99,anthropic=1",
    );

    await lifecycle.transition({
      feature: "product-analysis",
      action: "PROMOTE",
      variantKey: "anthropic",
      experiment,
    });
    await analyze(service, "proj-1");
    expect(anthropic.calls).toHaveLength(1);

    const rolled = await lifecycle.transition({
      feature: "product-analysis",
      action: "ROLLBACK",
      experiment,
    });
    expect(rolled).toMatchObject({
      status: "RUNNING",
      promotedVariant: null,
    });

    // 승격 해제 → 다시 가중 배정 (99:1이므로 대부분 openai)
    for (let i = 0; i < 10; i += 1) {
      await analyze(service, `proj-${i}`);
    }
    expect(openai.calls.length).toBeGreaterThan(0);
  });

  it("전이 이력이 감사 기록으로 남는다", async () => {
    const { lifecycle } = createService();
    const experiment = parseExperiment("product-analysis", "openai=100");

    await lifecycle.transition({
      feature: "product-analysis",
      action: "STOP",
      actor: "admin@acos.local",
      note: "비용 급증",
      experiment,
    });
    const result = await lifecycle.transition({
      feature: "product-analysis",
      action: "START",
      actor: "admin@acos.local",
      experiment,
    });

    expect(result.events.map((event) => event.action)).toEqual([
      "START",
      "STOP",
    ]);
    expect(result.events[1]).toMatchObject({
      fromStatus: "RUNNING",
      toStatus: "STOPPED",
      actor: "admin@acos.local",
      note: "비용 급증",
    });
  });

  it("Assignment Dashboard — 배정 목록과 변형 분포를 제공한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=50,anthropic=50";
    const { service, lifecycle } = createService();

    for (let i = 0; i < 12; i += 1) {
      await analyze(service, `proj-${i}`);
    }

    const assignments = await lifecycle.assignments({
      feature: "product-analysis",
    });
    expect(assignments).toHaveLength(12);
    expect(assignments[0]).toMatchObject({
      feature: "product-analysis",
      signature: "openai=50,anthropic=50",
    });

    const distribution = await lifecycle.distribution("product-analysis");
    const total = distribution.reduce((sum, item) => sum + item.projects, 0);
    expect(total).toBe(12);
    expect(distribution.length).toBeGreaterThan(1);
  });

  it("실험 정의가 바뀌면 저장된 배정을 버리고 재배정한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    const { service, stub } = createService();
    await analyze(service, "proj-1");
    expect([...stub.assignments.values()][0]).toMatchObject({
      variantKey: "openai",
      signature: "openai=100",
    });

    // 정의 변경 — 서명이 달라진다
    process.env.LLM_EXPERIMENT_ANALYSIS = "anthropic=100";
    await analyze(service, "proj-1");
    expect([...stub.assignments.values()][0]).toMatchObject({
      variantKey: "anthropic",
      signature: "anthropic=100",
    });
  });

  it("재배정은 Audit 이력으로 남는다 (CTO 결정 1101-⑤)", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    const { service, lifecycle, stub } = createService();
    await analyze(service, "proj-1");
    // 최초 배정은 재배정이 아니므로 이력이 없다
    expect(stub.assignmentEvents).toHaveLength(0);

    process.env.LLM_EXPERIMENT_ANALYSIS = "anthropic=100";
    await analyze(service, "proj-1");

    expect(stub.assignmentEvents).toHaveLength(1);
    const events = await lifecycle.reassignments({
      feature: "product-analysis",
    });
    expect(events[0]).toMatchObject({
      feature: "product-analysis",
      projectId: "proj-1",
      reason: "DEFINITION_CHANGED",
      fromVariant: "openai",
      toVariant: "anthropic",
      fromSignature: "openai=100",
      toSignature: "anthropic=100",
    });

    // 같은 정의로 다시 호출하면 재사용 — 새 이력이 쌓이지 않는다
    await analyze(service, "proj-1");
    expect(stub.assignmentEvents).toHaveLength(1);
  });

  it("experiments()에 운영 상태가 함께 실린다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    const { service, lifecycle } = createService();
    await lifecycle.transition({
      feature: "product-analysis",
      action: "STOP",
      experiment: parseExperiment("product-analysis", "openai=100"),
    });

    const [experiment] = (await service.experiments()).experiments;
    expect(experiment.lifecycle).toMatchObject({
      feature: "product-analysis",
      status: "STOPPED",
    });
    // 중단 상태면 적용되지 않는다
    expect(experiment.active).toBe(false);
  });
});
